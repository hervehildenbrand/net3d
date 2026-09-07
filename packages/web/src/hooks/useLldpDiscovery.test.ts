import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchLldp, LldpSemaphore } from './useLldpDiscovery'

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
})
