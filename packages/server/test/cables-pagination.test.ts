import { afterEach, describe, expect, test, vi } from 'vitest'
import { createNetBoxClient } from '../src/netbox'

interface FetchCall {
  url: string
  query?: string
}

/** Stub fetch: /api/status reports the given version; GraphQL pages come from pages[]. */
function stubNetbox(version: string, pages: unknown[][]) {
  const calls: FetchCall[] = []
  let page = 0
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const body = init?.body ? (JSON.parse(String(init.body)) as { query: string }) : undefined
    calls.push({ url: u, query: body?.query })
    if (u.includes('/api/status/')) {
      return new Response(JSON.stringify({ 'netbox-version': version }), { status: 200 })
    }
    const cables = pages[Math.min(page++, pages.length - 1)] ?? []
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
  test('v4 keeps fetching pages of 1000 until a short page and merges them', async () => {
    const pageA = Array.from({ length: 1000 }, (_, i) => cable(i))
    const pageB = Array.from({ length: 400 }, (_, i) => cable(1000 + i))
    const calls = stubNetbox('4.6.2', [pageA, pageB])
    const client = createNetBoxClient('http://nb', 'tok')
    const cables = await client.getSiteCables('dc1')
    expect(cables).toHaveLength(1400)
    const gql = calls.filter((c) => c.query?.includes('cable_list'))
    expect(gql).toHaveLength(2)
    expect(gql[0]!.query).toContain('pagination: {offset: 0, limit: 1000}')
    expect(gql[1]!.query).toContain('pagination: {offset: 1000, limit: 1000}')
  })

  test('v4 stops after one call when the first page is short', async () => {
    const calls = stubNetbox('4.6.2', [[cable(1), cable(2)]])
    const client = createNetBoxClient('http://nb', 'tok')
    expect(await client.getSiteCables('dc1')).toHaveLength(2)
    expect(calls.filter((c) => c.query?.includes('cable_list'))).toHaveLength(1)
  })

  test('v3 issues a single unpaginated query', async () => {
    const calls = stubNetbox('3.7.8', [[cable(1)]])
    const client = createNetBoxClient('http://nb', 'tok')
    expect(await client.getSiteCables('dc1')).toHaveLength(1)
    const gql = calls.filter((c) => c.query?.includes('cable_list'))
    expect(gql).toHaveLength(1)
    expect(gql[0]!.query).not.toContain('pagination:')
  })
})
