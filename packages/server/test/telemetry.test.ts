import { afterEach, describe, expect, test, vi } from 'vitest'
import { createNetstatexClient, netstatexFromEnv, type NetstatexClient } from '../src/netstatex'
import { buildApp } from '../src/app'
import type { NetBoxClient, NetBoxSite, SiteRack } from '../src/netbox'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createNetstatexClient', () => {
  test('test_createNetstatexClient_deviceNames_sends_bearer_and_returns_names', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json([{ name: 'r1', address: '192.0.2.10:32767', platform: 'juniper-junos' }]))

    const client = createNetstatexClient('http://nsx:8090/', 'tok')
    const names = await client.deviceNames()

    expect(names).toEqual(['r1'])
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://nsx:8090/api/v1/devices',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    )
    expect(timeoutSpy).toHaveBeenCalledWith(1_500)
  })

  test('test_createNetstatexClient_without_token_sends_no_authorization', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json([]))

    const client = createNetstatexClient('http://nsx:8090')
    await client.deviceNames()

    const [, init] = fetchSpy.mock.calls[0]!
    expect(init?.headers).not.toHaveProperty('Authorization')
  })

  test('test_createNetstatexClient_interfaces_projects_rates_only', async () => {
    const body = [
      {
        interface: 'et-0/0/0',
        telemetry_state: 'LIVE',
        capacity_bps: 1e11,
        rx_bps: 1e9,
        tx_bps: 2e9,
        rx_octets: 123,
        description: 'to-r2',
        rx_utilization: 0.01,
        rate_state: 'ACTIVE',
      },
      {
        interface: 'et-0/0/1',
        telemetry_state: 'STALE',
        capacity_bps: null,
        rx_bps: null,
        tx_bps: null,
        rx_octets: 456,
        description: 'to-r3',
        rx_utilization: null,
        rate_state: 'INITIALIZING',
      },
    ]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(body))

    const client = createNetstatexClient('http://nsx:8090')
    const result = await client.interfaces('r 1')

    expect(fetchSpy).toHaveBeenCalledWith('http://nsx:8090/api/v1/devices/r%201/interfaces', expect.anything())
    expect(result).toEqual({
      'et-0/0/0': { rxBps: 1e9, txBps: 2e9, capacityBps: 1e11, stale: false },
      'et-0/0/1': { rxBps: null, txBps: null, capacityBps: null, stale: true },
    })
  })

  test('test_createNetstatexClient_http_error_rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}, { status: 500 }))
    const client = createNetstatexClient('http://nsx:8090')
    await expect(client.deviceNames()).rejects.toThrow()
    await expect(client.interfaces('r1')).rejects.toThrow()
  })

  test('test_createNetstatexClient_http_error_rejects_404', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}, { status: 404 }))
    const client = createNetstatexClient('http://nsx:8090')
    await expect(client.deviceNames()).rejects.toThrow()
    await expect(client.interfaces('r1')).rejects.toThrow()
  })
})

describe('netstatexFromEnv', () => {
  test('test_netstatexFromEnv_unset_returns_undefined', () => {
    expect(netstatexFromEnv({})).toBeUndefined()
  })

  test('test_netstatexFromEnv_empty_or_blank_url_returns_undefined', () => {
    expect(netstatexFromEnv({ NETSTATEX_URL: '' })).toBeUndefined()
    expect(netstatexFromEnv({ NETSTATEX_URL: '   ' })).toBeUndefined()
  })

  test('test_netstatexFromEnv_token_without_url_returns_undefined', () => {
    expect(netstatexFromEnv({ NETSTATEX_TOKEN: 'tok' })).toBeUndefined()
  })

  test('test_netstatexFromEnv_valid_url_and_token_are_trimmed_and_sent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json([]))

    await netstatexFromEnv({ NETSTATEX_URL: ' http://nsx:8090/ ', NETSTATEX_TOKEN: ' tok ' })!.deviceNames()

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://nsx:8090/api/v1/devices',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    )
  })

  test('test_netstatexFromEnv_unset_or_blank_token_sends_no_authorization', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json([]))

    for (const NETSTATEX_TOKEN of [undefined, '', '  ']) {
      await netstatexFromEnv({ NETSTATEX_URL: 'http://nsx:8090', NETSTATEX_TOKEN })!.deviceNames()
    }

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    for (const [, init] of fetchSpy.mock.calls) expect(init?.headers).not.toHaveProperty('Authorization')
  })
})

const DEVICE_META = {
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
} as const

