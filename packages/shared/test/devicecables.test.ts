import { describe, expect, test } from 'vitest'
import { classifyCableKind, getCablesForDevice, type DeviceCableEnd } from '../src/devicecables'

interface TestCable {
  id: string
  a: DeviceCableEnd | null
  b: DeviceCableEnd | null
}

const end = (deviceName: string | null, name: string): DeviceCableEnd => ({
  kind: 'device',
  name,
  deviceName,
  rackName: 'R1',
})

const CABLES: TestCable[] = [
  { id: 'c1', a: end('srv-01', 'eth0'), b: end('leaf-1', 'Server-01') },
  { id: 'c2', a: end('leaf-2', 'Server-01'), b: end('srv-01', 'eth1') }, // reversed sides
  { id: 'c3', a: end('srv-01', 'mgmt0'), b: end('oob-01', 'Server-01') },
  { id: 'c4', a: end('srv-02', 'eth0'), b: end('leaf-1', 'Server-02') },
  { id: 'c5', a: null, b: end('leaf-1', 'Ethernet1') }, // dangling
]

describe('classifyCableKind', () => {
  test('mgmt interfaces are mgmt, everything else data', () => {
    expect(classifyCableKind('mgmt0')).toBe('mgmt')
    expect(classifyCableKind('Mgmt-spine-01')).toBe('mgmt')
    expect(classifyCableKind('eth0')).toBe('data')
    expect(classifyCableKind('Ethernet49')).toBe('data')
  })
})

describe('getCablesForDevice', () => {
  test('finds all cables touching the device, local interface first', () => {
    const links = getCablesForDevice(CABLES, 'srv-01')
    expect(links).toHaveLength(3)
    expect(links.map((l) => l.interfaceName).sort()).toEqual(['eth0', 'eth1', 'mgmt0'])
    const eth1 = links.find((l) => l.interfaceName === 'eth1')!
    expect(eth1.remoteDeviceName).toBe('leaf-2') // works when the device is on side b
    expect(eth1.remoteInterfaceName).toBe('Server-01')
    expect(eth1.cableId).toBe('c2')
  })

  test('classifies each link as data or mgmt by the local interface', () => {
    const links = getCablesForDevice(CABLES, 'srv-01')
    expect(links.find((l) => l.interfaceName === 'mgmt0')!.kind).toBe('mgmt')
    expect(links.find((l) => l.interfaceName === 'eth0')!.kind).toBe('data')
  })

  test('returns sorted, stable output (eth0, eth1, mgmt0)', () => {
    const names = getCablesForDevice(CABLES, 'srv-01').map((l) => l.interfaceName)
    expect(names).toEqual(['eth0', 'eth1', 'mgmt0'])
  })

  test('unknown device or dangling ends yield no links', () => {
    expect(getCablesForDevice(CABLES, 'nope')).toEqual([])
  })
})

describe('getCablesForDevice — remoteRackName', () => {
  const dev = (name: string, deviceName: string, rackName: string | null): DeviceCableEnd => ({
    kind: 'device',
    name,
    deviceName,
    rackName,
  })

  test('carries the remote device rack for an inter-rack link', () => {
    const cables = [{ id: 'c1', a: dev('et-0/0/1', 'leaf-1', 'R1'), b: dev('et-0/0/49', 'spine-1', 'R2') }]
    expect(getCablesForDevice(cables, 'leaf-1')[0]!.remoteRackName).toBe('R2')
  })

  test('reads the rack from a powerfeed end', () => {
    const cables = [
      { id: 'c2', a: dev('PSU1', 'leaf-1', 'R1'), b: { kind: 'powerfeed', name: 'feed-A', deviceName: null, rackName: 'R9' } as DeviceCableEnd },
    ]
    expect(getCablesForDevice(cables, 'leaf-1')[0]!.remoteRackName).toBe('R9')
  })

  test('is null for a circuit end (no rack)', () => {
    const cables = [
      { id: 'c3', a: dev('et-0/0/47', 'leaf-1', 'R1'), b: { kind: 'circuit', name: 'CID-7', deviceName: null, rackName: null } as DeviceCableEnd },
    ]
    expect(getCablesForDevice(cables, 'leaf-1')[0]!.remoteRackName).toBe(null)
  })

  test('is null for a dangling cable (no remote end)', () => {
    const cables = [{ id: 'c4', a: dev('et-0/0/0', 'leaf-1', 'R1'), b: null }]
    expect(getCablesForDevice(cables, 'leaf-1')[0]!.remoteRackName).toBe(null)
  })
})
