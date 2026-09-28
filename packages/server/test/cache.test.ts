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

  test('caps concurrent background refreshes so extra stale hits skip starting a new load', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    const swr = { staleWhileRevalidate: true }
    const keys = ['a', 'b', 'c', 'd', 'e']
    for (const key of keys) cache.set(key, `${key}-stale`, 1000)
    vi.advanceTimersByTime(1001)

    let loaderCalls = 0
    const releases: Array<(value: string) => void> = []
    const fn = () => {
      loaderCalls++
      return new Promise<string>((resolve) => releases.push(resolve))
    }

    const results = await Promise.all(keys.map((key) => cache.getOrSet(key, 1000, fn, swr)))

    expect(results).toEqual(keys.map((key) => `${key}-stale`))
    expect(loaderCalls).toBe(2) // MAX_BACKGROUND_REFRESHES, not one per stale key

    releases.forEach((release) => release('done'))
    await vi.runAllTimersAsync()
    vi.useRealTimers()
  })

  test('releases the background-refresh budget after each load settles, success or failure', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    const swr = { staleWhileRevalidate: true }
    cache.set('a', 'a-stale', 1000)
    cache.set('b', 'b-stale', 1000)
    cache.set('c', 'c-stale', 1000)
    cache.set('d', 'd-stale', 1000)
    vi.advanceTimersByTime(1001)

    let releaseA!: (value: string) => void
    let rejectB!: (err: Error) => void
    let cCalls = 0
    let dCalls = 0
    const fnA = () => new Promise<string>((resolve) => (releaseA = resolve))
    const fnB = () => new Promise<string>((_resolve, reject) => (rejectB = reject))
    // c and d never resolve — only whether their loader was invoked matters here
    const fnC = () => {
      cCalls++
      return new Promise<string>(() => {})
    }
    const fnD = () => {
      dCalls++
      return new Promise<string>(() => {})
    }

    expect(await cache.getOrSet('a', 1000, fnA, swr)).toBe('a-stale')
    expect(await cache.getOrSet('b', 1000, fnB, swr)).toBe('b-stale')
    // budget exhausted by a and b: neither c's nor d's background load starts yet
    expect(await cache.getOrSet('c', 1000, fnC, swr)).toBe('c-stale')
    expect(await cache.getOrSet('d', 1000, fnD, swr)).toBe('d-stale')
    expect(cCalls).toBe(0)
    expect(dCalls).toBe(0)

    // settle one at a time, so each probe isolates a single path's decrement
    releaseA('a-fresh')
    await vi.runAllTimersAsync() // flush a's success settle + finally microtasks

    expect(await cache.getOrSet('c', 1000, fnC, swr)).toBe('c-stale')
    expect(cCalls).toBe(1) // the success path freed a's slot for c
    expect(dCalls).toBe(0) // ...but only one slot freed — d still waits

    rejectB(new Error('boom'))
    await vi.runAllTimersAsync() // flush b's failure settle + finally microtasks

    expect(await cache.getOrSet('d', 1000, fnD, swr)).toBe('d-stale')
    expect(dCalls).toBe(1) // the failure path freed b's slot for d — proves both paths decrement

    vi.useRealTimers()
  })

  test('a loader that throws synchronously does not leak the background-refresh budget', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    const swr = { staleWhileRevalidate: true }
    cache.set('x', 'x-stale', 1000)
    cache.set('e', 'e-stale', 1000)
    cache.set('f', 'f-stale', 1000)
    vi.advanceTimersByTime(1001)

    const throwingFn = () => {
      throw new Error('sync boom')
    }
    // current contract: a synchronous throw on the SWR path propagates as a rejection
    await expect(cache.getOrSet('x', 1000, throwingFn, swr)).rejects.toThrow('sync boom')

    let calls = 0
    const releases: Array<(value: string) => void> = []
    const fn = () => {
      calls++
      return new Promise<string>((resolve) => releases.push(resolve))
    }

    expect(await cache.getOrSet('e', 1000, fn, swr)).toBe('e-stale')
    expect(await cache.getOrSet('f', 1000, fn, swr)).toBe('f-stale')
    expect(calls).toBe(2) // the earlier sync throw must not have claimed a budget slot forever

    releases.forEach((release) => release('done'))
    await vi.runAllTimersAsync()
    vi.useRealTimers()
  })

  test('a key already loading via refresh() (e.g. the prewarm) does not consume the background-refresh budget', async () => {
    vi.useFakeTimers()
    const cache = new TtlCache()
    const swr = { staleWhileRevalidate: true }
    cache.set('pending1', 'pending1-stale', 1000)
    cache.set('pending2', 'pending2-stale', 1000)
    cache.set('c', 'c-stale', 1000)
    cache.set('d', 'd-stale', 1000)
    vi.advanceTimersByTime(1001)

    let pendingCalls = 0
    const releases: Array<(value: string) => void> = []
    const pendingFn = () => {
      pendingCalls++
      return new Promise<string>((resolve) => releases.push(resolve))
    }
    // simulate the prewarm: pending loads started directly via refresh(), not getOrSet
    void cache.refresh('pending1', 1000, pendingFn)
    void cache.refresh('pending2', 1000, pendingFn)
    expect(pendingCalls).toBe(2)

    let cdCalls = 0
    const cdFn = () => {
      cdCalls++
      return new Promise<string>((resolve) => releases.push(resolve))
    }

    expect(await cache.getOrSet('pending1', 1000, pendingFn, swr)).toBe('pending1-stale')
    expect(await cache.getOrSet('pending2', 1000, pendingFn, swr)).toBe('pending2-stale')
    expect(pendingCalls).toBe(2) // SWR did not call the loader again for the pending keys

    expect(await cache.getOrSet('c', 1000, cdFn, swr)).toBe('c-stale')
    expect(await cache.getOrSet('d', 1000, cdFn, swr)).toBe('d-stale')
    expect(cdCalls).toBe(2) // budget wasn't consumed by the pending keys, so both start

    releases.forEach((release) => release('done'))
    await vi.runAllTimersAsync()
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
