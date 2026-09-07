import { afterEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import {
  combineLldpResults,
  fetchLldp,
  LldpSemaphore,
  retryFailedLldp,
} from './useLldpDiscovery'
import { fetchNapalm } from './useNapalm'

describe('LldpSemaphore', () => {
  test('test_acquire_four_requests_limits_concurrency_to_three', async () => {
    const semaphore = new LldpSemaphore(3)
    const first = await semaphore.acquire(new AbortController().signal)
    const second = await semaphore.acquire(new AbortController().signal)
    const third = await semaphore.acquire(new AbortController().signal)
    let fourthStarted = false
    const fourth = semaphore.acquire(new AbortController().signal).then((release) => {
      fourthStarted = true
      return release
    })

    await Promise.resolve()
    expect(fourthStarted).toBe(false)

    first()
    const fourthRelease = await fourth
    expect(fourthStarted).toBe(true)

    second()
    third()
    fourthRelease()
  })

  test('test_acquire_queued_request_aborted_removes_waiter_without_starting', async () => {
    const semaphore = new LldpSemaphore(1)
    const releaseFirst = await semaphore.acquire(new AbortController().signal)
    const abandoned = new AbortController()
    let abandonedStarted = false
    const queued = semaphore.acquire(abandoned.signal).then(() => {
      abandonedStarted = true
    })

    abandoned.abort()
    await expect(queued).rejects.toHaveProperty('name', 'AbortError')
    releaseFirst()
    const releaseNext = await semaphore.acquire(new AbortController().signal)

    expect(abandonedStarted).toBe(false)
    releaseNext()
  })

  test('test_release_granted_request_called_twice_releases_slot_once', async () => {
    const semaphore = new LldpSemaphore(1)
    const releaseFirst = await semaphore.acquire(new AbortController().signal)
    const releaseSecondPromise = semaphore.acquire(new AbortController().signal)

    releaseFirst()
    releaseFirst()
    const releaseSecond = await releaseSecondPromise
    let thirdStarted = false
    const third = semaphore.acquire(new AbortController().signal).then((release) => {
      thirdStarted = true
      return release
    })

    await Promise.resolve()
    expect(thirdStarted).toBe(false)
    releaseSecond()
    const releaseThird = await third
    releaseThird()
  })
})

describe('fetchLldp', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('test_fetchLldp_running_request_aborted_passes_signal_to_fetch', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason)
            return
          }
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
      ),
    )

    const request = fetchLldp('netbox', { id: 'leaf-1', name: 'leaf-1' }, controller.signal)
    controller.abort()

    await expect(request).rejects.toHaveProperty('name', 'AbortError')
  })

  test('test_fetchLldp_admitted_abort_hands_slot_to_shared_napalm_waiter_once', async () => {
    let active = 0
    let maxActive = 0
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      active++
      maxActive = Math.max(maxActive, active)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            active--
            reject(init.signal?.reason)
          },
          { once: true },
        )
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const controllers = Array.from({ length: 5 }, () => new AbortController())
    const requests = controllers
      .slice(0, 3)
      .map((controller, i) =>
        fetchLldp('netbox', { id: `leaf-${i}`, name: `leaf-${i}` }, controller.signal),
      )
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    const panelRequest = fetchNapalm(
      'netbox',
      'leaf-panel',
      'get_lldp_neighbors',
      controllers[3]!.signal,
    )
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    controllers[0]!.abort()
    await expect(requests[0]).rejects.toHaveProperty('name', 'AbortError')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    const fifthRequest = fetchLldp(
      'netbox',
      { id: 'leaf-5', name: 'leaf-5' },
      controllers[4]!.signal,
    )
    controllers[0]!.abort()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(4)

    controllers[1]!.abort()
    await expect(requests[1]).rejects.toHaveProperty('name', 'AbortError')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    expect(maxActive).toBe(3)

    controllers.slice(2).forEach((controller) => controller.abort())
    await Promise.allSettled([requests[2], panelRequest, fifthRequest])
  })

  test('test_fetchLldp_cancelled_refetch_preserves_successful_query_cache', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const key = ['napalm', 'netbox', 'leaf-1', 'get_lldp_neighbors'] as const
    const cached = { Ethernet1: [{ hostname: 'spine-1', port: 'Ethernet1' }] }
    queryClient.setQueryData(key, cached, { updatedAt: 1 })
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
      ),
    )

    const refetch = queryClient.fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => fetchLldp('netbox', { id: 'leaf-1', name: 'leaf-1' }, signal),
      staleTime: 0,
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await queryClient.cancelQueries({ queryKey: key })
    await expect(refetch).resolves.toEqual(cached)

    expect(queryClient.getQueryData(key)).toEqual(cached)
    queryClient.clear()
  })
})