const SITE: NetBoxSite = {
  id: '4',
  name: 'site-a',
  latitude: null,
  longitude: null,
  region: null,
  status: 'ACTIVE',
  physicalAddress: null,
  facility: null,
  role: null,
  rackCount: null,
  deviceCount: null,
}

const RACKS_3: SiteRack[] = [
  {
    id: '376',
    name: 'rack-a01',
    uHeight: 47,
    location: null,
    devices: [
      { id: '1', name: 'edge-router-1', ...DEVICE_META },
      { id: '2', name: 'r2', ...DEVICE_META },
      { id: '3', name: 'r3', ...DEVICE_META },
    ],
  },
]

function fakeNetbox(overrides: Partial<NetBoxClient> = {}): NetBoxClient {
  return {
    getSites: async () => [SITE],
    getCircuits: async () => [],
    getSiteRacks: async () => RACKS_3,
    getSiteCables: async () => [],
    getSitePower: async () => ({ panels: [], feeds: [] }),
    napalm: async (_id, method) => ({ [method]: {} }),
    getStatus: async () => ({ backend: 'netbox', version: '3.7.8', napalmAvailable: true }),
    ...overrides,
  }
}

function fakeNetstatex(overrides: Partial<NetstatexClient> = {}): NetstatexClient {
  return {
    deviceNames: vi.fn(async () => ['edge-router-1', 'r2', 'r3']),
    interfaces: vi.fn(async () => ({ 'et-0/0/0': { rxBps: 1, txBps: 2, capacityBps: 10, stale: false } })),
    topology: vi.fn(async () => ({ facts: [], nodeSids: {} })),
    ...overrides,
  }
}

async function warm(app: ReturnType<typeof buildApp>, site = 'site-a') {
  const res = await app.inject({ method: 'GET', url: `/api/sites/${site}` })
  expect(res.statusCode).toBe(200)
}

describe('GET /api/telemetry/sites/:site', () => {
  test('test_telemetry_route_feature_off_returns_404', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    expect(res.statusCode).toBe(404)
  })

  test('test_telemetry_route_returns_only_monitored_site_devices', async () => {
    const netstatex = fakeNetstatex({ deviceNames: vi.fn(async () => ['edge-router-1', 'elsewhere-1']) })
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    expect(res.statusCode).toBe(200)
    expect(netstatex.interfaces).toHaveBeenCalledTimes(1)
    expect(netstatex.interfaces).toHaveBeenCalledWith('edge-router-1')
    expect(res.json()).toEqual({
      devices: { 'edge-router-1': { 'et-0/0/0': { rxBps: 1, txBps: 2, capacityBps: 10, stale: false } } },
    })
  })

  test('test_telemetry_route_no_monitored_devices_returns_empty', async () => {
    const netstatex = fakeNetstatex({ deviceNames: vi.fn(async () => ['elsewhere-1']) })
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ devices: {} })
    expect(netstatex.interfaces).not.toHaveBeenCalled()
  })

  test('test_telemetry_route_uncached_site_returns_404_without_loading_netbox', async () => {
    const getSiteRacks = vi.fn(async () => RACKS_3)
    const app = buildApp({ netbox: fakeNetbox({ getSiteRacks }), netstatex: fakeNetstatex() })
    // no warm-up
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'unknown_site' })
    expect(getSiteRacks).not.toHaveBeenCalled()
  })

  test('test_telemetry_route_device_list_failure_returns_503', async () => {
    const netstatex = fakeNetstatex({
      deviceNames: vi.fn(async () => {
        throw new Error('nsx down')
      }),
    })
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'telemetry_unavailable' })
  })

  test('test_telemetry_route_all_device_fetches_fail_returns_503', async () => {
    const netstatex = fakeNetstatex({
      interfaces: vi.fn(async () => {
        throw new Error('device unreachable')
      }),
    })
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'telemetry_unavailable' })
  })

  test('test_telemetry_route_partial_failure_omits_failed_device', async () => {
    const netstatex = fakeNetstatex({
      interfaces: vi.fn(async (device: string) => {
        if (device === 'r2') throw new Error('device unreachable')
        return { 'et-0/0/0': { rxBps: 1, txBps: 2, capacityBps: 10, stale: false } }
      }),
    })
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Object.keys(body.devices).sort()).toEqual(['edge-router-1', 'r3'])
  })

  test('test_telemetry_route_coalesces_per_device_calls', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const netstatex = fakeNetstatex()
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)

    await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    // one call per monitored device (3), regardless of request count
    expect(netstatex.interfaces).toHaveBeenCalledTimes(3)
    expect(netstatex.deviceNames).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 1_001)
    await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    // per-device cache (1 s TTL) expired -> refetched once more per device
    expect(netstatex.interfaces).toHaveBeenCalledTimes(6)
    // device-list cache (30 s TTL) still fresh
    expect(netstatex.deviceNames).toHaveBeenCalledTimes(1)
  })

  test('test_telemetry_route_is_exempt_from_rate_limit', async () => {
    const app = buildApp({ netbox: fakeNetbox(), netstatex: fakeNetstatex() })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()

    // sanity: /api/sites (a rate-limited route) does carry the header on this same app
    const other = await app.inject({ method: 'GET', url: '/api/sites' })
    expect(other.headers['x-ratelimit-limit']).toBeDefined()
  })

  test('test_telemetry_route_never_leaks_device_address', async () => {
    // Real client + fetch spy: Fastify inject() bypasses global fetch, so this exercises
    // the actual netstatex HTTP round-trip end to end.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.endsWith('/devices')) {
        return Response.json([{ name: 'edge-router-1', address: '192.0.2.10:32767', platform: 'juniper-junos' }])
      }
      return Response.json([
        {
          interface: 'et-0/0/0',
          telemetry_state: 'LIVE',
          capacity_bps: 1e11,
          rx_bps: 1e9,
          tx_bps: 2e9,
          rx_octets: 123,
          description: 'to 198.51.100.1',
        },
      ])
    })
    const netstatex = createNetstatexClient('http://nsx')
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/sites/site-a' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.devices['edge-router-1']).toBeDefined()
    const raw = res.body
    expect(raw).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/)
    expect(raw).not.toContain('address')
    expect(raw).not.toContain('_octets')
    expect(raw).not.toContain('description')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/telemetry/circuits — live circuit utilisation for WAN links
