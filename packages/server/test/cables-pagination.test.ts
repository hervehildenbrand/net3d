import { afterEach, describe, expect, test, vi } from 'vitest'
import { createNetBoxClient } from '../src/netbox'

interface FetchCall {
  url: string
  query?: string
}

/**
 * Stub fetch: /api/status reports the given version, the REST cable count
 * endpoint reports the given count (or 500s when null), and GraphQL pages are
 * served by offset parsed from the query.
 */
function stubNetbox(version: string, pages: unknown[][], restCount: number | null) {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const body = init?.body ? (JSON.parse(String(init.body)) as { query: string }) : undefined
    calls.push({ url: u, query: body?.query })
    if (u.includes('/api/status/')) {
      return new Response(JSON.stringify({ 'netbox-version': version }), { status: 200 })
    }
    if (u.includes('/api/dcim/cables/')) {
      if (restCount === null) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ count: restCount }), { status: 200 })
    }
    const offset = /offset: (\d+)/.exec(body?.query ?? '')
    const page = offset ? Number(offset[1]) / 1000 : 0
    const cables = pages[page] ?? []
    return new Response(JSON.stringify({ data: { cable_list: cables } }), { status: 200 })
  })
  return calls
}

const cable = (id: number) => ({
  id: String(id),
  type: 'cat6a',
  status: 'connected',
  color: '',
  a_terminations: [],
  b_terminations: [],
})

afterEach(() => vi.unstubAllGlobals())

describe('getSiteCables pagination', () => {
  test('v4 learns the page count from REST and fetches all pages concurrently', async () => {
    const pageA = Array.from({ length: 1000 }, (_, i) => cable(i))
    const pageB = Array.from({ length: 400 }, (_, i) => cable(1000 + i))
    const calls = stubNetbox('4.6.2', [pageA, pageB], 1400)
    const client = createNetBoxClient('http://nb', 'tok')
    const cables = await client.getSiteCables('dc1')
    expect(cables).toHaveLength(1400)
    expect(calls.some((c) => c.url.includes('/api/dcim/cables/?site=dc1&limit=1'))).toBe(true)
    const gql = calls.filter((c) => c.query?.includes('cable_list'))
    expect(gql).toHaveLength(2)
    expect(gql[0]!.query).toContain('pagination: {offset: 0, limit: 1000}')
    expect(gql[1]!.query).toContain('pagination: {offset: 1000, limit: 1000}')
  })

  test('v4 issues a single page when the count fits', async () => {
    const calls = stubNetbox('4.6.2', [[cable(1), cable(2)]], 2)
    const client = createNetBoxClient('http://nb', 'tok')
    expect(await client.getSiteCables('dc1')).toHaveLength(2)
    expect(calls.filter((c) => c.query?.includes('cable_list'))).toHaveLength(1)
  })

  test('v4 falls back to sequential paging when the REST count fails', async () => {
    const pageA = Array.from({ length: 1000 }, (_, i) => cable(i))
    const pageB = [cable(1000)]
    const calls = stubNetbox('4.6.2', [pageA, pageB], null)
    const client = createNetBoxClient('http://nb', 'tok')
    expect(await client.getSiteCables('dc1')).toHaveLength(1001)
    expect(calls.filter((c) => c.query?.includes('cable_list'))).toHaveLength(2)
  })

  test('v3 issues a single unpaginated query and no REST count call', async () => {
    const calls = stubNetbox('3.7.8', [[cable(1)]], 999)
    const client = createNetBoxClient('http://nb', 'tok')
    expect(await client.getSiteCables('dc1')).toHaveLength(1)
    const gql = calls.filter((c) => c.query?.includes('cable_list'))
    expect(gql).toHaveLength(1)
    expect(gql[0]!.query).not.toContain('pagination:')
    expect(calls.some((c) => c.url.includes('/api/dcim/cables/'))).toBe(false)
  })
})
