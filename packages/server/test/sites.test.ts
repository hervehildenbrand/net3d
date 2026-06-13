import { describe, expect, test } from 'vitest'
import { normalizeRawSites, type RawSite, type SiteCounts } from '../src/netbox'

const RAW: RawSite = {
  id: '9',
  name: 'AMS1',
  latitude: '52.3676',
  longitude: '4.9041',
  status: 'active',
  region: { name: 'EMEA' },
  physical_address: 'Science Park 610, 1098 XH Amsterdam, Netherlands',
  facility: 'Equinix AM3',
  tags: [{ slug: 'compute' }],
}

describe('normalizeRawSites', () => {
  test('maps address, facility and role tag onto the site', () => {
    const [site] = normalizeRawSites([RAW], new Map())
    expect(site).toMatchObject({
      name: 'AMS1',
      latitude: 52.3676,
      physicalAddress: 'Science Park 610, 1098 XH Amsterdam, Netherlands',
      facility: 'Equinix AM3',
      role: 'compute',
    })
  })

  test('pop tag wins as role; unknown tags yield null role', () => {
    const pop = normalizeRawSites([{ ...RAW, tags: [{ slug: 'pop' }, { slug: 'misc' }] }], new Map())
    expect(pop[0]!.role).toBe('pop')
    const none = normalizeRawSites([{ ...RAW, tags: [{ slug: 'misc' }] }], new Map())
    expect(none[0]!.role).toBeNull()
  })

  test('merges rack/device counts by site id', () => {
    const counts: Map<string, SiteCounts> = new Map([
      ['9', { rackCount: 50, deviceCount: 941 }],
    ])
    const [site] = normalizeRawSites([RAW], counts)
    expect(site!.rackCount).toBe(50)
    expect(site!.deviceCount).toBe(941)
  })

  test('counts degrade to null when the REST lookup had no row', () => {
    const [site] = normalizeRawSites([RAW], new Map())
    expect(site!.rackCount).toBeNull()
    expect(site!.deviceCount).toBeNull()
  })

  test('empty address/facility normalize to null', () => {
    const [site] = normalizeRawSites(
      [{ ...RAW, physical_address: '', facility: '', tags: [] }],
      new Map(),
    )
    expect(site!.physicalAddress).toBeNull()
    expect(site!.facility).toBeNull()
  })
})