// ─────────────────────────────────────────────────────────────────────────────

import type { SiteCable } from '../src/cables'
import type { Site } from '../src/sot/types'

const SITES: Site[] = [
  { id: '1', name: 'ams1', latitude: 52.37, longitude: 4.89, region: null, status: 'ACTIVE', physicalAddress: null, facility: null, role: null, rackCount: 1, deviceCount: 2 },
  { id: '2', name: 'par1', latitude: 48.86, longitude: 2.35, region: null, status: 'ACTIVE', physicalAddress: null, facility: null, role: null, rackCount: 1, deviceCount: 2 },
]

const CIRCUIT_CABLE_AMS: SiteCable = {
  id: 'c1',
  type: 'smf',
  status: 'CONNECTED',
  color: '',
  a: { kind: 'circuit', name: 'ACME-AMS1-PAR1-001', deviceName: null, rackName: null, ifaceType: null, termType: 'other', pairedPort: null },
  b: { kind: 'device', name: 'et-0/0/5', deviceName: 'r-ams', rackName: 'rack-a01', ifaceType: '100gbase-x-qsfp28', termType: 'interface', pairedPort: null },
}
const CIRCUIT_CABLE_PAR: SiteCable = {
  id: 'c2',
  type: 'smf',
  status: 'CONNECTED',
  color: '',
  a: { kind: 'circuit', name: 'ACME-AMS1-PAR1-001', deviceName: null, rackName: null, ifaceType: null, termType: 'other', pairedPort: null },
  b: { kind: 'device', name: 'et-0/0/5', deviceName: 'r-par', rackName: 'rack-b01', ifaceType: '100gbase-x-qsfp28', termType: 'interface', pairedPort: null },
}

const RACKS_AMS: SiteRack[] = [{ id: '1', name: 'rack-a01', uHeight: 47, location: null, devices: [{ id: '10', name: 'r-ams', ...DEVICE_META }] }]
const RACKS_PAR: SiteRack[] = [{ id: '2', name: 'rack-b01', uHeight: 47, location: null, devices: [{ id: '20', name: 'r-par', ...DEVICE_META }] }]

function fakeNetboxCircuits(overrides: Partial<NetBoxClient> = {}): NetBoxClient {
  return {
    getSites: async () => SITES,
    getCircuits: async () => [],
    getSiteRacks: async (site: string) => (site === 'ams1' ? RACKS_AMS : RACKS_PAR),
    getSiteCables: async (site: string) => (site === 'ams1' ? [CIRCUIT_CABLE_AMS] : [CIRCUIT_CABLE_PAR]),
    getSitePower: async () => ({ panels: [], feeds: [] }),
    napalm: async (_id, method) => ({ [method]: {} }),
    getStatus: async () => ({ backend: 'netbox', version: '3.7.8', napalmAvailable: true }),
    ...overrides,
  }
}

