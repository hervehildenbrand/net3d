import { describe, expect, test } from 'vitest'
import { groupSitesByRegion, NO_REGION } from './SitesMenu'
import type { Site } from '../hooks/useSites'

const makeSite = (name: string, region: string | null): Site => ({
  id: name,
  name,
  latitude: null,
  longitude: null,
  region,
  status: 'active',
  physicalAddress: null,
  facility: null,
  role: null,
  rackCount: null,
  deviceCount: null,
})

describe('groupSitesByRegion', () => {
  test('groups by region with regions and sites sorted alphabetically', () => {
    const grouped = groupSitesByRegion([
      makeSite('zebra', 'emea'),
      makeSite('alpha', 'emea'),
      makeSite('beta', 'apac'),
    ])
    expect([...grouped.keys()]).toEqual(['apac', 'emea'])
    expect(grouped.get('emea')!.map((s) => s.name)).toEqual(['alpha', 'zebra'])
    expect(grouped.get('apac')!.map((s) => s.name)).toEqual(['beta'])
  })

  test('null region groups under NO_REGION, sorted last', () => {
    const grouped = groupSitesByRegion([
      makeSite('orphan', null),
      makeSite('sited', 'zz-region'),
    ])
    expect([...grouped.keys()]).toEqual(['zz-region', NO_REGION])
    expect(grouped.get(NO_REGION)!.map((s) => s.name)).toEqual(['orphan'])
  })

  test('empty input returns empty map', () => {
    expect(groupSitesByRegion([]).size).toBe(0)
  })
})
