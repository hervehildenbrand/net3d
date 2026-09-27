import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { circuitTelemetryQueryOptions } from './useCircuitTelemetry'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => vi.unstubAllGlobals())

describe('circuitTelemetryQueryOptions', () => {
  test('test_circuitTelemetryQueryOptions_polls_every_5_seconds', async () => {
    const body = { circuits: { cid1: { pct: 50, bps: 1e9, stale: false } } }
    vi.stubGlobal('fetch', vi.fn(async () => response(body)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = circuitTelemetryQueryOptions('netbox')
    expect(options.queryKey).toEqual(['circuit-telemetry', 'netbox'])
    await client.fetchQuery(options)
    const query = client.getQueryCache().find({ queryKey: ['circuit-telemetry', 'netbox'], exact: true })!
    const interval = options.refetchInterval
    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(5_000)
    expect(options.refetchIntervalInBackground).toBe(false)
    expect(options.retry).toBe(false)
    client.clear()
  })

  test('test_circuitTelemetryQueryOptions_empty_body_keeps_polling', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ circuits: {} })))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = circuitTelemetryQueryOptions('netbox')
    await client.fetchQuery(options)
    const query = client.getQueryCache().find({ queryKey: ['circuit-telemetry', 'netbox'], exact: true })!
    const interval = options.refetchInterval
    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(5_000)
    client.clear()
  })

  test('test_circuitTelemetryQueryOptions_fetches_backend_prefixed_url', async () => {
    const fetchMock = vi.fn(async () => response({ circuits: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await client.fetchQuery(circuitTelemetryQueryOptions('infrahub'))
    expect(fetchMock).toHaveBeenCalledWith('/api-infrahub/telemetry/circuits', expect.anything())
    client.clear()
  })

  test('test_circuitTelemetryQueryOptions_http_error_rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({}, 503)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await expect(client.fetchQuery(circuitTelemetryQueryOptions('netbox'))).rejects.toThrow('HTTP 503')
    client.clear()
  })
})
