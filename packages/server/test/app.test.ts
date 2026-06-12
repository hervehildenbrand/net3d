import { describe, expect, test } from 'vitest'
import type { SiteCircuit } from '@net3d/shared'
import { buildApp } from '../src/app'
import type { NetBoxClient, NetBoxSite, SiteRack } from '../src/netbox'

const SITES: NetBoxSite[] = [
  {
    id: '4',
    name: 'als',
    latitude: 52.259852,
    longitude: 4.773473,
    region: 'Amsterdam',
    status: 'ACTIVE',
  },
  { id: '1', name: 'aac', latitude: null, longitude: null, region: null, status: 'ACTIVE' },
]

const CIRCUITS: SiteCircuit[] = [
  { id: '315', cid: 'PA3-PAR1-pos1', provider: 'apo', siteA: 'pa3', siteZ: 'par1' },
  { id: '9', cid: 'PA3-PAR1-pos10', provider: 'apo', siteA: 'par1', siteZ: 'pa3' },
]

const RACKS: SiteRack[] = [
  {
    id: '376',
    name: 'C32-WAN1',
    uHeight: 47,
    location: null,
    devices: [
      {
        id: '1771',
        name: 'core-router-1',
        position: 20,
        face: 'FRONT',
        roleName: 'router_rtcore',
        roleColor: '9c27b0',
        uHeight: 1,
        model: 'ptx10001_36mr',
        manufacturer: 'Juniper',
        isFullDepth: true,
      },
    ],
  },
]

function fakeNetbox(overrides: Partial<NetBoxClient> = {}): NetBoxClient {
  return {
    getSites: async () => SITES,
    getCircuits: async () => CIRCUITS,
    getSiteRacks: async () => RACKS,
    ...overrides,
  }
}

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})

describe('GET /api/sites', () => {
  test('returns all sites from NetBox', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/sites' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(SITES)
  })

  test('caches: NetBox queried once across two requests', async () => {
    let calls = 0
    const app = buildApp({
      netbox: fakeNetbox({
        getSites: async () => {
          calls++
          return SITES
        },
      }),
    })
    await app.inject({ method: 'GET', url: '/api/sites' })
    await app.inject({ method: 'GET', url: '/api/sites' })
    expect(calls).toBe(1)
  })

  test('maps NetBox failure to 502', async () => {
    const app = buildApp({
      netbox: fakeNetbox({
        getSites: async () => {
          throw new Error('netbox down')
        },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/sites' })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: 'netbox_unavailable' })
  })
})

describe('GET /api/sites/:name', () => {
  test('returns racks with devices for the site', async () => {
    const requested: string[] = []
    const app = buildApp({
      netbox: fakeNetbox({
        getSiteRacks: async (site) => {
          requested.push(site)
          return RACKS
        },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/sites/als' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ racks: RACKS })
    expect(requested).toEqual(['als'])
  })

  test('caches per site name', async () => {
    let calls = 0
    const app = buildApp({
      netbox: fakeNetbox({
        getSiteRacks: async () => {
          calls++
          return RACKS
        },
      }),
    })
    await app.inject({ method: 'GET', url: '/api/sites/als' })
    await app.inject({ method: 'GET', url: '/api/sites/als' })
    await app.inject({ method: 'GET', url: '/api/sites/ams' })
    expect(calls).toBe(2)
  })

  test('maps NetBox failure to 502', async () => {
    const app = buildApp({
      netbox: fakeNetbox({
        getSiteRacks: async () => {
          throw new Error('boom')
        },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/sites/als' })
    expect(res.statusCode).toBe(502)
  })
})

describe('GET /api/circuits', () => {
  test('returns circuits grouped by site pair with counts', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/circuits' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      { siteA: 'pa3', siteZ: 'par1', count: 2, circuitIds: ['315', '9'] },
    ])
  })

  test('maps NetBox failure to 502', async () => {
    const app = buildApp({
      netbox: fakeNetbox({
        getCircuits: async () => {
          throw new Error('netbox down')
        },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/circuits' })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: 'netbox_unavailable' })
  })
})
