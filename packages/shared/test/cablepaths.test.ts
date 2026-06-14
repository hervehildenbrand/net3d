import { describe, expect, test } from 'vitest'
import {
  belongsToRack,
  bundleConvergencePath,
  classifyCableForRack,
  formatOutgoingLabel,
  interRackCablePath,
  intraRackCablePath,
  LANE_PITCH_M,
  outgoingStubPath,
  STUB_LENGTH_M,
  summarizeDestinations,
} from '../src/cablepaths'

const dev = (deviceName: string, rackName: string | null, name = 'et-0/0/0') => ({
  kind: 'device' as const,
  name,
  deviceName,
  rackName,
})

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

describe('belongsToRack', () => {
  const names = new Set(['srv-01'])

  test('device endpoint whose rackName matches belongs', () => {
    expect(belongsToRack(dev('leaf-1', 'R1'), 'R1', new Set())).toBe(true)
  })

  test('device endpoint in the rack name set belongs even if rackName mismatches', () => {
    // rackName can carry a stale/parent value; the device-name set is authoritative
    expect(belongsToRack(dev('srv-01', 'R2'), 'R1', names)).toBe(true)
  })

  test('device endpoint in another rack does not belong', () => {
    expect(belongsToRack(dev('spine-1', 'R2'), 'R1', names)).toBe(false)
  })

  test('powerfeed belongs when its rackName matches', () => {
    const pf = { kind: 'powerfeed' as const, name: 'feed-A', deviceName: null, rackName: 'R1' }
    expect(belongsToRack(pf, 'R1', new Set())).toBe(true)
    expect(belongsToRack({ ...pf, rackName: 'R9' }, 'R1', new Set())).toBe(false)
  })

  test('circuit (rackName null) never belongs', () => {
    const cir = { kind: 'circuit' as const, name: 'CID-7', deviceName: null, rackName: null }
    expect(belongsToRack(cir, 'R1', new Set())).toBe(false)
  })

  test('null endpoint does not belong', () => {
    expect(belongsToRack(null, 'R1', new Set())).toBe(false)
  })
})

describe('classifyCableForRack', () => {
  const names = new Set(['srv-01', 'srv-02'])

  test('both ends in the rack is intra', () => {
    expect(classifyCableForRack({ a: dev('srv-01', 'R1'), b: dev('srv-02', 'R1') }, 'R1', names)).toBe('intra')
  })

  test('exactly one end in the rack is outgoing', () => {
    expect(classifyCableForRack({ a: dev('srv-01', 'R1'), b: dev('spine-1', 'R2') }, 'R1', names)).toBe('outgoing')
  })

  test('neither end in the rack is external', () => {
    expect(classifyCableForRack({ a: dev('spine-1', 'R2'), b: dev('spine-2', 'R3') }, 'R1', new Set())).toBe('external')
  })

  test('a same-rack cable to an unpositioned device stays intra via the name set', () => {
    // srv-02 has no 3D box (unpositioned) but is a member of the rack — must NOT read as outgoing
    expect(classifyCableForRack({ a: dev('srv-01', 'R1'), b: dev('srv-02', 'R1') }, 'R1', names)).toBe('intra')
  })

  test('a cable with one null end is outgoing when the other belongs', () => {
    expect(classifyCableForRack({ a: dev('srv-01', 'R1'), b: null }, 'R1', names)).toBe('outgoing')
  })
})

