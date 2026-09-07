import { afterEach, describe, expect, test, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fetchLldp, LldpSemaphore } from './useLldpDiscovery'
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
