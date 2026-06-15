import { describe, expect, test } from 'vitest'
import type { SiteCircuit } from '@net3d/shared'
import { buildApp } from '../src/app'
import type { NetBoxClient, NetBoxSite, SiteRack } from '../src/netbox'
import type { SiteCable } from '../src/cables'

const SITE_META = {
  physicalAddress: null,
  facility: null,
  role: null,
  rackCount: null,
  deviceCount: null,
} as const

const SITES: NetBoxSite[] = [
  {
    id: '4',
    name: 'site-a',
    latitude: 52.259852,
    longitude: 4.773473,
    region: 'Region A',
    status: 'ACTIVE',
    ...SITE_META,
  },
  { id: '1', name: 'site-c', latitude: null, longitude: null, region: null, status: 'ACTIVE', ...SITE_META },
]

const CIRCUITS: SiteCircuit[] = [
  { id: '315', cid: 'PA3-PAR1-pos1', provider: 'apo', siteA: 'pa3', siteZ: 'par1',
    commitRate: 100_000_000, status: 'active', description: null },
  { id: '9', cid: 'PA3-PAR1-pos10', provider: 'apo', siteA: 'par1', siteZ: 'pa3',
    commitRate: 10_000_000, status: 'active', description: null },
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
        name: 'edge-router-1',
        position: 20,
        face: 'FRONT',
        roleName: 'router_rtcore',
        roleColor: '9c27b0',
        uHeight: 1,
        model: 'ptx10001_36mr',
        manufacturer: 'Juniper',
        isFullDepth: true,
        status: 'active',
        serial: null,
        assetTag: null,
        description: null,
        platform: null,
        primaryIp: null,
        oobIp: null,
      },
    ],
  },
]

const CABLES: SiteCable[] = [
  {
    id: '1',
    type: 'cat6',
    status: 'CONNECTED',
    color: '',
    a: { kind: 'device', name: 'eth1', deviceName: 'cn12001', rackName: 'compute_6' },
    b: { kind: 'device', name: 'Te0/1', deviceName: 'swm1001', rackName: 'compute_6' },
  },
]

function fakeNetbox(overrides: Partial<NetBoxClient> = {}): NetBoxClient {
  return {
    getSites: async () => SITES,
    getCircuits: async () => CIRCUITS,
    getSiteRacks: async () => RACKS,
    getSiteCables: async () => CABLES,
    getSitePower: async () => ({ panels: [], feeds: [] }),
    napalm: async (_id, method) => ({ [method]: {} }),
    getStatus: async () => ({ backend: 'netbox', version: '3.7.8', napalmAvailable: true }),
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

describe('GET /api/meta', () => {
  test('reports backend, version and NAPALM availability', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/meta' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ backend: 'netbox', version: '3.7.8', napalmAvailable: true })
  })

  test('degrades to no-capabilities instead of failing when the backend is down', async () => {
    const app = buildApp({
      netbox: fakeNetbox({
        getStatus: async () => {
          throw new Error('down')
        },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/meta' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ backend: 'netbox', version: null, napalmAvailable: false })
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
    const res = await app.inject({ method: 'GET', url: '/api/sites/site-a' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ racks: RACKS, cables: CABLES, power: { panels: [], feeds: [] } })
    expect(requested).toEqual(['site-a'])
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
    await app.inject({ method: 'GET', url: '/api/sites/site-a' })
    await app.inject({ method: 'GET', url: '/api/sites/site-a' })
    await app.inject({ method: 'GET', url: '/api/sites/site-b' })
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
    const res = await app.inject({ method: 'GET', url: '/api/sites/site-a' })
    expect(res.statusCode).toBe(502)
  })
})

describe('GET /api/circuits', () => {
  test('returns circuits grouped by site pair with counts', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/circuits' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      {
        siteA: 'pa3',
        siteZ: 'par1',
        count: 2,
        circuitIds: ['315', '9'],
        circuits: CIRCUITS,
        maxCommitRate: 100_000_000,
      },
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
