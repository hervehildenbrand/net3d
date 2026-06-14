import { describe, expect, test } from 'vitest'
import type { RackPlacement } from '@net3d/shared'
import type { CableEndpoint, SiteCable, SiteDevice, SitePower, SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'
import {
  buildPduRails,
  buildPowerCords,
  buildRoomPduStrips,
  collectSitePower,
  isPdu,
  isPowerCable,
  panelNodes,
  pduDevices,
  pduNameSet,
  pduSide,
  railColor,
} from './powerOverlay'

function dev(overrides: Partial<SiteDevice> = {}): SiteDevice {
  return {
    id: 'd1',
    name: 'dev',
    position: 1,
    face: 'FRONT',
    roleName: 'server',
    roleColor: '2196f3',
    uHeight: 1,
    model: 'm',
    manufacturer: 'mf',
    isFullDepth: true,
    status: 'active',
    ...overrides,
  }
}

function rack(devices: SiteDevice[], id = 'r1'): SiteRack {
  return { id, name: 'AMS1-SRV-01', uHeight: 42, location: null, devices }
}

function placement(overrides: Partial<RackPlacement> = {}): RackPlacement {
  return {
    rackId: 'r1',
    name: 'AMS1-SRV-01',
    location: null,
    x: 1,
    z: 2,
    width: 0.6,
    depth: 1.2,
    height: 42 * 0.0445,
    ...overrides,
  }
}

function end(
  deviceName: string | null,
  name = 'PSU1',
  kind: CableEndpoint['kind'] = 'device',
  rackName: string | null = 'AMS1-SRV-01',
): CableEndpoint {
  return { kind, name, deviceName, rackName }
}

function cable(a: CableEndpoint | null, b: CableEndpoint | null, id = 'c1'): SiteCable {
  return { id, type: null, status: 'CONNECTED', color: '', a, b }
}

const PDU_A = dev({ id: 'pa', name: 'AMS1-SRV-01-pdu-A', roleName: 'PDU', position: null })
const PDU_B = dev({ id: 'pb', name: 'AMS1-SRV-01-pdu-B', roleName: 'PDU', position: null })

describe('isPdu / pduSide', () => {
  test('detects PDU by role, case-insensitively', () => {
    expect(isPdu(dev({ roleName: 'PDU' }))).toBe(true)
    expect(isPdu(dev({ roleName: 'pdu' }))).toBe(true)
    expect(isPdu(dev({ roleName: 'leaf' }))).toBe(false)
  })

  test('reads the A/B feed side from the PDU name', () => {
    expect(pduSide('AMS1-SRV-01-pdu-A')).toBe('A')
    expect(pduSide('AMS1-SRV-01-pdu-B')).toBe('B')
    expect(pduSide('AMS1-SRV-01-leaf-1')).toBe(null)
  })
})

describe('pduDevices / pduNameSet', () => {
  test('returns the two PDUs with their sides, ignoring powered devices', () => {
    const r = rack([dev({ name: 'srv-1' }), PDU_A, PDU_B])
    expect(pduDevices(r).map((p) => [p.device.name, p.side])).toEqual([
      ['AMS1-SRV-01-pdu-A', 'A'],
      ['AMS1-SRV-01-pdu-B', 'B'],
    ])
    expect([...pduNameSet(r)].sort()).toEqual(['AMS1-SRV-01-pdu-A', 'AMS1-SRV-01-pdu-B'])
  })
})

describe('isPowerCable', () => {
  const pduNames = new Set(['AMS1-SRV-01-pdu-A', 'AMS1-SRV-01-pdu-B'])

  test('true when an end terminates on a PDU device', () => {
    const c = cable(end('srv-1', 'PSU1'), end('AMS1-SRV-01-pdu-A', 'Outlet-3'))
    expect(isPowerCable(c, pduNames)).toBe(true)
  })

  test('true when an end is a power feed', () => {
    const c = cable(end('AMS1-SRV-01-pdu-A', 'Input'), end(null, 'AMS1-SRV-01-feed-A', 'powerfeed'))
    expect(isPowerCable(c, pduNames)).toBe(true)
  })

  test('false for a normal data cable', () => {
    const c = cable(end('srv-1', 'eth0'), end('AMS1-SRV-01-leaf-1', 'Server-1'))
    expect(isPowerCable(c, pduNames)).toBe(false)
  })
})

describe('buildPduRails', () => {
  test('returns one rail per PDU, A on the left and B on the right rear corner', () => {
    const rails = buildPduRails(placement(), pduDevices(rack([PDU_A, PDU_B])))
    expect(rails).toHaveLength(2)
    const a = rails.find((r) => r.side === 'A')!
    const b = rails.find((r) => r.side === 'B')!
    // rear corners: A at x = 1 - 0.3 + 0.02 = 0.72 ; B at x = 1 + 0.3 - 0.02 = 1.28
    expect(a.position[0]).toBeCloseTo(0.72, 5)
    expect(b.position[0]).toBeCloseTo(1.28, 5)
    // both at the rear (z = 2 - 0.6 + 0.02 = 1.42), full rack height, thin footprint
    expect(a.position[2]).toBeCloseTo(1.42, 5)
    expect(a.position[1]).toBeCloseTo((42 * 0.0445) / 2, 5)
    expect(a.scale[1]).toBeCloseTo(42 * 0.0445, 5)
    expect(a.color).toBe(theme.power.feedA)
    expect(b.color).toBe(theme.power.feedB)
  })

  test('returns [] when the rack has no PDUs', () => {
    expect(buildPduRails(placement(), [])).toEqual([])
  })
})

describe('buildPowerCords', () => {
  test('returns [] when the rack has no PDUs', () => {
    const r = rack([dev({ name: 'srv-1' })])
    expect(buildPowerCords(r, placement(), [])).toEqual([])
  })

  test('draws one A cord and one B cord for a dual-corded device', () => {
    const r = rack([dev({ id: 's1', name: 'srv-1', position: 1 }), PDU_A, PDU_B])
    const cables = [
      cable(end('srv-1', 'PSU1'), end('AMS1-SRV-01-pdu-A', 'Outlet-1'), 'c1'),
      cable(end('srv-1', 'PSU2'), end('AMS1-SRV-01-pdu-B', 'Outlet-1'), 'c2'),
    ]
    const cords = buildPowerCords(r, placement(), cables)
    expect(cords).toHaveLength(2)
    const a = cords.find((c) => c.side === 'A')!
    const b = cords.find((c) => c.side === 'B')!
    expect(a.color).toBe(theme.power.feedA)
    expect(b.color).toBe(theme.power.feedB)
    // each cord lands on its side's rail x
    expect(a.points.at(-1)![0]).toBeCloseTo(0.72, 5)
    expect(b.points.at(-1)![0]).toBeCloseTo(1.28, 5)
    expect(a.device).toBe('srv-1')
  })

  test('draws 4 cords (2 per side) for a spine', () => {
    const r = rack([dev({ id: 'sp', name: 'AMS1-spine-01', roleName: 'spine', position: 30 }), PDU_A, PDU_B])
    const cables = [
      cable(end('AMS1-spine-01', 'PSU1'), end('AMS1-SRV-01-pdu-A', 'Outlet-1'), 'c1'),
      cable(end('AMS1-spine-01', 'PSU2'), end('AMS1-SRV-01-pdu-A', 'Outlet-2'), 'c2'),
      cable(end('AMS1-spine-01', 'PSU3'), end('AMS1-SRV-01-pdu-B', 'Outlet-1'), 'c3'),
      cable(end('AMS1-spine-01', 'PSU4'), end('AMS1-SRV-01-pdu-B', 'Outlet-2'), 'c4'),
    ]
    const cords = buildPowerCords(r, placement(), cables)
    expect(cords).toHaveLength(4)
    expect(cords.filter((c) => c.side === 'A')).toHaveLength(2)
    expect(cords.filter((c) => c.side === 'B')).toHaveLength(2)
  })

  test('ignores PDU-input→feed cables (no powered device end)', () => {
    const r = rack([PDU_A, PDU_B])
    const cables = [
      cable(end('AMS1-SRV-01-pdu-A', 'Input'), end(null, 'AMS1-SRV-01-feed-A', 'powerfeed')),
    ]
    expect(buildPowerCords(r, placement(), cables)).toEqual([])
  })

  test('skips cords to an unplaceable (no U-position) device', () => {
    const r = rack([dev({ name: 'srv-x', position: null }), PDU_A, PDU_B])
    const cables = [cable(end('srv-x', 'PSU1'), end('AMS1-SRV-01-pdu-A', 'Outlet-1'))]
    expect(buildPowerCords(r, placement(), cables)).toEqual([])
  })
})

describe('railColor', () => {
  test('maps A/B to the theme feed colors', () => {
    expect(railColor('A')).toBe(theme.power.feedA)
    expect(railColor('B')).toBe(theme.power.feedB)
  })
})

describe('buildRoomPduStrips', () => {
  test('one A strip (left) and one B strip (right) per dual-fed rack', () => {
    const r = rack([dev({ name: 'srv-1' }), PDU_A, PDU_B], 'r1')
    const strips = buildRoomPduStrips([r], [placement({ rackId: 'r1' })])
    expect(strips).toHaveLength(2)
    const a = strips.find((s) => s.side === 'A')!
    const b = strips.find((s) => s.side === 'B')!
    expect(a.position[0]).toBeLessThan(1) // left of rack center x=1
    expect(b.position[0]).toBeGreaterThan(1) // right of center
    expect(a.scale[1]).toBeCloseTo(42 * 0.0445, 5) // full rack height
    expect(a.color).toBe(theme.power.feedA)
    expect(b.color).toBe(theme.power.feedB)
    expect(a.rackId).toBe('r1')
  })

  test('racks without PDUs produce no strips', () => {
    const r = rack([dev({ name: 'srv-1' })], 'r1')
    expect(buildRoomPduStrips([r], [placement({ rackId: 'r1' })])).toEqual([])
  })

  test('skips placements with no matching rack', () => {
    const r = rack([PDU_A, PDU_B], 'r1')
    expect(buildRoomPduStrips([r], [placement({ rackId: 'ghost' })])).toEqual([])
  })
})

describe('panelNodes', () => {
  const power: SitePower = {
    panels: [
      { id: '1', name: 'AMS1-PWR-A', location: null },
      { id: '2', name: 'AMS1-PWR-B', location: null },
    ],
    feeds: [],
  }

  test('places an A node and a B node at opposite room edges', () => {
    const placements = [placement({ rackId: 'r1', x: 0 }), placement({ rackId: 'r2', x: 4 })]
    const nodes = panelNodes(placements, power)
    expect(nodes).toHaveLength(2)
    const a = nodes.find((n) => n.side === 'A')!
    const b = nodes.find((n) => n.side === 'B')!
    expect(a.name).toBe('AMS1-PWR-A')
    expect(a.position[0]).toBeLessThan(b.position[0]) // A left of B
    expect(a.color).toBe(theme.power.feedA)
  })

  test('returns [] when there are no panels or no placements', () => {
    expect(panelNodes([], power)).toEqual([])
    expect(panelNodes([placement()], { panels: [], feeds: [] })).toEqual([])
  })
})

describe('collectSitePower', () => {
  const racks = [rack([dev({ name: 'srv-1' }), PDU_A, PDU_B], 'r1'), rack([dev({ name: 'srv-2' })], 'r2')]
  const power: SitePower = {
    panels: [
      { id: '1', name: 'AMS1-PWR-A', location: null },
      { id: '2', name: 'AMS1-PWR-B', location: null },
    ],
    feeds: [
      {
        id: '10', name: 'AMS1-SRV-01-feed-A', status: 'active', voltage: 415, amperage: 32,
        phase: 'three-phase', supply: 'ac', type: 'primary', maxUtilization: 80,
        panelName: 'AMS1-PWR-A', rackName: 'AMS1-SRV-01',
      },
    ],
  }

  test('summarizes panels, feed specs, PDU and rack counts', () => {
    const s = collectSitePower(racks, power)
    expect(s.pduCount).toBe(2) // two PDUs in r1
    expect(s.panelCount).toBe(2)
    expect(s.feedCount).toBe(1)
    expect(s.voltage).toBe(415)
    expect(s.phase).toBe('three-phase')
    expect(s.amperage).toBe(32)
  })

  test('works with no server power data (derives PDU count from racks)', () => {
    const s = collectSitePower(racks, undefined)
    expect(s.pduCount).toBe(2)
    expect(s.panelCount).toBe(0)
    expect(s.feedCount).toBe(0)
    expect(s.voltage).toBe(null)
  })

  test('returns zeros for a powerless site', () => {
    const s = collectSitePower([rack([dev()], 'r1')], { panels: [], feeds: [] })
    expect(s).toMatchObject({ pduCount: 0, panelCount: 0, feedCount: 0, voltage: null })
  })
})
