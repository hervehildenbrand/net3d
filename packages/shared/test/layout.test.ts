import { describe, expect, test } from 'vitest'
import {
  computeBuildingBounds,
  computeRackLayout,
  naturalCompare,
  RACK_DEPTH_M,
  U_METERS,
  type RackForLayout,
} from '../src/layout'

const rack = (name: string, location: string | null = null, uHeight = 47): RackForLayout => ({
  id: name,
  name,
  uHeight,
  location,
})

describe('naturalCompare', () => {
  test('sorts embedded numbers numerically: R2 before R10', () => {
    expect(['R10', 'R2', 'R1'].sort(naturalCompare)).toEqual(['R1', 'R2', 'R10'])
  })

  test('falls back to lexicographic for plain strings', () => {
    expect(['b', 'a'].sort(naturalCompare)).toEqual(['a', 'b'])
  })
})

describe('computeRackLayout', () => {
  test('single rack is centered at origin', () => {
    const [p] = computeRackLayout([rack('A1')])
    expect(p!.x).toBeCloseTo(0, 6)
    expect(p!.z).toBeCloseTo(0, 6)
  })

  test('racks in the same location share a row (same z), ordered naturally along x', () => {
    const placements = computeRackLayout([
      rack('R10', 'roomA'),
      rack('R2', 'roomA'),
      rack('R1', 'roomA'),
    ])
    const byId = new Map(placements.map((p) => [p.rackId, p]))
    expect(byId.get('R1')!.z).toBe(byId.get('R10')!.z)
    expect(byId.get('R1')!.x).toBeLessThan(byId.get('R2')!.x)
    expect(byId.get('R2')!.x).toBeLessThan(byId.get('R10')!.x)
  })

  test('different locations land on different rows', () => {
    const placements = computeRackLayout([rack('A1', 'roomA'), rack('B1', 'roomB')])
    const [a, b] = placements
    expect(a!.z).not.toBe(b!.z)
  })

  test('null location racks are grouped together, not dropped', () => {
    const placements = computeRackLayout([rack('A1'), rack('A2')])
    expect(placements).toHaveLength(2)
  })

  test('rack height comes from u_height', () => {
    const [p] = computeRackLayout([rack('A1', null, 42)])
    expect(p!.height).toBeCloseTo(42 * U_METERS, 6)
  })

  test('layout is centered: mean x and z near zero', () => {
    const placements = computeRackLayout([
      rack('A1', 'roomA'),
      rack('A2', 'roomA'),
      rack('B1', 'roomB'),
      rack('B2', 'roomB'),
    ])
    const mx = placements.reduce((s, p) => s + p.x, 0) / placements.length
    const mz = placements.reduce((s, p) => s + p.z, 0) / placements.length
    expect(Math.abs(mx)).toBeLessThan(0.5)
    expect(Math.abs(mz)).toBeLessThan(0.5)
  })

  test('no two racks overlap in the same row', () => {
    const placements = computeRackLayout([rack('A1', 'r'), rack('A2', 'r'), rack('A3', 'r')])
    const xs = placements.map((p) => p.x).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(placements[0]!.width)
    }
  })
})

describe('computeBuildingBounds', () => {
  test('encloses all racks with padding', () => {
    const placements = computeRackLayout([rack('A1', 'roomA'), rack('B1', 'roomB', 42)])
    const bounds = computeBuildingBounds(placements)
    for (const p of placements) {
      expect(p.x).toBeGreaterThan(bounds.min.x)
      expect(p.x).toBeLessThan(bounds.max.x)
      expect(p.z - RACK_DEPTH_M / 2).toBeGreaterThanOrEqual(bounds.min.z - 1e-9)
      expect(p.height).toBeLessThan(bounds.max.y)
    }
    expect(bounds.min.y).toBe(0)
  })

  test('returns a non-degenerate box for empty input', () => {
    const bounds = computeBuildingBounds([])
    expect(bounds.max.x).toBeGreaterThan(bounds.min.x)
    expect(bounds.max.y).toBeGreaterThan(bounds.min.y)
  })
})
