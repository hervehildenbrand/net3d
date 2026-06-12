import { describe, expect, test } from 'vitest'
import { mapInterfacesToCables } from '../src/livestatus'

const cables = [
  {
    id: 'c1',
    a: { deviceName: 'rt1', name: 'et-0/0/0' },
    b: { deviceName: 'sw1', name: 'xe-0/0/5' },
  },
  {
    id: 'c2',
    a: { deviceName: 'sw1', name: 'ge-0/0/1' },
    b: { deviceName: 'rt1', name: 'et-0/0/1' },
  },
  { id: 'c3', a: { deviceName: 'other', name: 'eth0' }, b: null },
]

describe('mapInterfacesToCables', () => {
  test('marks cable up/down from the device interface state, either side', () => {
    const m = mapInterfacesToCables(
      { 'et-0/0/0': { is_up: true }, 'et-0/0/1': { is_up: false } },
      cables,
      'rt1',
    )
    expect(m.get('c1')).toBe('up')
    expect(m.get('c2')).toBe('down')
  })

  test('ignores cables not touching the device or with unknown interfaces', () => {
    const m = mapInterfacesToCables({ 'et-0/0/9': { is_up: true } }, cables, 'rt1')
    expect(m.size).toBe(0)
  })

  test('falls back to the base interface name when only a subinterface matches', () => {
    const m = mapInterfacesToCables({ 'et-0/0/0.0': { is_up: true } }, cables, 'rt1')
    expect(m.get('c1')).toBe('up')
  })
})
