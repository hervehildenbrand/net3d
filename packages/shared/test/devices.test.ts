import { describe, expect, test } from 'vitest'
import { deviceTransform, U_METERS, type RackPlacement } from '../src'

const rack: RackPlacement = {
  rackId: '376',
  name: 'C32-WAN1',
  location: null,
  x: 10,
  z: -4,
  width: 0.6,
  depth: 1.2,
  height: 47 * U_METERS,
}

const dev = (over: Partial<Parameters<typeof deviceTransform>[1]> = {}) => ({
  position: 20 as number | null,
  face: 'FRONT' as string | null,
  uHeight: 1,
  isFullDepth: false,
  ...over,
})

describe('deviceTransform', () => {
  test('1U device at position 20 sits centered on its U slot', () => {
    const t = deviceTransform(rack, dev())!
    // NetBox position is the lowest occupied U, 1-based
    expect(t.y).toBeCloseTo((19 + 0.5) * U_METERS, 6)
    expect(t.h).toBeLessThanOrEqual(U_METERS)
  })

  test('multi-U device occupies its span upward from position', () => {
    const t = deviceTransform(rack, dev({ position: 10, uHeight: 4 }))!
    expect(t.y).toBeCloseTo((9 + 2) * U_METERS, 6)
    expect(t.h).toBeGreaterThan(3.5 * U_METERS)
  })

  test('device is horizontally centered on the rack', () => {
    const t = deviceTransform(rack, dev())!
    expect(t.x).toBeCloseTo(rack.x, 6)
    expect(t.w).toBeLessThan(rack.width)
  })

  test('FRONT half-depth device sits in the +z half, REAR in the -z half', () => {
    const front = deviceTransform(rack, dev({ face: 'FRONT' }))!
    const rear = deviceTransform(rack, dev({ face: 'REAR' }))!
    expect(front.z).toBeGreaterThan(rack.z)
    expect(rear.z).toBeLessThan(rack.z)
  })

  test('full-depth device is centered in z and nearly rack-deep', () => {
    const t = deviceTransform(rack, dev({ isFullDepth: true }))!
    expect(t.z).toBeCloseTo(rack.z, 6)
    expect(t.d).toBeGreaterThan(rack.depth * 0.8)
  })

  test('unpositioned device returns null', () => {
    expect(deviceTransform(rack, dev({ position: null }))).toBeNull()
  })
})
