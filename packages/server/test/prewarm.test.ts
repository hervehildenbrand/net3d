import { describe, expect, test } from 'vitest'
import { TtlCache } from '../src/cache'
import { prewarmCaches } from '../src/prewarm'
import type { NetBoxClient } from '../src/netbox'

const TTL = { sites: 1000, circuits: 1000, siteDetail: 1000 }

const SITE_META = {
  region: null, status: 'active', physicalAddress: null, facility: null,
  role: null, rackCount: null, deviceCount: null,
} as const

function mockNetbox(overrides: Partial<NetBoxClient> = {}): NetBoxClient {
  return {
    getSites: async () => [
      { id: '1', name: 'AAA1', latitude: 0, longitude: 0, ...SITE_META },
      { id: '2', name: 'BBB1', latitude: 0, longitude: 0, ...SITE_META },
    ],
    getCircuits: async () => [],
    getSiteRacks: async () => [],
    getSiteCables: async () => [],
    napalm: async () => ({}),
    getStatus: async () => ({ netboxVersion: '4.6.0', napalmAvailable: false }),
    ...overrides,
  } as NetBoxClient
}

describe('prewarmCaches', () => {
  test('warms sites, circuits and every site detail', async () => {
    const cache = new TtlCache()
    await prewarmCaches(cache, mockNetbox(), TTL)
    expect(cache.get('sites')).toBeDefined()
    expect(cache.get('circuits')).toBeDefined()
    expect(cache.get('site:AAA1')).toEqual({ racks: [], cables: [] })
    expect(cache.get('site:BBB1')).toEqual({ racks: [], cables: [] })
  })

  test('caps concurrent site fetches', async () => {
    const cache = new TtlCache()
    let inFlight = 0
    let maxInFlight = 0
    const netbox = mockNetbox({
      getSites: async () =>
        ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({
          id: String(i), name: n, latitude: 0, longitude: 0, ...SITE_META,
        })),
      getSiteRacks: async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return []
      },
    })
    await prewarmCaches(cache, netbox, TTL, 2)
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(cache.get('site:E')).toBeDefined()
  })

  test('a failing site does not abort the rest', async () => {
    const cache = new TtlCache()
    const netbox = mockNetbox({
      getSiteRacks: async (site: string) => {
        if (site === 'AAA1') throw new Error('boom')
        return []
      },
    })
    await prewarmCaches(cache, netbox, TTL)
    expect(cache.get('site:AAA1')).toBeUndefined()
    expect(cache.get('site:BBB1')).toBeDefined()
  })

  test('refreshes existing entries in place (no eviction window)', async () => {
    const cache = new TtlCache()
    cache.set('site:AAA1', { racks: ['old'], cables: [] }, 60_000)
    await prewarmCaches(cache, mockNetbox(), TTL)
    expect(cache.get('site:AAA1')).toEqual({ racks: [], cables: [] })
  })
})
