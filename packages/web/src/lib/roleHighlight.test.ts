import { describe, expect, test } from 'vitest'
import type { RackPlacement } from '@net3d/shared'
import type { SiteDevice, SiteRack } from '../hooks/useSiteDetail'
import { buildRoleMarkers, collectSiteRoles, racksWithRole } from './roleHighlight'

function dev(overrides: Partial<SiteDevice> = {}): SiteDevice {
  return {
    id: 'd1',
    name: 'dev',
    position: 1,
    face: 'FRONT',
    roleName: 'leaf',
    roleColor: '00ff88',
    uHeight: 1,
    model: 'm',
    manufacturer: 'mf',
    isFullDepth: true,
    status: 'active',
    ...overrides,
  }
}

function rack(id: string, devices: SiteDevice[]): SiteRack {
  return { id, name: id.toUpperCase(), uHeight: 42, location: null, devices }
}

function placement(overrides: Partial<RackPlacement> = {}): RackPlacement {
  return {
    rackId: 'r1',
    name: 'R1',
    location: null,
    x: 1,
    z: 2,
    width: 0.6,
    depth: 1.2,
    height: 42 * 0.0445,
    ...overrides,
  }
}

function expectClose(actual: number[], expected: number[], digits = 5) {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((e, i) => expect(actual[i]).toBeCloseTo(e, digits))
}

describe('collectSiteRoles', () => {
  test('returns [] for no racks', () => {
    expect(collectSiteRoles([])).toEqual([])
  })

  test('dedups by role name and counts placeable devices across racks', () => {
    const racks = [
      rack('r1', [dev({ id: '1', roleName: 'leaf' }), dev({ id: '2', roleName: 'leaf' })]),
      rack('r2', [dev({ id: '3', roleName: 'leaf' })]),
    ]
    expect(collectSiteRoles(racks)).toEqual([{ name: 'leaf', color: '00ff88', count: 3 }])
  })

  test('counts only devices with a real U-position', () => {
    const racks = [
      rack('r1', [dev({ id: '1', roleName: 'leaf', position: 1 }), dev({ id: '2', roleName: 'leaf', position: null })]),
    ]
    expect(collectSiteRoles(racks)).toEqual([{ name: 'leaf', color: '00ff88', count: 1 }])
  })

  test('omits roles with no placeable devices', () => {
    const racks = [rack('r1', [dev({ roleName: 'pdu', position: null })])]
    expect(collectSiteRoles(racks)).toEqual([])
  })

  test('carries the role color from NetBox', () => {
    const racks = [rack('r1', [dev({ roleName: 'spine', roleColor: 'abc123' })])]
    expect(collectSiteRoles(racks)[0]).toEqual({ name: 'spine', color: 'abc123', count: 1 })
  })

  test('sorts by count desc, then name asc on ties', () => {
    const racks = [
      rack('r1', [
        dev({ id: '1', roleName: 'spine' }),
        dev({ id: '2', roleName: 'spine' }),
        dev({ id: '3', roleName: 'spine' }),
      ]),
      rack('r2', [
        dev({ id: '4', roleName: 'leaf' }),
        dev({ id: '5', roleName: 'leaf' }),
        dev({ id: '6', roleName: 'leaf' }),
      ]),
      rack('r3', [dev({ id: '7', roleName: 'access' })]),
    ]
    // leaf & spine tie at 3 -> name asc puts leaf first; access (1) last.
    expect(collectSiteRoles(racks).map((r) => r.name)).toEqual(['leaf', 'spine', 'access'])
  })

  test('sorts the unknown bucket to the bottom regardless of count', () => {
    const racks = [
      rack('r1', [dev({ id: '1', roleName: 'unknown' }), dev({ id: '2', roleName: 'unknown' })]),
      rack('r2', [dev({ id: '3', roleName: 'leaf' })]),
    ]
    expect(collectSiteRoles(racks).map((r) => r.name)).toEqual(['leaf', 'unknown'])
  })
})

