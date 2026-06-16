import { describe, expect, test } from 'vitest'
import type { DeviceBox } from '../src/devices'
import type { DeviceCableEnd } from '../src/devicecables'
import { collectDevicePortNames, PORT_PITCH_M, portSlotLayout } from '../src/ports'

function end(deviceName: string | null, name: string): DeviceCableEnd {
  return { kind: 'device', name, deviceName, rackName: null }
}

function cable(id: string, a: DeviceCableEnd | null, b: DeviceCableEnd | null) {
  return { id, a, b }
}

function box(overrides: Partial<DeviceBox> = {}): DeviceBox {
  return { x: 1, y: 2, z: 3, w: 0.56, h: 0.04, d: 1.0, ...overrides }
}

describe('collectDevicePortNames', () => {
  test('returns [] when no cable touches the device', () => {
    expect(collectDevicePortNames([cable('c1', end('other', 'et-0/0/1'), null)], 'sw1')).toEqual([])
  })

  test('collects the device-local interface name from either cable side', () => {
    const cables = [
      cable('c1', end('sw1', 'Ethernet1'), end('srv1', 'eth0')),
      cable('c2', end('srv2', 'eth0'), end('sw1', 'Ethernet2')),
    ]
    expect(collectDevicePortNames(cables, 'sw1')).toEqual(['Ethernet1', 'Ethernet2'])
  })

  test('dedups repeated interface names and stays sorted', () => {
    const cables = [
      cable('c1', end('sw1', 'Ethernet2'), null),
      cable('c2', end('sw1', 'Ethernet1'), null),
      cable('c3', end('sw1', 'Ethernet1'), null),
    ]
    expect(collectDevicePortNames(cables, 'sw1')).toEqual(['Ethernet1', 'Ethernet2'])
  })
})

describe('portSlotLayout', () => {
  test('returns an empty map for no ports', () => {
    expect(portSlotLayout(box(), []).size).toBe(0)
  })

  test('places a single port at the center of the rear face', () => {
    const b = box()
    const slot = portSlotLayout(b, ['Ethernet1']).get('Ethernet1')!
    expect(slot.x).toBeCloseTo(b.x, 5) // centered across width
    expect(slot.y).toBeCloseTo(b.y, 5) // centered across height
    expect(slot.z).toBeCloseTo(b.z - b.d / 2, 5) // rear face, where cabling exits
  })

  test('is deterministic for the same box and port list', () => {
    const b = box()
    const names = ['Ethernet1', 'Ethernet2', 'Ethernet3']
    const a = portSlotLayout(b, names)
    const c = portSlotLayout(b, names)
    for (const n of names) expect(c.get(n)).toEqual(a.get(n))
  })

  test('wraps to a new row when ports exceed the column count', () => {
    // box.w = 0.1 -> floor(0.1 / 0.05) = 2 columns; 3 ports -> 2 rows
    const b = box({ w: PORT_PITCH_M * 2, h: 0.08 })
    const slots = portSlotLayout(b, ['p0', 'p1', 'p2'])
    const p0 = slots.get('p0')!
    const p1 = slots.get('p1')!
    const p2 = slots.get('p2')!
    expect(p1.x).toBeGreaterThan(p0.x) // p1 sits to the right of p0 (same row)
    expect(p0.y).toBeCloseTo(p1.y, 5) // p0 and p1 share a row
    expect(p2.y).toBeGreaterThan(p0.y) // p2 wrapped up to the next row
  })

  test('keeps every slot inside the device face bounds', () => {
    const b = box({ w: 0.4, h: 0.09 })
    const names = Array.from({ length: 20 }, (_, i) => `p${i}`)
    const left = b.x - b.w / 2
    const right = b.x + b.w / 2
    const bottom = b.y - b.h / 2
    const top = b.y + b.h / 2
    for (const slot of portSlotLayout(b, names).values()) {
      expect(slot.x).toBeGreaterThanOrEqual(left)
      expect(slot.x).toBeLessThanOrEqual(right)
      expect(slot.y).toBeGreaterThanOrEqual(bottom)
      expect(slot.y).toBeLessThanOrEqual(top)
    }
  })
})
