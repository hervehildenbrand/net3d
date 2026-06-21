import { describe, expect, test } from 'vitest'
import {
  snapToGrid,
  snapPointToGrid,
  rotatedFootprint,
  clampToBounds,
} from '../src/snap'

describe('snapToGrid', () => {
  test('snaps to the nearest grid line', () => {
    expect(snapToGrid(0.13, 0.25)).toBeCloseTo(0.25, 6)
    expect(snapToGrid(0.12, 0.25)).toBeCloseTo(0, 6)
    expect(snapToGrid(-0.13, 0.25)).toBeCloseTo(-0.25, 6)
  })

  test('leaves exact grid values unchanged', () => {
    expect(snapToGrid(0.5, 0.25)).toBeCloseTo(0.5, 6)
    expect(snapToGrid(0.75, 0.25)).toBeCloseTo(0.75, 6)
  })

  test('returns the value unchanged when pitch is zero or negative', () => {
    expect(snapToGrid(1.234, 0)).toBe(1.234)
    expect(snapToGrid(1.234, -0.25)).toBe(1.234)
  })

  test('works with rack pitch (0.75m)', () => {
    expect(snapToGrid(1.0, 0.75)).toBeCloseTo(0.75, 6)
    expect(snapToGrid(1.9, 0.75)).toBeCloseTo(2.25, 6)
  })
})

describe('snapPointToGrid', () => {
  test('snaps both coordinates independently', () => {
    expect(snapPointToGrid(0.13, 0.62, 0.25)).toEqual({ x: 0.25, z: 0.5 })
  })
})

describe('rotatedFootprint', () => {
  test('0 and 180 degrees keep the original dimensions', () => {
    expect(rotatedFootprint(0.6, 1.2, 0)).toEqual({ width: 0.6, depth: 1.2 })
    expect(rotatedFootprint(0.6, 1.2, 180)).toEqual({ width: 0.6, depth: 1.2 })
  })

  test('90 and 270 degrees swap width and depth', () => {
    expect(rotatedFootprint(0.6, 1.2, 90)).toEqual({ width: 1.2, depth: 0.6 })
    expect(rotatedFootprint(0.6, 1.2, 270)).toEqual({ width: 1.2, depth: 0.6 })
  })

  test('normalizes negative and large angles', () => {
    expect(rotatedFootprint(0.6, 1.2, -90)).toEqual({ width: 1.2, depth: 0.6 })
    expect(rotatedFootprint(0.6, 1.2, 450)).toEqual({ width: 1.2, depth: 0.6 })
  })
})

describe('clampToBounds', () => {
  const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }

  test('leaves a placement that is inside unchanged', () => {
    expect(clampToBounds(5, 5, 0.6, 1.2, 0, bounds)).toEqual({ x: 5, z: 5 })
  })

  test('clamps a placement that is outside to keep its footprint within bounds', () => {
    const result = clampToBounds(-1, 11, 0.6, 1.2, 0, bounds)
    expect(result.x).toBeCloseTo(0.3, 6) // minX + halfWidth (0.6/2)
    expect(result.z).toBeCloseTo(9.4, 6) // maxZ - halfDepth (1.2/2)
  })

  test('accounts for rotation when clamping (footprint swaps at 90deg)', () => {
    const result = clampToBounds(0, 5, 0.6, 1.2, 90, bounds)
    expect(result.x).toBeCloseTo(0.6, 6) // halfWidth is now 1.2/2
  })
})