describe('racksWithRole', () => {
  test('returns an empty set when nothing is highlighted', () => {
    const racks = [rack('r1', [dev()])]
    expect(racksWithRole(racks, new Set()).size).toBe(0)
  })

  test('returns ids of racks holding a matching placeable device', () => {
    const racks = [rack('r1', [dev({ roleName: 'leaf' })]), rack('r2', [dev({ roleName: 'spine' })])]
    expect([...racksWithRole(racks, new Set(['leaf']))]).toEqual(['r1'])
  })

  test('ignores devices whose role matches but are not placeable', () => {
    const racks = [rack('r1', [dev({ roleName: 'leaf', position: null })])]
    expect(racksWithRole(racks, new Set(['leaf'])).size).toBe(0)
  })

  test('matches multiple racks across multiple highlighted roles', () => {
    const racks = [
      rack('r1', [dev({ roleName: 'leaf' })]),
      rack('r2', [dev({ roleName: 'spine' })]),
      rack('r3', [dev({ roleName: 'server' })]),
    ]
    expect([...racksWithRole(racks, new Set(['leaf', 'spine']))].sort()).toEqual(['r1', 'r2'])
  })
})

describe('buildRoleMarkers', () => {
  test('returns [] when nothing is highlighted', () => {
    expect(buildRoleMarkers([rack('r1', [dev()])], [placement()], new Set())).toEqual([])
  })

  test('builds a marker at the device U-position protruding from the rack front face', () => {
    const racks = [rack('r1', [dev({ roleName: 'leaf', position: 1, uHeight: 1, roleColor: '00ff88' })])]
    const markers = buildRoleMarkers(racks, [placement({ rackId: 'r1' })], new Set(['leaf']))
    expect(markers).toHaveLength(1)
    const m = markers[0]!
    // deviceTransform: y = (1-1+0.5)*0.0445 = 0.02225, h = 1*0.0445 - 0.004 = 0.0405
    // front face z = 2 + 1.2/2 = 2.6; +MARKER_DEPTH/2 (0.006) +EPS (0.002) = 2.608
    expectClose(m.position, [1, 0.02225, 2.608])
    expectClose(m.scale, [0.62, 0.0405, 0.012])
    expect(m.color).toBe('#00ff88')
  })

  test('places the marker Y/height from deviceTransform for a higher, taller device', () => {
    const racks = [rack('r1', [dev({ roleName: 'leaf', position: 10, uHeight: 2 })])]
    const markers = buildRoleMarkers(racks, [placement({ rackId: 'r1' })], new Set(['leaf']))
    const m = markers[0]!
    // y = (10-1+1)*0.0445 = 0.445 ; h = 2*0.0445 - 0.004 = 0.085
    expect(m.position[1]).toBeCloseTo(0.445, 5)
    expect(m.scale[1]).toBeCloseTo(0.085, 5)
  })

  test('skips devices without a U-position', () => {
    const racks = [rack('r1', [dev({ roleName: 'leaf', position: null })])]
    expect(buildRoleMarkers(racks, [placement({ rackId: 'r1' })], new Set(['leaf']))).toEqual([])
  })

  test('marks only devices whose role is highlighted', () => {
    const racks = [
      rack('r1', [dev({ id: 'a', roleName: 'leaf', roleColor: '00ff88' }), dev({ id: 'b', roleName: 'spine', roleColor: 'ff0000' })]),
    ]
    const markers = buildRoleMarkers(racks, [placement({ rackId: 'r1' })], new Set(['leaf']))
    expect(markers).toHaveLength(1)
    expect(markers[0]!.color).toBe('#00ff88')
  })

  test('skips placements with no matching rack without throwing', () => {
    const racks = [rack('r1', [dev({ roleName: 'leaf' })])]
    expect(buildRoleMarkers(racks, [placement({ rackId: 'ghost' })], new Set(['leaf']))).toEqual([])
  })
})
