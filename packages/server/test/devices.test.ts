import { describe, expect, test } from 'vitest'
import { buildDeviceIndex, type DeviceIndexEntry } from '../src/devices'
import type { SiteDevice, SiteRack } from '../src/sot/types'
import type { SiteDetail } from '../src/prewarm'

const device = (over: Partial<SiteDevice> = {}): SiteDevice => ({
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
  status: 'active',
  serial: null,
  assetTag: null,
  description: null,
  platform: null,
  primaryIp: null,
  oobIp: null,
  ...over,
})

const rack = (over: Partial<SiteRack> = {}): SiteRack => ({
  id: '376',
  name: 'C32-WAN1',
  uHeight: 47,
  location: null,
  devices: [device()],
  ...over,
})

const siteDetail = (racks: SiteRack[]): SiteDetail => ({
  racks,
  cables: [],
  power: { panels: [], feeds: [] },
})

describe('buildDeviceIndex', () => {
  test('flattens devices from racks across multiple sites, tagging each with its site', () => {
    const details = new Map<string, SiteDetail>([
      ['ams1', siteDetail([rack({ devices: [device({ id: 'a' }), device({ id: 'b' })] })])],
      ['lon1', siteDetail([rack({ id: 'r2', devices: [device({ id: 'c' })] })])],
    ])
    const index = buildDeviceIndex(details)
    expect(index).toHaveLength(3)
    expect(index.map((e) => e.siteName)).toEqual(['ams1', 'ams1', 'lon1'])
  })

  test('maps every device field needed for search + navigation', () => {
    const details = new Map<string, SiteDetail>([
      [
        'ams1',
        siteDetail([
          rack({
            id: 'rack-9',
            name: 'C32-WAN1',
            devices: [device({ id: 'd1', name: 'spine-01', position: 42, status: 'offline' })],
          }),
        ]),
      ],
    ])
    const [entry] = buildDeviceIndex(details)
    expect(entry).toEqual<DeviceIndexEntry>({
      id: 'd1',
      name: 'spine-01',
      siteName: 'ams1',
      rackId: 'rack-9',
      rackName: 'C32-WAN1',
      position: 42,
      roleName: 'router_rtcore',
      roleColor: '9c27b0',
      model: 'ptx10001_36mr',
      status: 'offline',
    })
  })

  test('includes unracked (position=null) devices so they are still findable', () => {
    const details = new Map<string, SiteDetail>([
      ['ams1', siteDetail([rack({ devices: [device({ id: 'pdu', position: null })] })])],
    ])
    const index = buildDeviceIndex(details)
    expect(index).toHaveLength(1)
    expect(index[0]!.position).toBeNull()
  })

  test('returns an empty array for a site with no racks', () => {
    const details = new Map<string, SiteDetail>([['empty', siteDetail([])]])
    expect(buildDeviceIndex(details)).toEqual([])
  })

  test('returns an empty array for racks with no devices', () => {
    const details = new Map<string, SiteDetail>([
      ['ams1', siteDetail([rack({ devices: [] })])],
    ])
    expect(buildDeviceIndex(details)).toEqual([])
  })

  test('preserves device order within a rack (ranking is the frontend concern)', () => {
    const details = new Map<string, SiteDetail>([
      [
        'ams1',
        siteDetail([
          rack({
            devices: [
              device({ id: 'p10', position: 10 }),
              device({ id: 'p5', position: 5 }),
              device({ id: 'p20', position: 20 }),
            ],
          }),
        ]),
      ],
    ])
    expect(buildDeviceIndex(details).map((e) => e.id)).toEqual(['p10', 'p5', 'p20'])
  })

  test('keeps same-named devices in different sites as distinct entries', () => {
    const details = new Map<string, SiteDetail>([
      ['ams1', siteDetail([rack({ devices: [device({ id: 'a', name: 'sw-core-01' })] })])],
      ['lon1', siteDetail([rack({ id: 'r2', devices: [device({ id: 'b', name: 'sw-core-01' })] })])],
    ])
    const index = buildDeviceIndex(details)
    expect(index).toHaveLength(2)
    expect(index.map((e) => ({ id: e.id, siteName: e.siteName }))).toEqual([
      { id: 'a', siteName: 'ams1' },
      { id: 'b', siteName: 'lon1' },
    ])
  })
})
