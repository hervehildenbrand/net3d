import { describe, expect, test, vi } from 'vitest'
import { TtlCache } from '../src/cache'
import type { CacheEntry, DiskCacheStore } from '../src/persistence'

/** In-memory stand-in for the disk store that records what it was asked to write. */
function fakeStore(initial: CacheEntry[] = []): DiskCacheStore & { writes: CacheEntry[] } {
  const writes: CacheEntry[] = []
  return {
    writes,
    write: async (key, value, expiresAt) => {
      writes.push({ key, value, expiresAt })
    },
    loadAllSync: () => initial,
    flush: async () => {},
  }
}

describe('TtlCache write-through', () => {
  test('set() write-through forwards value and computed expiry', () => {
    vi.useFakeTimers()
    const now = Date.now()
    const store = fakeStore()
    const cache = new TtlCache({ persist: store, shouldPersist: () => true })
    cache.set('site:AMS1', { racks: [1] }, 1000)
    expect(store.writes).toEqual([{ key: 'site:AMS1', value: { racks: [1] }, expiresAt: now + 1000 }])
    vi.useRealTimers()
  })

  test('set() persists only keys the predicate accepts', () => {
    const store = fakeStore()
    const cache = new TtlCache({ persist: store, shouldPersist: (k) => k.startsWith('site:') })
    cache.set('site:AMS1', 1, 1000)
    cache.set('napalm:1:get_facts', 2, 1000)
    cache.set('meta', 3, 1000)
    expect(store.writes.map((w) => w.key)).toEqual(['site:AMS1'])
  })

  test('without a store the cache behaves exactly as before', () => {
    const cache = new TtlCache()
    cache.set('k', 'v', 1000)
    expect(cache.get('k')).toBe('v')
  })
})

describe('TtlCache hydrate', () => {
  test('a hydrated past-expiry entry is served instantly and revalidates exactly once', async () => {
    vi.useFakeTimers()
    const store = fakeStore([{ key: 'site:AMS1', value: 'disk', expiresAt: Date.now() - 1 }])
    const cache = new TtlCache({ persist: store, shouldPersist: () => false })
    cache.hydrate()

    let calls = 0
    const fn = async () => `fresh${++calls}`
    const swr = { staleWhileRevalidate: true }

    // first post-restart hit: the stale disk value is served (not the fetched 'fresh1'),
    // proving the response did not block on a NetBox fetch
    expect(await cache.getOrSet('site:AMS1', 1000, fn, swr)).toBe('disk')

    await vi.runAllTimersAsync() // let the background refresh settle
    expect(calls).toBe(1) // exactly one revalidation
    expect(await cache.getOrSet('site:AMS1', 1000, fn, swr)).toBe('fresh1')
    vi.useRealTimers()
  })

  test('hydrate is a no-op when no store is configured', () => {
    const cache = new TtlCache()
    expect(() => cache.hydrate()).not.toThrow()
  })
})