describe('combineLldpResults', () => {
  const devices = [
    { id: 'leaf-1', name: 'leaf-1' },
    { id: 'leaf-2', name: 'leaf-2' },
    { id: 'leaf-3', name: 'leaf-3' },
  ]
  const success = (data: Record<string, never[]> = {}) => ({
    data,
    isSuccess: true,
    isError: false,
    isFetching: false,
  })
  const failure = (data?: Record<string, never[]>) => ({
    data,
    isSuccess: false,
    isError: true,
    isFetching: false,
  })
  const pending = () => ({
    data: undefined,
    isSuccess: false,
    isError: false,
    isFetching: true,
  })

  test('test_combineLldpResults_all_active_failed_reports_incomplete_coverage', () => {
    const result = combineLldpResults(devices, new Set(devices.map((d) => d.id)), [
      failure(),
      failure(),
      failure(),
    ])

    expect(result).toMatchObject({
      successful: 0,
      failed: 3,
      pending: 0,
      failedDeviceIds: ['leaf-1', 'leaf-2', 'leaf-3'],
      completed: 3,
      total: 3,
      discovering: false,
    })
  })

  test('test_combineLldpResults_mixed_results_counts_each_active_state', () => {
    const stale = { Ethernet1: [] }
    const result = combineLldpResults(devices, new Set(devices.map((d) => d.id)), [
      success(),
      failure(stale),
      pending(),
    ])

    expect(result).toMatchObject({
      successful: 1,
      failed: 1,
      pending: 1,
      failedDeviceIds: ['leaf-2'],
      completed: 2,
      total: 3,
      discovering: true,
    })
    expect(result.byDevice['leaf-2']).toBe(stale)
  })

  test('test_combineLldpResults_failed_refetch_with_stale_data_reports_failed', () => {
    const stale = { Ethernet1: [] }
    const result = combineLldpResults([devices[0]!], new Set(['leaf-1']), [failure(stale)])

    expect(result).toMatchObject({ successful: 0, failed: 1, pending: 0 })
    expect(result.byDevice['leaf-1']).toBe(stale)
  })

  test('test_combineLldpResults_retrying_failure_moves_it_to_pending', () => {
    const result = combineLldpResults([devices[0]!], new Set(['leaf-1']), [
      { ...failure(), isFetching: true },
    ])

    expect(result).toMatchObject({ successful: 0, failed: 0, pending: 1, completed: 0 })
  })

  test('test_combineLldpResults_inactive_cached_success_stays_in_byDevice_only', () => {
    const cached = { Ethernet1: [] }
    const result = combineLldpResults(devices.slice(0, 2), new Set(['leaf-1']), [
      success(),
      success(cached),
    ])

    expect(result).toMatchObject({ successful: 1, failed: 0, pending: 0, total: 1 })
    expect(result.byDevice['leaf-2']).toBe(cached)
  })
})

describe('retryFailedLldp', () => {
  test('test_retryFailedLldp_failed_active_ids_retries_only_matching_backend', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const calls = new Map<string, number>()
    const observe = (backend: 'netbox' | 'infrahub', id: string, enabled = true) => {
      const key = ['napalm', backend, id, 'get_lldp_neighbors'] as const
      const observer = new QueryObserver(queryClient, {
        queryKey: key,
        queryFn: async () => {
          calls.set(`${backend}:${id}`, (calls.get(`${backend}:${id}`) ?? 0) + 1)
          throw new Error('unreachable')
        },
        enabled,
        retry: false,
      })
      const unsubscribe = observer.subscribe(() => undefined)
      return unsubscribe
    }
    const unsubscribers = [
      observe('netbox', 'failed-active'),
      observe('netbox', 'successful-active'),
      observe('netbox', 'failed-inactive', false),
      observe('infrahub', 'failed-active'),
    ]
    await vi.waitFor(() => expect(calls.get('netbox:failed-active')).toBe(1))
    await vi.waitFor(() => expect(calls.get('netbox:successful-active')).toBe(1))
    await vi.waitFor(() => expect(calls.get('infrahub:failed-active')).toBe(1))
    queryClient.setQueryData(
      ['napalm', 'netbox', 'successful-active', 'get_lldp_neighbors'],
      { Ethernet1: [] },
    )

    await retryFailedLldp(queryClient, 'netbox', ['failed-active', 'failed-inactive'])

    expect(calls.get('netbox:failed-active')).toBe(2)
    expect(calls.get('netbox:successful-active')).toBe(1)
    expect(calls.get('netbox:failed-inactive')).toBeUndefined()
    expect(calls.get('infrahub:failed-active')).toBe(1)
    expect(
      queryClient.getQueryData(['napalm', 'netbox', 'successful-active', 'get_lldp_neighbors']),
    ).toEqual({ Ethernet1: [] })
    unsubscribers.forEach((unsubscribe) => unsubscribe())
    queryClient.clear()
  })
})
