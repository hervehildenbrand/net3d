import { describe, expect, test } from 'vitest'
import { interRackCablePath, intraRackCablePath, LANE_PITCH_M } from '../src/cablepaths'

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

  test('no opts produces the legacy center-to-center path', () => {
    const pts = intraRackCablePath(boxA, boxB)
    expect(pts[0]).toEqual({ x: boxA.x, y: boxA.y, z: boxA.z })
    expect(pts[pts.length - 1]).toEqual({ x: boxB.x, y: boxB.y, z: boxB.z })
  })

  test('lane shifts the vertical side channel outward by lane*LANE_PITCH_M', () => {
    const base = intraRackCablePath(boxA, boxB)
    const lane2 = intraRackCablePath(boxA, boxB, { lane: 2 })
    // waypoint 1 is the side-channel turn; its x is the channel position
    expect(lane2[1]!.x - base[1]!.x).toBeCloseTo(2 * LANE_PITCH_M, 6)
  })

  test('attach overrides replace the device endpoints', () => {
    const aAttach = { x: 0.3, y: 0.55, z: 0.4 }
    const bAttach = { x: 0.3, y: 1.45, z: 0.2 }
    const pts = intraRackCablePath(boxA, boxB, { aAttach, bAttach })
    expect(pts[0]).toEqual(aAttach)
    expect(pts[pts.length - 1]).toEqual(bAttach)
  })

  test('partial attach overrides fall back to box coordinates', () => {
    const pts = intraRackCablePath(boxA, boxB, { aAttach: { y: 0.55 } })
    expect(pts[0]).toEqual({ x: boxA.x, y: 0.55, z: boxA.z })
  })

  test('channelZ routes both middle waypoints along a fixed plane (rear)', () => {
    const rearZ = -0.54
    const pts = intraRackCablePath(boxA, boxB, { channelZ: rearZ })
    expect(pts[1]!.z).toBeCloseTo(rearZ, 6)
    expect(pts[2]!.z).toBeCloseTo(rearZ, 6)
    // endpoints are untouched by channelZ
    expect(pts[0]!.z).toBeCloseTo(boxA.z, 6)
    expect(pts[pts.length - 1]!.z).toBeCloseTo(boxB.z, 6)
  })

  test('without channelZ the run uses the endpoint midpoint z (unchanged)', () => {
    const pts = intraRackCablePath(boxA, boxB)
    expect(pts[1]!.z).toBeCloseTo((boxA.z + boxB.z) / 2, 6)
  })

  test('channelX overrides the side-channel x for both middle waypoints', () => {
    const insideX = -0.1
    const pts = intraRackCablePath(boxA, boxB, { channelX: insideX })
    expect(pts[1]!.x).toBeCloseTo(insideX, 6)
    expect(pts[2]!.x).toBeCloseTo(insideX, 6)
  })

  test('channelX takes precedence over the lane-based side channel', () => {
    const insideX = 0.2
    const pts = intraRackCablePath(boxA, boxB, { channelX: insideX, lane: 5 })
    expect(pts[1]!.x).toBeCloseTo(insideX, 6)
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
