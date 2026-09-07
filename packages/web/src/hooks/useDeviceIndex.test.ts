import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  deviceIndexQueryOptions,
  subscribeToSiteSuccesses,
  type DeviceIndexData,
} from './useDeviceIndex'

function response(indexedSites: number, totalSites: number, prewarmEnabled = true): Response {
  return new Response(
    JSON.stringify([
      {
        id: `device-${indexedSites}`,
        name: `device-${indexedSites}`,
        siteName: 'ams1',
        rackId: 'rack-1',
        rackName: 'rack-1',
        position: 1,
        roleName: 'server',
        roleColor: '334155',
        model: 'server',
        status: 'active',
      },
    ]),
    {
      headers: {
        'X-Indexed-Sites': String(indexedSites),
        'X-Total-Sites': String(totalSites),
        'X-Prewarm-Enabled': String(prewarmEnabled),
      },
    },
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('deviceIndexQueryOptions', () => {
  test('test_device_index_partial_visible_prewarm_enabled_polls_after_15_seconds', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(1, 2)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const observer = new QueryObserver(client, deviceIndexQueryOptions('netbox'))
    const unsubscribe = observer.subscribe(() => {})
    await client.refetchQueries({ queryKey: ['devices', 'netbox'], exact: true })

    const interval = observer.options.refetchInterval
    const query = client.getQueryCache().find({ queryKey: ['devices', 'netbox'], exact: true })!
    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(15_000)
    expect(observer.options.refetchIntervalInBackground).toBe(false)

    unsubscribe()
    client.clear()
  })

  test('test_device_index_hidden_document_delegates_pause_to_query_observer', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(1, 2)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await client.fetchQuery(deviceIndexQueryOptions('netbox'))
    const observer = new QueryObserver(client, deviceIndexQueryOptions('netbox'))
    const interval = observer.options.refetchInterval
    const query = client.getQueryCache().find({ queryKey: ['devices', 'netbox'], exact: true })!

    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(15_000)
    expect(observer.options.refetchIntervalInBackground).toBe(false)
    client.clear()
  })

  test.each([
    ['complete coverage', 2, 2, true],
    ['disabled prewarm', 1, 2, false],
  ])('test_device_index_%s_does_not_poll', async (_scenario, indexed, total, prewarm) => {
    vi.stubGlobal('document', { visibilityState: 'visible' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(indexed, total, prewarm)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await client.fetchQuery(deviceIndexQueryOptions('netbox'))
    const observer = new QueryObserver(client, deviceIndexQueryOptions('netbox'))
    const interval = observer.options.refetchInterval
    const query = client.getQueryCache().find({ queryKey: ['devices', 'netbox'], exact: true })!
    expect(typeof interval === 'function' ? interval(query as never) : interval).toBe(false)
    client.clear()
  })
})

describe('subscribeToSiteSuccesses', () => {
  test('test_device_index_new_warmed_site_refetches_active_backend_data', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(1, 2)).mockResolvedValueOnce(response(2, 2)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const observer = new QueryObserver(client, deviceIndexQueryOptions('netbox'))
    const unsubscribeObserver = observer.subscribe(() => {})
    const unsubscribeCache = subscribeToSiteSuccesses(client, 'netbox')
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.indexedSites).toBe(1))

    client.setQueryData(['site', 'netbox', 'ams2'], { racks: [] })

    await vi.waitFor(() => expect(observer.getCurrentResult().data?.indexedSites).toBe(2))
    expect(fetch).toHaveBeenCalledTimes(2)
    unsubscribeCache()
    unsubscribeObserver()
    client.clear()
  })

  test('test_device_index_other_backend_site_success_preserves_cached_index', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const cached: DeviceIndexData = { devices: [], indexedSites: 1, totalSites: 2, prewarmEnabled: true }
    client.setQueryData(['devices', 'netbox'], cached)
    const unsubscribe = subscribeToSiteSuccesses(client, 'netbox')

    client.setQueryData(['site', 'infrahub', 'ams1'], { racks: [] })

    expect(client.getQueryState(['devices', 'netbox'])?.isInvalidated).toBe(false)
    expect(client.getQueryData(['devices', 'netbox'])).toEqual(cached)
    unsubscribe()
    client.clear()
  })
})
