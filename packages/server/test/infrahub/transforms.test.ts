import { describe, expect, test } from 'vitest'
import {
  normalizeInfrahubCables,
  normalizeInfrahubCircuits,
  normalizeInfrahubPower,
  normalizeInfrahubRacks,
  normalizeInfrahubSites,
} from '../../src/infrahub/transforms'

// Builders for Infrahub's GraphQL wrapping.
const v = <T>(value: T) => ({ value })
const one = <T>(node: T | null) => ({ node })
const first = <T>(arr: T[]): T => {
  if (arr.length === 0) throw new Error('expected at least one element')
  return arr[0] as T
}
const many = <T>(arr: T[]) => ({ edges: arr.map((node) => ({ node })) })

describe('normalizeInfrahubSites', () => {
  test('unwraps values, derives role from the dropdown, reads counts', () => {
    const s = first(normalizeInfrahubSites([
      {
        id: 'abc',
        name: v('AMS1'),
        latitude: v('52.3'),
        longitude: v('4.9'),
        region: v('EMEA'),
        status: v('active'),
        physical_address: v('Science Park'),
        facility: v('Equinix AM3'),
        role: v('compute'),
        racks: { count: 6 },
        devices: { count: 64 },
      },
    ]))
    expect(s).toEqual({
      id: 'abc',
      name: 'AMS1',
      latitude: 52.3,
      longitude: 4.9,
      region: 'EMEA',
      status: 'active',
      physicalAddress: 'Science Park',
      facility: 'Equinix AM3',
      role: 'compute',
      rackCount: 6,
      deviceCount: 64,
    })
  })

  test('maps pop role and tolerates null coords/counts', () => {
    const s = first(normalizeInfrahubSites([
      {
        id: 'p', name: v('MIA1'), latitude: v(null), longitude: v(null), region: v('Americas'),
        status: v('active'), physical_address: v(''), facility: v(''), role: v('pop'),
        racks: null, devices: null,
      },
    ]))
    expect(s.role).toBe('pop')
    expect(s.latitude).toBeNull()
    expect(s.rackCount).toBeNull()
    expect(s.physicalAddress).toBeNull()
  })
})

describe('normalizeInfrahubRacks', () => {
  const deviceType = one({
    model: v('PowerEdge R650'), u_height: v(1), is_full_depth: v(true),
    cpu_model: v('2x Xeon'), cpu_cores: v(64), ram_gb: v(512), storage_tb: v('7.68'),
    manufacturer: one({ name: v('Dell') }),
  })

  test('nests devices, uppercases face, lowercases status, dehashes role color', () => {
    const rack = first(normalizeInfrahubRacks([
      {
        id: 'r1', name: v('AMS1-SRV-01'), u_height: v(42), location: v('server-hall-1'),
        devices: many([
          {
            id: 'd1', name: v('AMS1-SRV-01-srv-01'), position: v(1), face: v('front'),
            status: v('active'), serial: v('SER1'), asset_tag: v(null), description: v(null),
            primary_ip: v('10.0.0.5/24'), oob_ip: v(null),
            role: one({ name: v('ESX Host'), color: v('#00bcd4') }),
            platform: one(null), device_type: deviceType,
          },
        ]),
      },
    ]))
    expect(rack.name).toBe('AMS1-SRV-01')
    expect(rack.uHeight).toBe(42)
    expect(rack.location).toBe('server-hall-1')
    const d = rack.devices[0]!
    expect(d).toMatchObject({
      name: 'AMS1-SRV-01-srv-01',
      position: 1,
      face: 'FRONT',
      roleName: 'ESX Host',
      roleColor: '00bcd4',
      uHeight: 1,
      model: 'PowerEdge R650',
      manufacturer: 'Dell',
      isFullDepth: true,
      status: 'active',
      primaryIp: '10.0.0.5/24',
      oobIp: null,
    })
    expect(d.specs).toEqual({ cpuModel: '2x Xeon', cpuCores: 64, ramGb: 512, storageTb: 7.68 })
  })

  test('0U device with null position/face and no specs', () => {
    const rack = first(normalizeInfrahubRacks([
      {
        id: 'r', name: v('AMS1-SRV-01'), u_height: v(42), location: v(null),
        devices: many([
          {
            id: 'pdu', name: v('AMS1-SRV-01-pdu-A'), position: v(null), face: v(null),
            status: v('active'), serial: v(null), asset_tag: v(null), description: v(null),
            primary_ip: v(null), oob_ip: v(null),
            role: one({ name: v('PDU'), color: v('#b45309') }),
            platform: one(null),
            device_type: one({
              model: v('Rack PDU AP8853'), u_height: v(0), is_full_depth: v(false),
              cpu_model: v(null), cpu_cores: v(null), ram_gb: v(null), storage_tb: v(null),
              manufacturer: one({ name: v('APC') }),
            }),
          },
        ]),
      },
    ]))
    const d = rack.devices[0]!
    expect(d.position).toBeNull()
    expect(d.face).toBeNull()
    expect(d.specs).toBeUndefined()
    expect(d.roleName).toBe('PDU')
  })
})

