import { describe, expect, test } from 'vitest'
import { bearingToGroundOffset, compassBearing, latLonToVector3 } from '../src/geo'

const close = (v: { x: number; y: number; z: number }, e: { x: number; y: number; z: number }) => {
  expect(v.x).toBeCloseTo(e.x, 6)
  expect(v.y).toBeCloseTo(e.y, 6)
  expect(v.z).toBeCloseTo(e.z, 6)
}

describe('latLonToVector3', () => {
  test('north pole maps to +Y axis', () => {
    close(latLonToVector3(90, 0, 1), { x: 0, y: 1, z: 0 })
  })

  test('south pole maps to -Y axis', () => {
    close(latLonToVector3(-90, 0, 1), { x: 0, y: -1, z: 0 })
  })

  test('equator at lon 0 maps to +X-aligned equatorial point with y=0', () => {
    const v = latLonToVector3(0, 0, 1)
    expect(v.y).toBeCloseTo(0, 6)
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1, 6)
  })

  test('result always lies on sphere of given radius', () => {
    const v = latLonToVector3(52.29992, 4.943241, 2.5) // ams site
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(2.5, 6)
  })

  test('antipodal longitudes are mirrored through the Y axis', () => {
    const a = latLonToVector3(0, 45, 1)
    const b = latLonToVector3(0, -135, 1)
    close(b, { x: -a.x, y: -a.y, z: -a.z })
  })

  test('radius defaults to 1', () => {
    const v = latLonToVector3(45, 45)
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6)
  })
})

describe('compassBearing', () => {
  test('due north is 0°', () => {
    expect(compassBearing(0, 0, 10, 0)).toBeCloseTo(0, 4)
  })

  test('due east is 90°', () => {
    expect(compassBearing(0, 0, 0, 10)).toBeCloseTo(90, 4)
  })

  test('due south is 180°', () => {
    expect(compassBearing(0, 0, -10, 0)).toBeCloseTo(180, 4)
  })

  test('due west is 270°', () => {
    expect(compassBearing(0, 0, 0, -10)).toBeCloseTo(270, 4)
  })

  test('result is always normalised to [0, 360)', () => {
    const b = compassBearing(51.5, -0.1, 48.85, 2.35) // London → Paris (roughly SE)
    expect(b).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThan(360)
    expect(b).toBeGreaterThan(90)
    expect(b).toBeLessThan(180)
  })
})

describe('bearingToGroundOffset', () => {
  test('north (0°) points toward -z', () => {
    const o = bearingToGroundOffset(0, 5)
    expect(o.x).toBeCloseTo(0, 6)
    expect(o.z).toBeCloseTo(-5, 6)
  })

  test('east (90°) points toward +x', () => {
    const o = bearingToGroundOffset(90, 5)
    expect(o.x).toBeCloseTo(5, 6)
    expect(o.z).toBeCloseTo(0, 6)
  })

  test('south (180°) points toward +z', () => {
    const o = bearingToGroundOffset(180, 3)
    expect(o.x).toBeCloseTo(0, 6)
    expect(o.z).toBeCloseTo(3, 6)
  })
})
