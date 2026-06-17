import { describe, expect, test } from 'vitest'
import { filterDevices, type DeviceIndexEntry } from './deviceSearch'

const dev = (over: Partial<DeviceIndexEntry> = {}): DeviceIndexEntry => ({
  id: '1',
  name: 'leaf-01',
  siteName: 'ams1',
  rackId: 'r1',
  rackName: 'R01',
  position: 40,
  roleName: 'leaf',
  roleColor: '00aa00',
  model: 'QFX5100',
  status: 'active',
  ...over,
})

describe('filterDevices', () => {
  const devices = [
    dev({ id: '1', name: 'leaf-01', siteName: 'ams1', rackName: 'R01', roleName: 'leaf', model: 'QFX5100' }),
    dev({ id: '2', name: 'spine-01', siteName: 'ams1', rackName: 'R01', roleName: 'spine', model: 'QFX10002' }),
    dev({ id: '3', name: 'leaf-02', siteName: 'lon1', rackName: 'R05', roleName: 'leaf', model: 'QFX5100' }),
    dev({ id: '4', name: 'srv-001', siteName: 'lon1', rackName: 'R05', roleName: 'server', model: 'ProLiant' }),
  ]

  test('returns nothing for an empty query (no dumping the whole index)', () => {
    expect(filterDevices(devices, '')).toEqual([])
    expect(filterDevices(devices, '   ')).toEqual([])
  })

  test('matches on device name substring', () => {
    expect(filterDevices(devices, 'leaf').map((d) => d.id)).toEqual(['1', '3'])
  })

  test('matches on site name', () => {
    expect(filterDevices(devices, 'lon1').map((d) => d.id).sort()).toEqual(['3', '4'])
  })

  test('matches on rack name', () => {
    expect(filterDevices(devices, 'R05').map((d) => d.id).sort()).toEqual(['3', '4'])
  })

  test('matches on role name', () => {
    expect(filterDevices(devices, 'spine').map((d) => d.id)).toEqual(['2'])
  })

  test('matches on model', () => {
    expect(filterDevices(devices, 'proliant').map((d) => d.id)).toEqual(['4'])
  })

  test('is case-insensitive', () => {
    expect(filterDevices(devices, 'LEAF').map((d) => d.id)).toEqual(['1', '3'])
  })

  test('ranks an exact name match above a prefix match', () => {
    const list = [dev({ id: 'pre', name: 'core-01' }), dev({ id: 'exact', name: 'core' })]
    expect(filterDevices(list, 'core').map((d) => d.id)).toEqual(['exact', 'pre'])
  })

  test('ranks a name prefix above a mere name substring', () => {
    const list = [dev({ id: 'contains', name: 'asw1' }), dev({ id: 'prefix', name: 'sw1' })]
    expect(filterDevices(list, 'sw').map((d) => d.id)).toEqual(['prefix', 'contains'])
  })

  test('ranks a name match above an other-field match', () => {
    const list = [
      dev({ id: 'byrole', name: 'box-9', roleName: 'edge' }),
      dev({ id: 'byname', name: 'edge-9', roleName: 'leaf' }),
    ]
    expect(filterDevices(list, 'edge').map((d) => d.id)).toEqual(['byname', 'byrole'])
  })

  test('respects the result limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => dev({ id: String(i), name: `leaf-${i}` }))
    expect(filterDevices(many, 'leaf', 5)).toHaveLength(5)
  })
})
