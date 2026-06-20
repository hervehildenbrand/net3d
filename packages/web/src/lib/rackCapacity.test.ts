import { describe, expect, test } from 'vitest'
import { computeRackCapacity, findEmptySlots } from './rackCapacity'
import type { SiteDevice, SiteRack } from '../hooks/useSiteDetail'

function mkDevice(position: number | null, uHeight: number, extra: Partial<SiteDevice> = {}): SiteDevice {
  return {
    id: `d${position}-${uHeight}`,
    name: 'dev',
    position,
    face: 'front',
    roleName: 'server',
    roleColor: 'aabbcc',
    uHeight,
    model: 'm',
    manufacturer: 'mfr',
    isFullDepth: true,
    status: 'active',
    ...extra,
  }
}

function mkRack(uHeight: number, devices: SiteDevice[]): SiteRack {
  return { id: 'r', name: 'rack', uHeight, location: null, devices }
}

describe('computeRackCapacity', () => {
  test('an empty rack is 0 used, 0 fill, total = u_height', () => {
    expect(computeRackCapacity(mkRack(42, []))).toEqual({ totalU: 42, usedU: 0, fill: 0 })
  })

  test('a single 2U device uses 2 of 10 U (fill 0.2)', () => {
    const cap = computeRackCapacity(mkRack(10, [mkDevice(1, 2)]))
    expect(cap.usedU).toBe(2)
    expect(cap.totalU).toBe(10)
    expect(cap.fill).toBeCloseTo(0.2)
  })

  test('front/rear devices sharing a U are counted once (no double-count)', () => {
    const rack = mkRack(10, [
      mkDevice(5, 1, { isFullDepth: false, face: 'front' }),
      mkDevice(5, 1, { isFullDepth: false, face: 'rear' }),
    ])
    expect(computeRackCapacity(rack).usedU).toBe(1)
  })

  test('devices with a null position (PDUs, children) do not consume U', () => {
    expect(computeRackCapacity(mkRack(10, [mkDevice(null, 2)])).usedU).toBe(0)
  })

  test('a device extending past the rack top is clamped to the rack', () => {
    // position 9, height 4 in a 10U rack -> only U9 and U10 count
    expect(computeRackCapacity(mkRack(10, [mkDevice(9, 4)])).usedU).toBe(2)
  })
})

describe('findEmptySlots', () => {
  test('a fully empty rack is one span covering every U', () => {
    expect(findEmptySlots(mkRack(5, []))).toEqual([{ start: 1, size: 5 }])
  })

  test('a 2U device at the bottom leaves one span above it', () => {
    expect(findEmptySlots(mkRack(10, [mkDevice(1, 2)]))).toEqual([{ start: 3, size: 8 }])
  })

  test('a device in the middle yields two spans, sorted largest first', () => {
    // device at U5 (1U) splits a 10U rack into U1-4 (4) and U6-10 (5)
    expect(findEmptySlots(mkRack(10, [mkDevice(5, 1)]))).toEqual([
      { start: 6, size: 5 },
      { start: 1, size: 4 },
    ])
  })

  test('a full rack has no empty spans', () => {
    expect(findEmptySlots(mkRack(2, [mkDevice(1, 2)]))).toEqual([])
  })
})
