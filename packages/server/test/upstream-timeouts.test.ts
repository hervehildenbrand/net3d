import { afterEach, describe, expect, test, vi } from 'vitest'
import { createInfrahubClient } from '../src/infrahub/client'
import { createNetBoxClient } from '../src/netbox'
import { verifyConnection } from '../src/connection-check'

function hangingFetch(signals: AbortSignal[]): typeof fetch {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal
    if (!signal) return new Promise<Response>(() => {})
    signals.push(signal)
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }) as typeof fetch
}

afterEach(() => vi.restoreAllMocks())

describe('upstream request deadlines', () => {
  test('test_createNetBoxClient_hanging_topology_request_aborts', async () => {
    const signals: AbortSignal[] = []
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const client = createNetBoxClient('http://nb', 'tok', {
      fetch: hangingFetch(signals),
      topologyTimeoutMs: 10,
    })

    await expect(client.getSites()).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(signals).toHaveLength(2)
    expect(timeout).toHaveBeenCalledTimes(2)
    expect(timeout).toHaveBeenNthCalledWith(1, 10)
    expect(timeout).toHaveBeenNthCalledWith(2, 10)
  })

  test('test_createInfrahubClient_hanging_topology_request_aborts', async () => {
    const signals: AbortSignal[] = []
    const client = createInfrahubClient('http://ih', 'tok', {
      fetch: hangingFetch(signals),
      topologyTimeoutMs: 10,
    })

    await expect(client.getSites()).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
  })

  test('test_verifyConnection_requests_use_lightweight_deadline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        String(input).includes('/api/status/')
          ? JSON.stringify({ 'netbox-version': '4.2.0' })
          : JSON.stringify({ data: { __typename: 'Query' } }),
      ),
    )
    const fetchImpl = fetchMock as typeof fetch

    await verifyConnection('http://nb', 'tok', fetchImpl)

    expect(timeout).toHaveBeenCalledTimes(2)
    expect(timeout).toHaveBeenNthCalledWith(1, 5_000)
    expect(timeout).toHaveBeenNthCalledWith(2, 5_000)
    expect(fetchMock.mock.calls.every((call) => call[1]?.signal instanceof AbortSignal)).toBe(true)
  })

  test('test_createNetBoxClient_napalm_signal_preserves_45_second_deadline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'))
    const fetchImpl = fetchMock as typeof fetch
    const client = createNetBoxClient('http://nb', 'tok', { fetch: fetchImpl, topologyTimeoutMs: 10 })

    await client.napalm(1, 'get_facts')

    expect(timeout).toHaveBeenCalledWith(45_000)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeout.mock.results[0]?.value)
  })
})
