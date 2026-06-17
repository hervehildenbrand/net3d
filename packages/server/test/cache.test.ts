import { describe, expect, test, vi } from 'vitest'
import { TtlCache } from '../src/cache'

describe('TtlCache', () => {
  test('returns stored value before ttl expires', () => {
    const cache = new TtlCache()
    cache.set('k', { a: 1 }, 1000)
    expect(cache.get('k')).toEqual({ a: 1 })
  })

  test('returns undefined for missing key', () => {
    const cache = new TtlCache()
    expect(cache.get('nope')).toBeUndefined()
  })

  test('expires value after ttl', () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    cache.set('k', 'v', 1000)
    vi.advanceTimersByTime(1001)
    expect(cache.get('k')).toBeUndefined()
    vi.useRealTimers()
  })

  test('getOrSet computes once and serves cached value within ttl', async () => {
    const cache = new TtlCache()
    let calls = 0
    const fn = async () => {
      calls++
      return 'computed'
    }
    expect(await cache.getOrSet('k', 1000, fn)).toBe('computed')
    expect(await cache.getOrSet('k', 1000, fn)).toBe('computed')
    expect(calls).toBe(1)
  })

  test('getOrSet does not cache rejected promises', async () => {
    const cache = new TtlCache()
    let calls = 0
    const fn = async () => {
      calls++
      if (calls === 1) throw new Error('boom')
      return 'ok'
    }
    await expect(cache.getOrSet('k', 1000, fn)).rejects.toThrow('boom')
    expect(await cache.getOrSet('k', 1000, fn)).toBe('ok')
  })
})

describe('TtlCache peek', () => {
  test('returns the value even after ttl expiry, and does not evict it', () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    cache.set('k', { a: 1 }, 1000)
    vi.advanceTimersByTime(1001)
    // get() would enforce the TTL (evict + undefined); peek serves the stale value
    expect(cache.peek('k')).toEqual({ a: 1 })
    // ...and keeps it — repeated peeks still see it (no hard-TTL hole).
    expect(cache.peek('k')).toEqual({ a: 1 })
    vi.useRealTimers()
  })

  test('returns undefined for a missing key', () => {
    const cache = new TtlCache()
    expect(cache.peek('nope')).toBeUndefined()
  })
})

describe('TtlCache stale-while-revalidate', () => {
  test('serves the stale value instantly after ttl and refreshes in background', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    let calls = 0
    const fn = async () => `v${++calls}`
    const swr = { staleWhileRevalidate: true }

    expect(await cache.getOrSet('k', 1000, fn, swr)).toBe('v1')
    vi.advanceTimersByTime(1001)
    // stale hit: old value served, refresh kicked off in the background
    expect(await cache.getOrSet('k', 1000, fn, swr)).toBe('v1')
    await vi.runAllTimersAsync() // let the background refresh settle
    expect(await cache.getOrSet('k', 1000, fn, swr)).toBe('v2')
    expect(calls).toBe(2)
    vi.useRealTimers()
  })

  test('concurrent stale hits trigger a single background refresh', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    let calls = 0
    const fn = async () => `v${++calls}`
    const swr = { staleWhileRevalidate: true }

    await cache.getOrSet('k', 1000, fn, swr)
    vi.advanceTimersByTime(1001)
    await Promise.all([
      cache.getOrSet('k', 1000, fn, swr),
      cache.getOrSet('k', 1000, fn, swr),
      cache.getOrSet('k', 1000, fn, swr),
    ])
    await vi.runAllTimersAsync()
    expect(calls).toBe(2) // initial + one refresh, not three
    vi.useRealTimers()
  })

  test('background refresh failure keeps serving the stale value', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    let calls = 0
    const fn = async () => {
      calls++
      if (calls > 1) throw new Error('netbox down')
      return 'v1'
    }
    const swr = { staleWhileRevalidate: true }

    await cache.getOrSet('k', 1000, fn, swr)
    vi.advanceTimersByTime(1001)
    expect(await cache.getOrSet('k', 1000, fn, swr)).toBe('v1')
    await vi.runAllTimersAsync()
    // refresh failed -> stale value still served, next hit retries
    expect(await cache.getOrSet('k', 1000, fn, swr)).toBe('v1')
    vi.useRealTimers()
  })

  test('plain getOrSet keeps strict expiry semantics (no stale serves)', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    let calls = 0
    const fn = async () => `v${++calls}`
    await cache.getOrSet('k', 1000, fn)
    vi.advanceTimersByTime(1001)
    expect(await cache.getOrSet('k', 1000, fn)).toBe('v2')
    vi.useRealTimers()
  })
})