describe('normalizeInfrahubCables', () => {
  const ifaceEnd = (iface: string, device: string, site: string, rack: string) =>
    one({
      __typename: 'DcimInterface',
      name: v(iface),
      device: one({ name: v(device), site: one({ name: v(site) }), rack: one({ name: v(rack) }) }),
    })

  test('keeps only cables touching the site, uppercases status, dehashes color', () => {
    const raw = [
      {
        id: 'c1', cable_type: v('smf'), status: v('connected'), color: v(''),
        endpoint_a: ifaceEnd('Ethernet1', 'AMS1-SRV-01-leaf-1', 'AMS1', 'AMS1-SRV-01'),
        endpoint_b: ifaceEnd('leaf1-1', 'AMS1-spine-01', 'AMS1', 'AMS1-NET-01'),
      },
      {
        id: 'c2', cable_type: v('smf'), status: v('connected'), color: v(''),
        endpoint_a: ifaceEnd('x', 'FRA1-leaf', 'FRA1', 'FRA1-SRV-01'),
        endpoint_b: ifaceEnd('y', 'FRA1-spine', 'FRA1', 'FRA1-NET-01'),
      },
    ]
    const cables = normalizeInfrahubCables(raw, 'AMS1')
    expect(cables).toHaveLength(1)
    expect(cables[0]).toMatchObject({
      id: 'c1',
      type: 'smf',
      status: 'CONNECTED',
      color: '',
      a: { kind: 'device', name: 'Ethernet1', deviceName: 'AMS1-SRV-01-leaf-1', rackName: 'AMS1-SRV-01' },
      b: { kind: 'device', name: 'leaf1-1', deviceName: 'AMS1-spine-01', rackName: 'AMS1-NET-01' },
    })
  })

  test('circuit endpoint maps to kind circuit', () => {
    const raw = [
      {
        id: 'c3', cable_type: v(null), status: v('connected'), color: v('#ff0000'),
        endpoint_a: ifaceEnd('e', 'AMS1-core-01', 'AMS1', 'AMS1-NET-01'),
        endpoint_b: one({ __typename: 'CircuitEndpoint', name: v('AMS1-Z'), circuit: one({ cid: v('LUMEN-AMS1-FRA1-001') }) }),
      },
    ]
    const cable = normalizeInfrahubCables(raw, 'AMS1')[0]!
    expect(cable.color).toBe('ff0000')
    expect(cable.b).toEqual({ kind: 'circuit', name: 'LUMEN-AMS1-FRA1-001', deviceName: null, rackName: null })
  })
})

describe('normalizeInfrahubPower', () => {
  test('maps panels and feeds, feed status lowercase, feed_type -> type', () => {
    const power = normalizeInfrahubPower(
      [{ id: 'p1', name: v('AMS1-PWR-A'), location: v('network-core') }],
      [
        {
          id: 'f1', name: v('AMS1-SRV-01-feed-A'), status: v('ACTIVE'),
          voltage: v(415), amperage: v(32), phase: v('three-phase'), supply: v('ac'),
          feed_type: v('primary'), max_utilization: v(80),
          power_panel: one({ name: v('AMS1-PWR-A') }), rack: one({ name: v('AMS1-SRV-01') }),
        },
      ],
    )
    expect(power.panels[0]).toEqual({ id: 'p1', name: 'AMS1-PWR-A', location: 'network-core' })
    expect(power.feeds[0]).toEqual({
      id: 'f1', name: 'AMS1-SRV-01-feed-A', status: 'active',
      voltage: 415, amperage: 32, phase: 'three-phase', supply: 'ac',
      type: 'primary', maxUtilization: 80, panelName: 'AMS1-PWR-A', rackName: 'AMS1-SRV-01',
    })
  })
})

describe('normalizeInfrahubCircuits', () => {
  test('resolves A/Z site names and skips half-documented circuits', () => {
    const raw = [
      {
        id: 'c1', cid: v('LUMEN-AMS1-FRA1-001'), status: v('active'), commit_rate: v(100_000_000),
        description: v('AMS1 <-> FRA1'), provider: one({ name: v('Lumen') }),
        endpoints: many([
          { term_side: v('A'), site: one({ name: v('AMS1') }) },
          { term_side: v('Z'), site: one({ name: v('FRA1') }) },
        ]),
      },
      {
        id: 'c2', cid: v('PARTIAL'), status: v('active'), commit_rate: v(null), description: v(null),
        provider: one({ name: v('GTT') }),
        endpoints: many([{ term_side: v('A'), site: one({ name: v('AMS1') }) }]),
      },
    ]
    const circuits = normalizeInfrahubCircuits(raw)
    expect(circuits).toHaveLength(1)
    expect(circuits[0]).toEqual({
      id: 'c1', cid: 'LUMEN-AMS1-FRA1-001', provider: 'Lumen',
      siteA: 'AMS1', siteZ: 'FRA1', commitRate: 100_000_000, status: 'active', description: 'AMS1 <-> FRA1',
    })
  })
})