async function warmCircuits(app: ReturnType<typeof buildApp>) {
  // warm sites list + each site's detail
  await app.inject({ method: 'GET', url: '/api/sites' })
  await app.inject({ method: 'GET', url: '/api/sites/ams1' })
  await app.inject({ method: 'GET', url: '/api/sites/par1' })
}

describe('GET /api/telemetry/circuits', () => {
  test('test_circuit_telemetry_route_feature_off_returns_404', async () => {
    const app = buildApp({ netbox: fakeNetboxCircuits() })
    await warmCircuits(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    expect(res.statusCode).toBe(404)
  })

  test('test_circuit_telemetry_route_joins_both_ends_by_cid', async () => {
    const netstatex = fakeNetstatex({
      deviceNames: vi.fn(async () => ['r-ams', 'r-par']),
      interfaces: vi.fn(async (device: string) => {
        if (device === 'r-ams') return { 'et-0/0/5': { rxBps: 1e9, txBps: 2e9, capacityBps: 1e11, stale: false } }
        return { 'et-0/0/5': { rxBps: 3e9, txBps: 4e9, capacityBps: 1e11, stale: false } }
      }),
    })
    const app = buildApp({ netbox: fakeNetboxCircuits(), netstatex })
    await warmCircuits(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // ACME-AMS1-PAR1-001 has both ends; join picks max(txA, rxB) for each direction
    expect(body.circuits['ACME-AMS1-PAR1-001']).toBeDefined()
    const live = body.circuits['ACME-AMS1-PAR1-001']
    // direction ab = tx(ams) ?? rx(par) = 2e9; ba = tx(par) ?? rx(ams) = 4e9 → max = 4e9
    expect(live.bps).toBe(4e9)
    expect(live.pct).toBeCloseTo(4, 1) // 4e9 / 1e11 * 100 = 4%
    expect(live.stale).toBe(false)
  })

  test('test_circuit_telemetry_route_cold_cache_returns_empty_without_loading_netbox', async () => {
    const getSites = vi.fn(async () => SITES)
    const getSiteRacks = vi.fn(async () => RACKS_AMS)
    const app = buildApp({ netbox: fakeNetboxCircuits({ getSites, getSiteRacks }), netstatex: fakeNetstatex() })
    // no warmup: cache is cold
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ circuits: {} })
    // getSiteRacks should NOT have been called (no on-demand loading)
    expect(getSiteRacks).not.toHaveBeenCalled()
  })

  test('test_circuit_telemetry_route_fetches_only_monitored_circuit_routers', async () => {
    const netstatex = fakeNetstatex({
      deviceNames: vi.fn(async () => ['r-ams', 'other-device']),
      interfaces: vi.fn(async () => ({ 'et-0/0/5': { rxBps: 1e9, txBps: 2e9, capacityBps: 1e11, stale: false } })),
    })
    const app = buildApp({ netbox: fakeNetboxCircuits(), netstatex })
    await warmCircuits(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    expect(res.statusCode).toBe(200)
    // only r-ams is in a circuit (r-par is not in netstatex device list, other-device is not in cables)
    expect(netstatex.interfaces).toHaveBeenCalledTimes(1)
    expect(netstatex.interfaces).toHaveBeenCalledWith('r-ams')
  })

  test('test_circuit_telemetry_route_caches_response_for_one_second', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const netstatex = fakeNetstatex({
      deviceNames: vi.fn(async () => ['r-ams', 'r-par']),
      interfaces: vi.fn(async () => ({ 'et-0/0/5': { rxBps: 1e9, txBps: 2e9, capacityBps: 1e11, stale: false } })),
    })
    const app = buildApp({ netbox: fakeNetboxCircuits(), netstatex })
    await warmCircuits(app)

    await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    // first request populates cache
    const callsBefore = (netstatex.interfaces as ReturnType<typeof vi.fn>).mock.calls.length

    await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    // second request is still within the 1 s TTL -> served from cache, no new collector calls
    const callsAfterCached = (netstatex.interfaces as ReturnType<typeof vi.fn>).mock.calls.length
    expect(callsAfterCached).toBe(callsBefore)

    vi.setSystemTime(Date.now() + 1_001)
    await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    // cache expired -> devices refetched
    const callsAfter = (netstatex.interfaces as ReturnType<typeof vi.fn>).mock.calls.length
    expect(callsAfter).toBeGreaterThan(callsAfterCached)
  })

  test('test_circuit_telemetry_route_device_list_failure_returns_503', async () => {
    const netstatex = fakeNetstatex({
      deviceNames: vi.fn(async () => { throw new Error('nsx down') }),
    })
    const app = buildApp({ netbox: fakeNetboxCircuits(), netstatex })
    await warmCircuits(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'telemetry_unavailable' })
  })

  test('test_circuit_telemetry_route_all_device_fetches_fail_returns_503', async () => {
    const netstatex = fakeNetstatex({
      deviceNames: vi.fn(async () => ['r-ams', 'r-par']),
      interfaces: vi.fn(async () => { throw new Error('device unreachable') }),
    })
    const app = buildApp({ netbox: fakeNetboxCircuits(), netstatex })
    await warmCircuits(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'telemetry_unavailable' })
  })

  test('test_circuit_telemetry_route_is_exempt_from_rate_limit', async () => {
    const app = buildApp({ netbox: fakeNetboxCircuits(), netstatex: fakeNetstatex({ deviceNames: vi.fn(async () => ['r-ams']) }) })
    await warmCircuits(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()

    // sanity: /api/sites (a rate-limited route) does carry the header on this same app
    const other = await app.inject({ method: 'GET', url: '/api/sites' })
    expect(other.headers['x-ratelimit-limit']).toBeDefined()
  })

  test('test_circuit_telemetry_route_never_leaks_device_address', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.endsWith('/devices')) {
        return Response.json([
          { name: 'r-ams', address: '192.0.2.10:32767', platform: 'juniper-junos' },
          { name: 'r-par', address: '192.0.2.11:32767', platform: 'juniper-junos' },
        ])
      }
      return Response.json([
        { interface: 'et-0/0/5', telemetry_state: 'LIVE', capacity_bps: 1e11, rx_bps: 1e9, tx_bps: 2e9, rx_octets: 123, description: 'to 198.51.100.1' },
      ])
    })
    const netstatex = createNetstatexClient('http://nsx')
    const app = buildApp({ netbox: fakeNetboxCircuits(), netstatex })
    await warmCircuits(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    expect(res.statusCode).toBe(200)
    const raw = res.body
    expect(raw).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/)
    expect(raw).not.toContain('address')
    expect(raw).not.toContain('_octets')
    expect(raw).not.toContain('description')
  })

  test('test_circuit_telemetry_route_reports_each_direction_by_leaving_site', async () => {
    const netstatex = fakeNetstatex({
      deviceNames: vi.fn(async () => ['r-ams', 'r-par']),
      interfaces: vi.fn(async (device: string) => {
        if (device === 'r-ams') return { 'et-0/0/5': { rxBps: 1e9, txBps: 2e9, capacityBps: 1e11, stale: false } }
        return { 'et-0/0/5': { rxBps: 3e9, txBps: 4e9, capacityBps: 1e11, stale: false } }
      }),
    })
    const app = buildApp({ netbox: fakeNetboxCircuits(), netstatex })
    await warmCircuits(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    const live = res.json().circuits['ACME-AMS1-PAR1-001']
    expect(live.dirs).toEqual({ ams1: { bps: 2e9, pct: 2 }, par1: { bps: 4e9, pct: 4 } })
    expect(live.bps).toBe(4e9) // unchanged: busier direction
  })

  test('test_circuit_telemetry_route_names_the_far_site_from_the_circuit_list', async () => {
    const netstatex = fakeNetstatex({
      deviceNames: vi.fn(async () => ['r-ams']),
      interfaces: vi.fn(async () => ({ 'et-0/0/5': { rxBps: 1e9, txBps: 2e9, capacityBps: 1e11, stale: false } })),
    })
    const getCircuits = async () => [
      { id: '1', cid: 'ACME-AMS1-PAR1-001', provider: 'ACME', siteA: 'ams1', siteZ: 'par1', commitRate: 100_000_000, status: 'active', description: null },
    ]
    const app = buildApp({ netbox: fakeNetboxCircuits({ getCircuits }), netstatex })
    // only ams1's cables are cached: par1's end is not located, the circuit list names it
    await app.inject({ method: 'GET', url: '/api/sites' })
    await app.inject({ method: 'GET', url: '/api/sites/ams1' })
    await app.inject({ method: 'GET', url: '/api/circuits' })
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/circuits' })
    expect(res.json().circuits['ACME-AMS1-PAR1-001'].dirs).toEqual({ ams1: { bps: 2e9, pct: 2 }, par1: { bps: 1e9, pct: 1 } })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/telemetry/topology/sites/:site — site-scoped collector topology
// ─────────────────────────────────────────────────────────────────────────────

// Fixtures with every addressed upstream field to prove the join strips them:
// neighbor_ipv4, neighbor_ipv6, router_id, addresses, neighbor_addresses, prefix,
// neighbor_router_id, neighbor_address, designated_router, management_addresses,
// chassis_id, a MAC port_id, a dotted area.
const TOPOLOGY_LINK = {
  a: {
    device: 'edge-router-1',
    interface: 'et-0/0/0.0',
    chassis_id: '00:11:22:33:44:55',
    port_id: 'et-0/0/0',
    system_name: 'edge-router-1.example.net',
    management_addresses: ['192.0.2.1'],
  },
  b: {
    device: 'spine-01',
    interface: 'et-0/0/1.0',
    chassis_id: '00:11:22:33:44:66',
    port_id: 'et-0/0/1',
    system_name: 'spine-01.example.net',
    management_addresses: ['192.0.2.2'],
  },
  state: 'PRESENT',
  confirmed: true,
}

const TOPOLOGY_ISIS_ADJ = {
  device: 'edge-router-1',
  interface: 'et-0/0/0.0',
  level: 2,
  system_id: '0000.0000.0001',
  state: 'UP',
  type: 'LEVEL_2',
  neighbor_ipv4: '198.51.100.1',
  neighbor_ipv6: '2001:db8::1',
  neighbor_hostname: 'spine-01',
  area_addresses: ['49.0001'],
  up_since: '2026-09-02T00:00:04Z',
  telemetry_state: 'LIVE',
}

const TOPOLOGY_ISIS_TOPO = {
  sources: [{ device: 'edge-router-1', telemetry_state: 'LIVE' }],
  nodes: [{
    level: 2,
    system_id: '0000.0000.0001',
    hostname: 'spine-01',
    router_id: '192.0.2.10',
    srgb: [{ base: 900000, range: 65536 }],
    prefix_sids: [{ prefix: '198.51.100.128/32', index: 128, label: 900128, flags: ['NODE'], algorithm: 0 }],
  }],
  links: [{
    level: 2,
    two_way: true,
    a: {
      system_id: '0000.0000.0001',
      hostname: 'spine-01',
      metric: 10,
      addresses: ['198.51.100.0'],
      neighbor_addresses: ['198.51.100.1'],
      adj_sids: [{ value: 34, label: 34, flags: ['VALUE'], weight: 0 }],
    },
    b: {
      system_id: '0000.0000.0002',
      hostname: 'edge-router-1',
      metric: 10,
      addresses: ['198.51.100.1'],
      neighbor_addresses: ['198.51.100.0'],
      adj_sids: [{ value: 23, label: 23, flags: ['VALUE'], weight: 0 }],
    },
  }],
}

const TOPOLOGY_OSPF_ADJ = {
  device: 'edge-router-1',
  interface: 'TenGigE0/0/0/3',
  area: '0.0.0.33',
  neighbor_router_id: '198.51.100.106',
  state: 'FULL',
  neighbor_address: '198.51.100.107',
  priority: 1,
  designated_router: '0.0.0.0',
  backup_designated_router: '0.0.0.1',
  telemetry_state: 'LIVE',
}

function fakeTopologyNetstatex(overrides: Partial<NetstatexClient> = {}): NetstatexClient {
  return {
    deviceNames: vi.fn(async () => ['edge-router-1', 'spine-01']),
    interfaces: vi.fn(async () => ({})),
    topology: vi.fn(async () => ({ facts: [], nodeSids: {} })),
    ...overrides,
  }
}

describe('GET /api/telemetry/topology/sites/:site', () => {
  test('test_site_topology_route_feature_off_returns_404', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(res.statusCode).toBe(404)
  })

  test('test_site_topology_route_uncached_site_returns_404_without_loading_netbox', async () => {
    const getSiteRacks = vi.fn(async () => RACKS_3)
    const app = buildApp({ netbox: fakeNetbox({ getSiteRacks }), netstatex: fakeTopologyNetstatex() })
    // no warm-up
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'unknown_site' })
    expect(getSiteRacks).not.toHaveBeenCalled()
  })

  test('test_site_topology_route_collector_down_returns_503', async () => {
    const netstatex = fakeTopologyNetstatex({
      topology: vi.fn(async () => { throw new Error('netstatex: no endpoint answered') }),
    })
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'telemetry_unavailable' })
  })

  test('test_site_topology_route_one_endpoint_fails_reuses_last_body', async () => {
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/links')) {
        callCount++
        if (callCount === 1) return Response.json([TOPOLOGY_LINK])
        throw new Error('timeout')
      }
      if (u.includes('/isis/adjacencies')) return Response.json([])
      if (u.includes('/isis/topology')) return Response.json({ sources: [], nodes: [], links: [] })
      if (u.includes('/ospf/adjacencies')) return new Response('{}', { status: 404 })
      return Response.json({})
    })
    const netstatex = createNetstatexClient('http://nsx')
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)

    // First call populates cache and last-good
    const res1 = await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(res1.statusCode).toBe(200)

    // Second call: /links fails but should reuse last good
    const res2 = await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(res2.statusCode).toBe(200)
  })

  test('test_site_topology_route_coalesces_for_30_seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const netstatex = fakeTopologyNetstatex()
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)

    await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(netstatex.topology).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 30_001)
    await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(netstatex.topology).toHaveBeenCalledTimes(2)
  })

  test('test_site_topology_route_is_exempt_from_rate_limit', async () => {
    const app = buildApp({ netbox: fakeNetbox(), netstatex: fakeTopologyNetstatex() })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()

    const other = await app.inject({ method: 'GET', url: '/api/sites' })
    expect(other.headers['x-ratelimit-limit']).toBeDefined()
  })

  test('test_site_topology_route_never_leaks_device_address', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/links')) return Response.json([TOPOLOGY_LINK])
      if (u.includes('/isis/adjacencies')) return Response.json([TOPOLOGY_ISIS_ADJ])
      if (u.includes('/isis/topology')) return Response.json(TOPOLOGY_ISIS_TOPO)
      if (u.includes('/ospf/adjacencies')) return Response.json([TOPOLOGY_OSPF_ADJ])
      return Response.json({})
    })
    const netstatex = createNetstatexClient('http://nsx')
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(res.statusCode).toBe(200)
    const raw = res.body
    // No IPv4
    expect(raw).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/)
    // No IPv6 (2001:db8::)
    expect(raw).not.toMatch(/2001:[\da-f:]+/i)
    // No MAC (00:11:22:33:44:55)
    expect(raw).not.toMatch(/[\da-f]{2}(:[\da-f]{2}){5}/i)
    // No "address" substring
    expect(raw).not.toContain('address')
  })

  test('test_site_topology_route_circuits_join_both_ends', async () => {
    // Two sites with cables reaching the same circuit CID from different devices
    const SITE_A: NetBoxSite = { ...SITE, name: 'site-a' }
    const SITE_B: NetBoxSite = { ...SITE, id: '5', name: 'site-b' }
    const RACKS_A: SiteRack[] = [{
      id: '1', name: 'rack-a', uHeight: 47, location: null,
      devices: [{ id: '1', name: 'core-a', ...DEVICE_META }],
    }]
    const RACKS_B: SiteRack[] = [{
      id: '2', name: 'rack-b', uHeight: 47, location: null,
      devices: [{ id: '2', name: 'core-b', ...DEVICE_META }],
    }]
    // Cable at site-a: device core-a et-0/0/0 <-> circuit CID-001
    const CABLES_A: SiteCable[] = [{
      id: 'c1', type: null, status: 'connected', color: '',
      a: { kind: 'device', name: 'et-0/0/0', deviceName: 'core-a', rackName: 'rack-a', ifaceType: null, termType: 'interface', pairedPort: null },
      b: { kind: 'circuit', name: 'CID-001', deviceName: null, rackName: null, ifaceType: null, termType: 'other', pairedPort: null },
    }]
    // Cable at site-b: device core-b et-0/0/1 <-> circuit CID-001
    const CABLES_B: SiteCable[] = [{
      id: 'c2', type: null, status: 'connected', color: '',
      a: { kind: 'device', name: 'et-0/0/1', deviceName: 'core-b', rackName: 'rack-b', ifaceType: null, termType: 'interface', pairedPort: null },
      b: { kind: 'circuit', name: 'CID-001', deviceName: null, rackName: null, ifaceType: null, termType: 'other', pairedPort: null },
    }]

    const netbox = fakeNetbox({
      getSites: async () => [SITE_A, SITE_B],
      getSiteRacks: async (site) => site === 'site-a' ? RACKS_A : RACKS_B,
      getSiteCables: async (site) => site === 'site-a' ? CABLES_A : CABLES_B,
    })
    const app = buildApp({ netbox, netstatex: fakeTopologyNetstatex() })

    // Warm both sites to cache their cables
    await app.inject({ method: 'GET', url: '/api/sites' })
    await app.inject({ method: 'GET', url: '/api/sites/site-a' })
    await app.inject({ method: 'GET', url: '/api/sites/site-b' })

    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/sites/site-a' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // The circuit CID-001 must have BOTH ends (a from site-a, b from site-b)
    const circuit = body.circuits.find((c: { id: string }) => c.id === 'CID-001')
    expect(circuit).toBeDefined()
    expect(circuit.a).not.toBeNull()
    expect(circuit.a.deviceName).toBe('core-a')
    expect(circuit.b).not.toBeNull()
    expect(circuit.b.deviceName).toBe('core-b')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/telemetry/topology/backbone — backbone collector topology
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/telemetry/topology/backbone', () => {
  test('test_backbone_topology_route_feature_off_returns_404', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    expect(res.statusCode).toBe(404)
  })

  test('test_backbone_topology_route_cold_cache_returns_empty_without_loading_netbox', async () => {
    const getSites = vi.fn(async () => [SITE])
    const getSiteRacks = vi.fn(async () => RACKS_3)
    const app = buildApp({ netbox: fakeNetbox({ getSites, getSiteRacks }), netstatex: fakeTopologyNetstatex() })
    // no warm-up: cache is cold
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ facts: [], nodeSids: {}, circuits: [] })
    expect(getSiteRacks).not.toHaveBeenCalled()
  })

  test('test_backbone_topology_route_collector_down_returns_503', async () => {
    const netstatex = fakeTopologyNetstatex({
      topology: vi.fn(async () => { throw new Error('netstatex: no endpoint answered') }),
    })
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    // Warm both sites list and site detail (backbone needs sites list)
    await app.inject({ method: 'GET', url: '/api/sites' })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'telemetry_unavailable' })
  })

  test('test_backbone_topology_route_one_endpoint_fails_reuses_last_body', async () => {
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/links')) {
        callCount++
        if (callCount === 1) return Response.json([TOPOLOGY_LINK])
        throw new Error('timeout')
      }
      if (u.includes('/isis/adjacencies')) return Response.json([])
      if (u.includes('/isis/topology')) return Response.json({ sources: [], nodes: [], links: [] })
      if (u.includes('/ospf/adjacencies')) return new Response('{}', { status: 404 })
      return Response.json({})
    })
    const netstatex = createNetstatexClient('http://nsx')
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await app.inject({ method: 'GET', url: '/api/sites' })
    await warm(app)

    // First call
    const res1 = await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    expect(res1.statusCode).toBe(200)

    // Second call: /links fails but should reuse last good
    const res2 = await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    expect(res2.statusCode).toBe(200)
  })

  test('test_backbone_topology_route_coalesces_for_30_seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const netstatex = fakeTopologyNetstatex()
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    // Warm both sites list and site detail (backbone needs sites list)
    await app.inject({ method: 'GET', url: '/api/sites' })
    await warm(app)

    await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    expect(netstatex.topology).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 30_001)
    await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    expect(netstatex.topology).toHaveBeenCalledTimes(2)
  })

  test('test_backbone_topology_route_is_exempt_from_rate_limit', async () => {
    const app = buildApp({ netbox: fakeNetbox(), netstatex: fakeTopologyNetstatex() })
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()

    const other = await app.inject({ method: 'GET', url: '/api/sites' })
    expect(other.headers['x-ratelimit-limit']).toBeDefined()
  })

  test('test_backbone_topology_route_never_leaks_device_address', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/links')) return Response.json([TOPOLOGY_LINK])
      if (u.includes('/isis/adjacencies')) return Response.json([TOPOLOGY_ISIS_ADJ])
      if (u.includes('/isis/topology')) return Response.json(TOPOLOGY_ISIS_TOPO)
      if (u.includes('/ospf/adjacencies')) return Response.json([TOPOLOGY_OSPF_ADJ])
      return Response.json({})
    })
    const netstatex = createNetstatexClient('http://nsx')
    const app = buildApp({ netbox: fakeNetbox(), netstatex })
    await app.inject({ method: 'GET', url: '/api/sites' })
    await warm(app)
    const res = await app.inject({ method: 'GET', url: '/api/telemetry/topology/backbone' })
    expect(res.statusCode).toBe(200)
    const raw = res.body
    // No IPv4
    expect(raw).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/)
    // No IPv6
    expect(raw).not.toMatch(/2001:[\da-f:]+/i)
    // No MAC
    expect(raw).not.toMatch(/[\da-f]{2}(:[\da-f]{2}){5}/i)
    // No "address" substring
    expect(raw).not.toContain('address')
  })
})
