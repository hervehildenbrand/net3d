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
  { id: '315', cid: 'FRA1-PAR1-001', provider: 'acme', siteA: 'fra1', siteZ: 'par1',
    commitRate: 100_000_000, status: 'active', description: null },
  { id: '9', cid: 'FRA1-PAR1-010', provider: 'acme', siteA: 'par1', siteZ: 'fra1',
    commitRate: 10_000_000, status: 'active', description: null },
]

const RACKS: SiteRack[] = [
  {
    id: '376',
    name: 'rack-a01',
    uHeight: 47,
    location: null,
    devices: [
      {
        id: '1771',
        name: 'edge-router-1',
        position: 20,
        face: 'FRONT',
        roleName: 'router_core',
        roleColor: '9c27b0',
        uHeight: 1,
        model: 'mx304',
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
    a: { kind: 'device', name: 'eth1', deviceName: 'srv-c06-01', rackName: 'rack-c06', ifaceType: '25gbase-x-sfp28', termType: 'interface', pairedPort: null },
    b: { kind: 'device', name: 'Te0/1', deviceName: 'mgmt-sw1', rackName: 'rack-c06', ifaceType: '25gbase-x-sfp28', termType: 'interface', pairedPort: null },
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
    expect(res.json()).toEqual({ backend: 'netbox', version: '3.7.8', napalmAvailable: true, layoutEditable: false, layoutPreview: false, liveUpdatesAvailable: false })
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
    expect(res.json()).toEqual({ backend: 'netbox', version: null, napalmAvailable: false, layoutEditable: false, layoutPreview: false, liveUpdatesAvailable: false })
  })

  test('test_meta_webhooks_enabled_reports_live_updates_available', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webhookSecret: 'secret' })
    const res = await app.inject({ method: 'GET', url: '/api/meta' })
    expect(res.json().liveUpdatesAvailable).toBe(true)
  })

  test('test_meta_netstatex_configured_reports_telemetry_available', async () => {
    const app = buildApp({ netbox: fakeNetbox(), netstatex: { deviceNames: async () => [], interfaces: async () => ({}), topology: async () => ({ facts: [], nodeSids: {} }) } })
    const res = await app.inject({ method: 'GET', url: '/api/meta' })
    expect(res.json().telemetryAvailable).toBe(true)
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
        siteA: 'fra1',
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

describe('GET /api/devices', () => {
  test('test_device_index_complete_cache_returns_array_and_coverage_headers', async () => {
    let rackCalls = 0
    const app = buildApp({
      netbox: fakeNetbox({
        getSiteRacks: async () => {
          rackCalls++
          return RACKS
        },
      }),
    })
    // Warm the per-site detail cache the way the prewarm loop / a site visit does.
    await app.inject({ method: 'GET', url: '/api/sites/site-a' })
    await app.inject({ method: 'GET', url: '/api/sites/site-c' })
    const warmCalls = rackCalls // 2

    const res = await app.inject({ method: 'GET', url: '/api/devices' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-indexed-sites']).toBe('2')
    expect(res.headers['x-total-sites']).toBe('2')
    expect(res.headers['x-prewarm-enabled']).toBe('false')
    const index = res.json() as Array<{ siteName: string }>
    expect(index).toHaveLength(2) // one device per warmed site
    expect(index).toContainEqual({
      id: '1771',
      name: 'edge-router-1',
      siteName: 'site-a',
      rackId: '376',
      rackName: 'rack-a01',
      position: 20,
      roleName: 'router_core',
      roleColor: '9c27b0',
      model: 'mx304',
      status: 'active',
    })
    expect(index.map((e) => e.siteName).sort()).toEqual(['site-a', 'site-c'])
    // The index must NOT trigger any further site-detail loads — it only reads cache.
    expect(rackCalls).toBe(warmCalls)
  })

  test('test_device_index_cold_cache_returns_empty_array_and_zero_coverage', async () => {
    let rackCalls = 0
    const app = buildApp({
      netbox: fakeNetbox({
        getSiteRacks: async () => {
          rackCalls++
          return RACKS
        },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/devices' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
    expect(res.headers['x-indexed-sites']).toBe('0')
    expect(res.headers['x-total-sites']).toBe('2')
    expect(res.headers['x-prewarm-enabled']).toBe('false')
    // Crucially: it never loads (a single slow/cold site must not hang the request).
    expect(rackCalls).toBe(0)
  })

  test('test_device_index_partial_cache_counts_only_successful_site_loads', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    await app.inject({ method: 'GET', url: '/api/sites/site-a' })

    const res = await app.inject({ method: 'GET', url: '/api/devices' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
    expect(res.headers['x-indexed-sites']).toBe('1')
    expect(res.headers['x-total-sites']).toBe('2')
  })

  test('test_device_index_failed_site_load_remains_incomplete', async () => {
    const app = buildApp({
      netbox: fakeNetbox({
        getSiteRacks: async (site) => {
          if (site === 'site-c') throw new Error('site unavailable')
          return RACKS
        },
      }),
    })
    await app.inject({ method: 'GET', url: '/api/sites/site-a' })
    expect((await app.inject({ method: 'GET', url: '/api/sites/site-c' })).statusCode).toBe(502)

    const res = await app.inject({ method: 'GET', url: '/api/devices' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-indexed-sites']).toBe('1')
    expect(res.headers['x-total-sites']).toBe('2')
  })

  test('test_device_index_prewarm_configuration_is_reported', async () => {
    const app = buildApp({ netbox: fakeNetbox(), prewarm: { intervalMs: 0 } })
    const res = await app.inject({ method: 'GET', url: '/api/devices' })
    expect(res.headers['x-prewarm-enabled']).toBe('true')
  })

  test('test_device_index_sites_failure_returns_502', async () => {
    const app = buildApp({
      netbox: fakeNetbox({
        getSites: async () => {
          throw new Error('netbox down')
        },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/devices' })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: 'netbox_unavailable' })
  })
})
