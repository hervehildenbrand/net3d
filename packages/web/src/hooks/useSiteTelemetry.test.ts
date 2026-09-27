import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { siteTelemetryQueryOptions } from './useSiteTelemetry'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => vi.unstubAllGlobals())

describe('siteTelemetryQueryOptions', () => {
  test('test_siteTelemetryQueryOptions_monitored_site_polls_every_2_seconds', async () => {
    const body = { devices: { r1: { 'et-0/0/0': { rxBps: 1, txBps: 1, capacityBps: 100, stale: false } } } }
    vi.stubGlobal('fetch', vi.fn(async () => response(body)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = siteTelemetryQueryOptions('netbox', 'ams')
    expect(options.queryKey).toEqual(['telemetry', 'netbox', 'ams'])
    await client.fetchQuery(options)
    const query = client.getQueryCache().find({ queryKey: ['telemetry', 'netbox', 'ams'], exact: true })!
    const interval = options.refetchInterval
    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(2_000)
    client.clear()
  })

  test('test_siteTelemetryQueryOptions_no_monitored_devices_stops_polling', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ devices: {} })))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = siteTelemetryQueryOptions('netbox', 'ams')
    await client.fetchQuery(options)
    const query = client.getQueryCache().find({ queryKey: ['telemetry', 'netbox', 'ams'], exact: true })!
    const interval = options.refetchInterval
    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(false)
    client.clear()
  })

  test('test_siteTelemetryQueryOptions_fetches_backend_prefixed_encoded_url', async () => {
    const fetchMock = vi.fn(async () => response({ devices: {} }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await client.fetchQuery(siteTelemetryQueryOptions('infrahub', 'a b'))
    expect(fetchMock).toHaveBeenCalledWith('/api-infrahub/telemetry/sites/a%20b', expect.anything())
    client.clear()
  })

  test('test_siteTelemetryQueryOptions_http_error_rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({}, 503)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await expect(client.fetchQuery(siteTelemetryQueryOptions('netbox', 'ams'))).rejects.toThrow('HTTP 503')
    client.clear()
  })

  test('test_siteTelemetryQueryOptions_error_without_data_keeps_polling', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = siteTelemetryQueryOptions('netbox', 'ams')
    await client.fetchQuery(options).catch(() => {})
    const query = client.getQueryCache().find({ queryKey: ['telemetry', 'netbox', 'ams'], exact: true })!
    expect(query.state.data).toBeUndefined()
    const interval = options.refetchInterval
    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(2_000)
    client.clear()
  })
})
