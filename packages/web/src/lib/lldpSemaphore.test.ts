import { describe, expect, test, vi } from 'vitest'
import { LldpSemaphore, withLldpSlot } from './lldpSemaphore'

describe('LldpSemaphore', () => {
  test('test_acquire_pre_aborted_request_rejects_without_consuming_slot', async () => {
    const semaphore = new LldpSemaphore(1)
    const aborted = new AbortController()
    aborted.abort()

    await expect(semaphore.acquire(aborted.signal)).rejects.toHaveProperty('name', 'AbortError')

    const release = await semaphore.acquire(new AbortController().signal)
    release()
  })

  test('test_release_active_request_hands_slot_to_waiter', async () => {
    const semaphore = new LldpSemaphore(1)
    const releaseFirst = await semaphore.acquire(new AbortController().signal)
    let admitted = false
    const second = semaphore.acquire(new AbortController().signal).then((release) => {
      admitted = true
      return release
    })

    await Promise.resolve()
    expect(admitted).toBe(false)
    releaseFirst()

    const releaseSecond = await second
    expect(admitted).toBe(true)
    releaseSecond()
  })

  test('test_acquire_aborted_waiter_is_removed_before_next_handoff', async () => {
    const semaphore = new LldpSemaphore(1)
    const releaseFirst = await semaphore.acquire(new AbortController().signal)
    const abandoned = new AbortController()
    const queued = semaphore.acquire(abandoned.signal)

    abandoned.abort()
    await expect(queued).rejects.toHaveProperty('name', 'AbortError')
    releaseFirst()

    const releaseNext = await semaphore.acquire(new AbortController().signal)
    releaseNext()
  })

  test('test_release_called_twice_frees_slot_once', async () => {
    const semaphore = new LldpSemaphore(1)
    const releaseFirst = await semaphore.acquire(new AbortController().signal)
    const second = semaphore.acquire(new AbortController().signal)

    releaseFirst()
    releaseFirst()
    const releaseSecond = await second
    let thirdAdmitted = false
    const third = semaphore.acquire(new AbortController().signal).then((release) => {
      thirdAdmitted = true
      return release
    })

    await Promise.resolve()
    expect(thirdAdmitted).toBe(false)
    releaseSecond()
    const releaseThird = await third
    releaseThird()
  })
})

describe('withLldpSlot', () => {
  test('test_withLldpSlot_success_returns_request_value', async () => {
    await expect(
      withLldpSlot(new AbortController().signal, async () => 'neighbors'),
    ).resolves.toBe('neighbors')
  })

  test('test_withLldpSlot_failed_request_releases_slot', async () => {
    const failure = new Error('request failed')
    await expect(
      withLldpSlot(new AbortController().signal, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)

    const request = vi.fn(async () => 'next')
    await expect(withLldpSlot(new AbortController().signal, request)).resolves.toBe('next')
    expect(request).toHaveBeenCalledOnce()
  })
})
