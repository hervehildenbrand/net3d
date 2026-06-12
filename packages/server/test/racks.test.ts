import { describe, expect, test } from 'vitest'
import { normalizeRawRacks, type RawRack } from '../src/netbox'

const device = (over: Partial<RawRack['devices'][number]> = {}): RawRack['devices'][number] => ({
  id: '1771',
  name: 'edge-router-1',
  position: 20,
  face: 'FRONT',
  role: { name: 'router_rtcore', color: '9c27b0' },
  device_type: {
    u_height: 1,
    model: 'ptx10001_36mr',
    is_full_depth: true,
    manufacturer: { name: 'Juniper' },
  },
  ...over,
})

const rack = (over: Partial<RawRack> = {}): RawRack => ({
  id: '376',
  name: 'C32-WAN1',
  u_height: 47,
  location: null,
  devices: [device()],
  ...over,
})

describe('normalizeRawRacks', () => {
  test('maps a rack with its device into the SiteRack shape', () => {
    const [r] = normalizeRawRacks([rack()])
    expect(r).toEqual({
      id: '376',
      name: 'C32-WAN1',
      uHeight: 47,
      location: null,
      devices: [
        {
          id: '1771',
          name: 'edge-router-1',
          position: 20,
          face: 'FRONT',
          roleName: 'router_rtcore',
          roleColor: '9c27b0',
          uHeight: 1,
          model: 'ptx10001_36mr',
          manufacturer: 'Juniper',
          isFullDepth: true,
        },
      ],
    })
  })

  test('normalizes NetBox 4.x lowercase face to uppercase (app compares REAR)', () => {
    const [r] = normalizeRawRacks([rack({ devices: [device({ face: 'rear' })] })])
    expect(r!.devices[0]!.face).toBe('REAR')
  })

  test('keeps a null face null', () => {
    const [r] = normalizeRawRacks([rack({ devices: [device({ face: null })] })])
    expect(r!.devices[0]!.face).toBeNull()
  })

  test('coerces string decimals and falls back for missing role/manufacturer', () => {
    const [r] = normalizeRawRacks([
      rack({
        devices: [
          device({
            position: '20',
            role: null,
            device_type: { u_height: '2', model: 'x', is_full_depth: false, manufacturer: null },
          }),
        ],
      }),
    ])
    const d = r!.devices[0]!
    expect(d.position).toBe(20)
    expect(d.uHeight).toBe(2)
    expect(d.roleName).toBe('unknown')
    expect(d.roleColor).toBe('888888')
    expect(d.manufacturer).toBe('unknown')
  })
})
