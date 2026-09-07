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

  test('test_getOrSet_concurrent_misses_share_one_load', async () => {
    const cache = new TtlCache()
    let release!: (value: string) => void
    let calls = 0
    const fn = () => {
      calls++
      return new Promise<string>((resolve) => (release = resolve))
    }

    const first = cache.getOrSet('k', 1000, fn)
    const second = cache.getOrSet('k', 1000, fn)
    expect(calls).toBe(1)
    release('value')
    await expect(Promise.all([first, second])).resolves.toEqual(['value', 'value'])
  })

  test('test_refresh_existing_load_shares_one_operation', async () => {
    const cache = new TtlCache()
    let release!: (value: string) => void
    let calls = 0
    const fn = () => {
      calls++
      return new Promise<string>((resolve) => (release = resolve))
    }

    const foreground = cache.getOrSet('k', 1000, fn)
    const prewarm = cache.refresh('k', 1000, fn)
    expect(calls).toBe(1)
    release('value')
    await expect(Promise.all([foreground, prewarm])).resolves.toEqual(['value', 'value'])
  })

  test('test_delete_pending_load_prevents_obsolete_publish_and_clear', async () => {
    const cache = new TtlCache()
    let releaseOld!: (value: string) => void
    let releaseNew!: (value: string) => void
    let newCalls = 0
    const oldLoad = cache.getOrSet('k', 1000, () => new Promise<string>((resolve) => (releaseOld = resolve)))

    cache.delete('k')
    const loadCurrent = () => {
      newCalls++
      return new Promise<string>((resolve) => (releaseNew = resolve))
    }
    const newLoad = cache.getOrSet('k', 1000, loadCurrent)
    releaseOld('obsolete')
    await expect(oldLoad).resolves.toBe('obsolete')
    expect(cache.peek('k')).toBeUndefined()

    const joinedNewLoad = cache.getOrSet('k', 1000, loadCurrent)
    expect(newCalls).toBe(1)
    releaseNew('current')
    await expect(Promise.all([newLoad, joinedNewLoad])).resolves.toEqual(['current', 'current'])
    expect(cache.get('k')).toBe('current')
  })

  test('test_keys_pending_load_includes_pending_key_for_invalidation', async () => {
    const cache = new TtlCache()
    let release!: (value: string) => void
    const load = cache.getOrSet('site:AMS1', 1000, () => new Promise<string>((resolve) => (release = resolve)))
    expect([...cache.keys()]).toContain('site:AMS1')
    cache.delete('site:AMS1')
    release('obsolete')
    await load
    expect(cache.peek('site:AMS1')).toBeUndefined()
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

describe('TtlCache delete', () => {
  test('removes an existing key', () => {
    const cache = new TtlCache()
    cache.set('k', 'v', 10_000)
    cache.delete('k')
    expect(cache.get('k')).toBeUndefined()
    expect(cache.peek('k')).toBeUndefined()
  })

  test('is a no-op on a missing key', () => {
    const cache = new TtlCache()
    expect(() => cache.delete('nope')).not.toThrow()
  })
})

describe('TtlCache keys', () => {
  test('lists all stored keys including stale ones', () => {
    const cache = new TtlCache()
    cache.set('a', 1, 10_000)
    cache.set('site:AMS1', 2, -1) // already expired — still listed
    expect([...cache.keys()].sort()).toEqual(['a', 'site:AMS1'])
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
