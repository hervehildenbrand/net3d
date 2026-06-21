import { describe, expect, test } from 'vitest'
import { computeRackLayout, RACK_DEPTH_M, RACK_WIDTH_M, type RackForLayout } from '../src/layout'
import {
  applyLayoutOverrides,
  SITE_LAYOUT_VERSION,
  type SiteLayout,
} from '../src/sitelayout'

const rack = (name: string, location: string | null = null, uHeight = 47): RackForLayout => ({
  id: name,
  name,
  uHeight,
  location,
})

const layout = (partial: Partial<SiteLayout> = {}): SiteLayout => ({
  version: SITE_LAYOUT_VERSION,
  updatedAt: '2026-06-21T00:00:00.000Z',
  racks: [],
  rooms: [],
  floor: null,
  ...partial,
})

describe('applyLayoutOverrides', () => {
  test('null layout returns the pure auto-layout, no rooms, no orphans', () => {
    const racks = [rack('A1', 'roomA'), rack('B1', 'roomB')]
    const result = applyLayoutOverrides(racks, null)
    expect(result.placements).toEqual(computeRackLayout(racks))
    expect(result.rooms).toEqual([])
    expect(result.orphanedRackIds).toEqual([])
  })

  test('applies a saved position override to the matching rack', () => {
    const result = applyLayoutOverrides(
      [rack('A1')],
      layout({ racks: [{ rackId: 'A1', x: 5, z: 7, rotationDeg: 0 }] }),
    )
    const p = result.placements.find((p) => p.rackId === 'A1')!
    expect(p.x).toBeCloseTo(5, 6)
    expect(p.z).toBeCloseTo(7, 6)
  })

  test('rotation override swaps the rack footprint and records rotationDeg', () => {
    const result = applyLayoutOverrides(
      [rack('A1')],
      layout({ racks: [{ rackId: 'A1', x: 0, z: 0, rotationDeg: 90 }] }),
    )
    const p = result.placements.find((p) => p.rackId === 'A1')!
    expect(p.rotationDeg).toBe(90)
    expect(p.width).toBeCloseTo(RACK_DEPTH_M, 6)
    expect(p.depth).toBeCloseTo(RACK_WIDTH_M, 6)
  })

  test('a rack not present in the layout keeps its auto-layout position', () => {
    const racks = [rack('A1', 'roomA'), rack('A2', 'roomA')]
    const auto = computeRackLayout(racks)
    const result = applyLayoutOverrides(
      racks,
      layout({ racks: [{ rackId: 'A1', x: 99, z: 99, rotationDeg: 0 }] }),
    )
    const a2auto = auto.find((p) => p.rackId === 'A2')!
    const a2 = result.placements.find((p) => p.rackId === 'A2')!
    expect(a2.x).toBeCloseTo(a2auto.x, 6)
    expect(a2.z).toBeCloseTo(a2auto.z, 6)
  })

  test('reports overrides for racks that no longer exist as orphans (and omits them)', () => {
    const result = applyLayoutOverrides(
      [rack('A1')],
      layout({
        racks: [
          { rackId: 'A1', x: 1, z: 1, rotationDeg: 0 },
          { rackId: 'GONE', x: 2, z: 2, rotationDeg: 0 },
        ],
      }),
    )
    expect(result.orphanedRackIds).toEqual(['GONE'])
    expect(result.placements.some((p) => p.rackId === 'GONE')).toBe(false)
  })

  test('passes rooms through and expands bounds to enclose them', () => {
    const result = applyLayoutOverrides(
      [rack('A1')],
      layout({ rooms: [{ id: 'r1', name: 'Cage 1', bounds: { x: 20, z: 0, width: 4, depth: 4 } }] }),
    )
    expect(result.rooms).toHaveLength(1)
    expect(result.bounds.max.x).toBeGreaterThanOrEqual(22) // room right edge = 20 + width/2
  })

  test('explicit floor dimensions drive the bounds (centered on origin)', () => {
    const result = applyLayoutOverrides([rack('A1')], layout({ floor: { width: 50, depth: 30 } }))
    expect(result.bounds.max.x).toBeCloseTo(25, 6)
    expect(result.bounds.min.x).toBeCloseTo(-25, 6)
    expect(result.bounds.max.z).toBeCloseTo(15, 6)
    expect(result.bounds.min.z).toBeCloseTo(-15, 6)
  })
})
