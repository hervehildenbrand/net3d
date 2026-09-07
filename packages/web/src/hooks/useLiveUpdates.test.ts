import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { eventToInvalidations, startLiveUpdates } from './useLiveUpdates'

describe('eventToInvalidations', () => {
  test('site scope invalidates that site plus the global lists for the active backend', () => {
    expect(
      eventToInvalidations('netbox', { type: 'invalidate', scope: 'site', site: 'AMS1' }),
    ).toEqual([
      { queryKey: ['site', 'netbox', 'AMS1'] },
      { queryKey: ['sites', 'netbox'] },
      { queryKey: ['circuits', 'netbox'] },
      { queryKey: ['devices', 'netbox'] },
    ])
  })

  test('all scope prefix-invalidates every site of the backend', () => {
    expect(eventToInvalidations('infrahub', { type: 'invalidate', scope: 'all' })).toEqual([
      { queryKey: ['site', 'infrahub'] },
      { queryKey: ['sites', 'infrahub'] },
      { queryKey: ['circuits', 'infrahub'] },
      { queryKey: ['devices', 'infrahub'] },
    ])
  })
})

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  constructor(public url: string) { FakeEventSource.instances.push(this) }
}

describe('startLiveUpdates', () => {
  let queryClient: QueryClient
  let visible: boolean
  let visibilityHandler: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    visible = true
    queryClient = new QueryClient()
    visibilityHandler = undefined
  })
  afterEach(() => vi.useRealTimers())

  const start = (available: boolean, statuses: string[] = []) => startLiveUpdates({
    backend: 'netbox', liveUpdatesAvailable: available, queryClient,
    createEventSource: (url) => new FakeEventSource(url),
    isVisible: () => visible,
    onVisibilityChange: (handler) => { visibilityHandler = handler; return () => { visibilityHandler = undefined } },
    onStatus: (status) => statuses.push(status),
  })

  test('test_startLiveUpdates_disabled_sse_polls_without_event_source', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const stop = start(false)
    expect(FakeEventSource.instances).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(invalidate).toHaveBeenCalled()
    stop()
  })

  test('test_startLiveUpdates_disconnect_reconnect_polls_then_resynchronizes_active_queries', async () => {
    queryClient.setQueryData(['site', 'netbox', 'AMS1'], {})
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const statuses: string[] = []
    const stop = start(true, statuses)
    const source = FakeEventSource.instances[0]!
    source.onerror?.()
    await vi.advanceTimersByTimeAsync(60_000)
    source.onopen?.()
    expect(statuses).toEqual(['connecting', 'reconnecting', 'live'])
    expect(invalidate).toHaveBeenCalled()
    stop()
  })

  test('test_startLiveUpdates_reconnect_refreshes_active_index_and_marks_inactive_sites_stale', async () => {
    let deviceFetches = 0
    queryClient.setQueryData(['devices', 'netbox'], [])
    queryClient.setQueryData(['site', 'netbox', 'CDG1'], {})
    const observer = new QueryObserver(queryClient, {
      queryKey: ['devices', 'netbox'],
      queryFn: async () => { deviceFetches++; return [] },
      staleTime: Infinity,
    })
    const unsubscribe = observer.subscribe(() => {})
    const stop = start(true)
    const source = FakeEventSource.instances[0]!
    source.onopen?.()
    source.onerror?.()
    source.onopen?.()
    await vi.runAllTicks()
    expect(deviceFetches).toBe(1)
    expect(queryClient.getQueryState(['site', 'netbox', 'CDG1'])?.isInvalidated).toBe(true)
    unsubscribe()
    stop()
  })

  test('test_startLiveUpdates_hidden_reconnect_resynchronizes_when_visible', async () => {
    let fetches = 0
    queryClient.setQueryData(['site', 'netbox', 'AMS1'], {})
    const observer = new QueryObserver(queryClient, {
      queryKey: ['site', 'netbox', 'AMS1'],
      queryFn: async () => { fetches++; return {} },
      staleTime: Infinity,
    })
    const unsubscribe = observer.subscribe(() => {})
    const stop = start(true)
    const source = FakeEventSource.instances[0]!
    visible = false
    source.onerror?.()
    source.onopen?.()
    visible = true
    visibilityHandler?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetches).toBe(1)
    unsubscribe()
    stop()
  })

  test('test_startLiveUpdates_poll_refreshes_active_topology_queries_only', async () => {
    queryClient.setQueryData(['site', 'netbox', 'AMS1'], {})
    queryClient.setQueryData(['site', 'netbox', 'CDG1'], {})
    const observer = new QueryObserver(queryClient, { queryKey: ['site', 'netbox', 'AMS1'] })
    const unsubscribe = observer.subscribe(() => {})
    const active = queryClient.getQueryCache().find({ queryKey: ['site', 'netbox', 'AMS1'] })!
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const stop = start(false)
    await vi.advanceTimersByTimeAsync(60_000)
    const predicate = invalidate.mock.calls[0]![0]!.predicate!
    expect(predicate(active)).toBe(true)
    expect(predicate(queryClient.getQueryCache().find({ queryKey: ['site', 'netbox', 'CDG1'] })!)).toBe(false)
    unsubscribe()
    stop()
  })

  test('test_startLiveUpdates_hidden_document_skips_poll_until_visible', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    visible = false
    const stop = start(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(invalidate).not.toHaveBeenCalled()
    visible = true
    visibilityHandler?.()
    expect(invalidate).toHaveBeenCalled()
    stop()
  })

  test('test_startLiveUpdates_cleanup_closes_source_and_timers', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const stop = start(true)
    const source = FakeEventSource.instances[0]!
    source.onerror?.()
    stop()
    expect(source.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(invalidate).not.toHaveBeenCalled()
    expect(visibilityHandler).toBeUndefined()
  })
})
