import { describe, expect, test } from 'vitest'
import { verifyConnection, ConnectionCheckError } from '../src/connection-check'

type StubPart = { body?: unknown; httpStatus?: number; throwCode?: string }

// A fake fetch that routes /graphql/ to one canned response and everything
// else (i.e. /api/status/) to another, and can simulate undici network errors
// by throwing a TypeError whose cause carries a code (ENOTFOUND, ECONNREFUSED…).
function fetchStub(opts: { status?: StubPart; graphql?: StubPart }): typeof fetch {
  return (async (url: string | URL) => {
    const part = String(url).includes('/graphql/') ? opts.graphql : opts.status
    if (!part) throw new Error(`unexpected fetch: ${url}`)
    if (part.throwCode) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: part.throwCode } })
    }
    return new Response(JSON.stringify(part.body ?? {}), { status: part.httpStatus ?? 200 })
  }) as unknown as typeof fetch
}

const OK_STATUS: StubPart = {
  body: { 'netbox-version': '4.0.5', plugins: { netbox_napalm_plugin: {} } },
}
const OK_GRAPHQL: StubPart = { body: { data: { __typename: 'Query' } } }

describe('verifyConnection', () => {
  test('returns version and NAPALM availability when reachable', async () => {
    const info = await verifyConnection(
      'https://nb.example',
      't',
      fetchStub({ status: OK_STATUS, graphql: OK_GRAPHQL }),
    )
    expect(info).toEqual({ version: '4.0.5', napalmAvailable: true })
  })

  test('reports napalmAvailable false when the plugin is absent', async () => {
    const info = await verifyConnection(
      'https://nb.example',
      't',
      fetchStub({ status: { body: { 'netbox-version': '3.7.8', plugins: {} } }, graphql: OK_GRAPHQL }),
    )
    expect(info).toEqual({ version: '3.7.8', napalmAvailable: false })
  })

  test('rejected token (401) throws with a token hint', async () => {
    const err = await verifyConnection('https://nb.example', 'bad', fetchStub({ status: { httpStatus: 401 } })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectionCheckError)
    expect(err.hint).toMatch(/NETBOX_TOKEN/)
  })

  test('forbidden token (403) throws with a token hint', async () => {
    const err = await verifyConnection('https://nb.example', 'bad', fetchStub({ status: { httpStatus: 403 } })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectionCheckError)
    expect(err.hint).toMatch(/NETBOX_TOKEN/)
  })

  test('DNS failure (ENOTFOUND) throws with a URL hint', async () => {
    const err = await verifyConnection('https://nope.example', 't', fetchStub({ status: { throwCode: 'ENOTFOUND' } })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectionCheckError)
    expect(err.hint).toMatch(/NETBOX_URL/)
  })

  test('connection refused throws with a running/port hint', async () => {
    const err = await verifyConnection('https://nb.example', 't', fetchStub({ status: { throwCode: 'ECONNREFUSED' } })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectionCheckError)
    expect(err.hint).toMatch(/running|port/i)
  })

  test('self-signed certificate throws with a TLS hint', async () => {
    const err = await verifyConnection('https://nb.example', 't', fetchStub({ status: { throwCode: 'DEPTH_ZERO_SELF_SIGNED_CERT' } })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectionCheckError)
    expect(err.hint).toMatch(/NETBOX_TLS_VERIFY/)
  })

  test('reachable REST but GraphQL disabled throws with a GraphQL hint', async () => {
    const err = await verifyConnection(
      'https://nb.example',
      't',
      fetchStub({ status: OK_STATUS, graphql: { httpStatus: 404 } }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectionCheckError)
    expect(err.hint).toMatch(/GraphQL/i)
  })

  test('unexpected status code surfaces the HTTP status', async () => {
    const err = await verifyConnection('https://nb.example', 't', fetchStub({ status: { httpStatus: 500 } })).catch((e) => e)
    expect(err).toBeInstanceOf(ConnectionCheckError)
    expect(err.message).toMatch(/500/)
  })
})