describe('outgoingStubPath', () => {
  const attach = { x: 0.26, y: 0.8, z: -0.54 }
  const opts = { channelX: 0.2, channelZ: -0.54 }

  test('returns a 3-point polyline', () => {
    expect(outgoingStubPath(attach, opts)).toHaveLength(3)
  })

  test('starts at the device attach point', () => {
    expect(outgoingStubPath(attach, opts)[0]).toEqual(attach)
  })

  test('middle waypoint uses channelX/channelZ and preserves attach.y', () => {
    const p = outgoingStubPath(attach, opts)[1]!
    expect(p.x).toBeCloseTo(opts.channelX, 6)
    expect(p.z).toBeCloseTo(opts.channelZ, 6)
    expect(p.y).toBeCloseTo(attach.y, 6)
  })

  test('exit extends straight out the back by stubLength, preserving x and y', () => {
    const end = outgoingStubPath(attach, opts)[2]!
    expect(end.z).toBeCloseTo(opts.channelZ - STUB_LENGTH_M, 6)
    expect(end.x).toBeCloseTo(opts.channelX, 6)
    expect(end.y).toBeCloseTo(attach.y, 6)
  })

  test('stubLength is overridable', () => {
    const end = outgoingStubPath(attach, { ...opts, stubLength: 0.5 })[2]!
    expect(end.z).toBeCloseTo(opts.channelZ - 0.5, 6)
  })
})

describe('formatOutgoingLabel', () => {
  test('device endpoint reads rack / device / port', () => {
    expect(formatOutgoingLabel(dev('spine-1', 'R12', 'et-0/0/5'))).toBe('→ R12 / spine-1 / et-0/0/5')
  })

  test('powerfeed reads rack / feed', () => {
    expect(
      formatOutgoingLabel({ kind: 'powerfeed', name: 'feed-A', deviceName: null, rackName: 'R9' }),
    ).toBe('→ R9 / feed-A')
  })

  test('circuit reads circuit / id', () => {
    expect(
      formatOutgoingLabel({ kind: 'circuit', name: 'CID-7', deviceName: null, rackName: null }),
    ).toBe('→ circuit / CID-7')
  })

  test('null endpoint reads as dangling', () => {
    expect(formatOutgoingLabel(null)).toBe('→ (dangling)')
  })
})

describe('bundleConvergencePath', () => {
  const localAttach = { x: 0.26, y: 0.85, z: -0.54 }
  const opts = { bundleX: 0.16, rearZ: -0.54, exitY: 0.7, exitZ: -0.79 }

  test('returns a 4-point funnel: attach → channel jog → converge → exit', () => {
    expect(bundleConvergencePath(localAttach, opts)).toHaveLength(4)
  })

  test('starts at the device attach point', () => {
    expect(bundleConvergencePath(localAttach, opts)[0]).toEqual(localAttach)
  })

  test('jogs out to the bundle lane at the attach height', () => {
    const p = bundleConvergencePath(localAttach, opts)[1]!
    expect(p).toEqual({ x: opts.bundleX, y: localAttach.y, z: opts.rearZ })
  })

  test('converges vertically to the device exit height in the rear plane', () => {
    const p = bundleConvergencePath(localAttach, opts)[2]!
    expect(p).toEqual({ x: opts.bundleX, y: opts.exitY, z: opts.rearZ })
  })

  test('exits straight out the back at the exit node', () => {
    const p = bundleConvergencePath(localAttach, opts)[3]!
    expect(p).toEqual({ x: opts.bundleX, y: opts.exitY, z: opts.exitZ })
  })
})

describe('summarizeDestinations', () => {
  test('count is the total number of outgoing cables (incl. circuits/null)', () => {
    expect(summarizeDestinations(['R2', 'R2', 'R3', null]).count).toBe(4)
  })

  test('top lists the most frequent destination racks (freq desc, name asc)', () => {
    const s = summarizeDestinations(['R2', 'R2', 'R3', 'R4', null], 2)
    expect(s.top).toEqual(['R2', 'R3'])
    expect(s.moreRacks).toBe(1) // distinct {R2,R3,R4}=3, minus 2 shown
  })

  test('frequency wins over order', () => {
    expect(summarizeDestinations(['R2', 'R3', 'R3', 'R3'], 2).top).toEqual(['R3', 'R2'])
  })

  test('fewer distinct racks than topN → no remainder', () => {
    const s = summarizeDestinations(['R2', 'R2'], 2)
    expect(s.top).toEqual(['R2'])
    expect(s.moreRacks).toBe(0)
  })

  test('all-null (circuits only) → count kept, no racks', () => {
    expect(summarizeDestinations([null, null])).toEqual({ count: 2, top: [], moreRacks: 0 })
  })
})
