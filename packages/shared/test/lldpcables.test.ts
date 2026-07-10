import { describe, expect, test } from 'vitest'
import { lldpToSegments } from '../src/lldpcables'

const locations = {
  rt1: { rackId: 'r1', rackName: 'RACK-1' },
  rt2: { rackId: 'r1', rackName: 'RACK-1' },
  sw1: { rackId: 'r2', rackName: 'RACK-2' },
}

const documented = [
  { id: 'c1', a: { deviceName: 'rt1', name: 'et-0/0/0' }, b: { deviceName: 'rt2', name: 'et-0/0/0' } },
]

describe('lldpToSegments', () => {
  test('discovered link not in NetBox becomes an intra-rack segment', () => {
    const segs = lldpToSegments(
      { rt1: { 'et-0/0/9': [{ hostname: 'rt2.corp.example', port: 'et-0/0/9' }] } },
      locations,
      documented,
    )
    expect(segs).toEqual([
      {
        id: 'lldp:rt1:et-0/0/9',
        localDeviceName: 'rt1',
        localInterface: 'et-0/0/9',
        remoteDeviceName: 'rt2',
        remoteInterface: 'et-0/0/9',
        localRackId: 'r1',
        remoteRackId: 'r1',
        scope: 'intra-rack',
      },
    ])
  })

  test('link already documented in NetBox is suppressed', () => {
    const segs = lldpToSegments(
      { rt1: { 'et-0/0/0': [{ hostname: 'rt2', port: 'et-0/0/0' }] } },
      locations,
      documented,
    )
    expect(segs).toEqual([])
  })

  test('both sides reporting the same link yields one segment', () => {
    const segs = lldpToSegments(
      {
        rt1: { 'et-0/0/9': [{ hostname: 'rt2', port: 'et-0/0/8' }] },
        rt2: { 'et-0/0/8': [{ hostname: 'rt1', port: 'et-0/0/9' }] },
      },
      locations,
      documented,
    )
    expect(segs).toHaveLength(1)
  })

  test('remote in another rack is inter-rack; unknown remote is external', () => {
    const segs = lldpToSegments(
      {
        rt1: {
          'et-0/1/0': [{ hostname: 'sw1', port: 'xe-0/0/1' }],
          'et-0/1/1': [{ hostname: 'far-away-router', port: 'et-9/9/9' }],
        },
      },
      locations,
      documented,
    )
    const byIf = new Map(segs.map((s) => [s.localInterface, s]))
    expect(byIf.get('et-0/1/0')?.scope).toBe('inter-rack')
    expect(byIf.get('et-0/1/0')?.remoteRackId).toBe('r2')
    expect(byIf.get('et-0/1/1')?.scope).toBe('external')
    expect(byIf.get('et-0/1/1')?.remoteRackId).toBeNull()
  })
})

describe('lldpToSegments prefixed-FQDN remotes (prod naming)', () => {
  // Real prod shape: NetBox names the device 'lf1001' but LLDP reports
  // 'par1-cp01-lf1001.infra.eu.ginfra.net'. The remote must still resolve.
  const fabricLocations = {
    lf1001: { rackId: 'compute_1', rackName: 'COMPUTE_1' },
    sp1001: { rackId: 'distri_data_1', rackName: 'DISTRI_DATA_1' },
  }

  test('remote FQDN with site/pod prefix resolves to the NetBox device', () => {
    const segs = lldpToSegments(
      { sp1001: { 'Ethernet3/1/1': [{ hostname: 'par1-cp01-lf1001.infra.eu.ginfra.net', port: 'Ethernet49/1' }] } },
      fabricLocations,
      [],
    )
    expect(segs).toHaveLength(1)
    expect(segs[0]!.remoteDeviceName).toBe('lf1001')
    expect(segs[0]!.scope).toBe('inter-rack')
    expect(segs[0]!.remoteRackId).toBe('compute_1')
  })

  test('both ends reporting with prefixed names still collapse to one segment', () => {
    const segs = lldpToSegments(
      {
        sp1001: { 'Ethernet3/1/1': [{ hostname: 'par1-cp01-lf1001.infra.eu.ginfra.net', port: 'Ethernet49/1' }] },
        lf1001: { 'Ethernet49/1': [{ hostname: 'par1-dd01-sp1001.infra.eu.ginfra.net', port: 'Ethernet3/1/1' }] },
      },
      fabricLocations,
      [],
    )
    expect(segs).toHaveLength(1)
  })

  test('unrelated hostname sharing a suffix-like tail stays external', () => {
    const segs = lldpToSegments(
      { sp1001: { 'Ethernet3/9/1': [{ hostname: 'corp-shelf1001.other.net', port: 'ge-0/0/0' }] } },
      fabricLocations,
      [],
    )
    expect(segs[0]!.scope).toBe('external')
  })
})
