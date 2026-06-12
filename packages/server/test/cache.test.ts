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
