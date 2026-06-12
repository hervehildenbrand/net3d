import { describe, expect, test } from 'vitest'
import { interRackCablePath, intraRackCablePath } from '../src/cablepaths'

const boxA = { x: 0, y: 0.5, z: 0.3, w: 0.55, h: 0.04, d: 0.5 }
const boxB = { x: 0, y: 1.5, z: 0.3, w: 0.55, h: 0.04, d: 0.5 }

describe('intraRackCablePath', () => {
  test('starts and ends at the device boxes', () => {
    const pts = intraRackCablePath(boxA, boxB)
    expect(pts[0]!.y).toBeCloseTo(boxA.y, 6)
    expect(pts[pts.length - 1]!.y).toBeCloseTo(boxB.y, 6)
  })

  test('routes through a side channel outside the device width', () => {
    const pts = intraRackCablePath(boxA, boxB)
    const sideX = Math.max(...pts.map((p) => Math.abs(p.x)))
    expect(sideX).toBeGreaterThan(boxA.w / 2)
  })

  test('returns at least 4 waypoints for a vertical run', () => {
    expect(intraRackCablePath(boxA, boxB).length).toBeGreaterThanOrEqual(4)
  })
})

describe('interRackCablePath', () => {
  test('rises to tray height between racks', () => {
    const pts = interRackCablePath({ x: 0, y: 1, z: 0 }, { x: 5, y: 1.2, z: 3 }, 2.6)
    const maxY = Math.max(...pts.map((p) => p.y))
    expect(maxY).toBeCloseTo(2.6, 6)
    expect(pts[0]).toEqual({ x: 0, y: 1, z: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 5, y: 1.2, z: 3 })
  })
})
