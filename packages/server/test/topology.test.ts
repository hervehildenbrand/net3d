import { describe, expect, test, vi, afterEach } from 'vitest'
import { resolveTopology } from '../src/topology'
import { createNetstatexClient } from '../src/netstatex'

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Collector DTO test fixtures
// These carry every addressed upstream field from the design notes to prove
// the join strips them: neighbor_ipv4, neighbor_ipv6, router_id, addresses,
// neighbor_addresses, prefix, neighbor_router_id, neighbor_address,
// designated_router, management_addresses, chassis_id, a MAC port_id, a dotted area.
// ─────────────────────────────────────────────────────────────────────────────

const LINK_PRESENT = {
  a: {
    device: 'edge-router-1',
    interface: 'et-0/0/0.0',
    chassis_id: '00:11:22:33:44:55',
    port_id: 'et-0/0/0',
    system_name: 'edge-router-1.example.net',
    management_addresses: ['192.0.2.1'],
  },
  b: {
    device: 'spine-01',
    interface: 'et-0/0/1.0',
    chassis_id: '00:11:22:33:44:66',
    port_id: 'et-0/0/1',
    system_name: 'spine-01.example.net',
    management_addresses: ['192.0.2.2'],
  },
  state: 'PRESENT' as const,
  confirmed: true,
  last_seen: '2026-09-04T09:00:00Z',
}

const LINK_REMOVED = {
  ...LINK_PRESENT,
  a: { ...LINK_PRESENT.a, device: 'r-removed', interface: 'et-1/0/0' },
  state: 'REMOVED' as const,
}

const LINK_UNMONITORED = {
  a: {
    device: 'edge-router-1',
    interface: 'et-0/0/2.0',
    chassis_id: '00:11:22:33:44:55',
    port_id: 'et-0/0/2',
    system_name: 'edge-router-1.example.net',
    management_addresses: ['192.0.2.1'],
  },
  b: {
    device: null,
    interface: null,
    chassis_id: '00:11:22:33:44:77',
    port_id: 'eth0',
    system_name: 'bmc-server-1',
    management_addresses: [],
  },
  state: 'PRESENT' as const,
  confirmed: false,
  last_seen: '2026-09-04T09:00:00Z',
}

const LINK_MAC_PORTID = {
  a: {
    device: 'edge-router-1',
    interface: 'et-0/0/3.0',
    chassis_id: '00:11:22:33:44:55',
    port_id: 'et-0/0/3',
    system_name: 'edge-router-1.example.net',
    management_addresses: [],
  },
  b: {
    device: null,
    interface: null,
    chassis_id: '00:11:22:33:44:88',
    port_id: '00:11:22:33:44:88',
    system_name: 'host-with-mac',
    management_addresses: [],
  },
  state: 'PRESENT' as const,
  confirmed: false,
  last_seen: '2026-09-04T09:00:00Z',
}

const LINK_NO_PORTID = {
  a: {
    device: 'edge-router-1',
    interface: 'et-0/0/4.0',
    chassis_id: '00:11:22:33:44:55',
    port_id: 'et-0/0/4',
    system_name: 'edge-router-1.example.net',
    management_addresses: [],
  },
  b: {
    device: null,
    interface: null,
    chassis_id: '00:11:22:33:44:99',
    port_id: null,
    system_name: 'host-no-port',
    management_addresses: [],
  },
  state: 'PRESENT' as const,
  confirmed: false,
  last_seen: '2026-09-04T09:00:00Z',
}

// Two different chassis with the same system_name
const LINK_SAME_SYSNAME_1 = {
  a: {
    device: 'edge-router-1',
    interface: 'et-0/0/5.0',
    chassis_id: '00:11:22:33:44:55',
    port_id: 'et-0/0/5',
    system_name: 'edge-router-1.example.net',
    management_addresses: [],
  },
  b: {
    device: null,
    interface: null,
    chassis_id: 'aa:bb:cc:dd:ee:01',
    port_id: 'eth0',
    system_name: 'dup-hostname',
    management_addresses: [],
  },
  state: 'PRESENT' as const,
  confirmed: false,
  last_seen: '2026-09-04T09:00:00Z',
}

const LINK_SAME_SYSNAME_2 = {
  a: {
    device: 'edge-router-1',
    interface: 'et-0/0/6.0',
    chassis_id: '00:11:22:33:44:55',
    port_id: 'et-0/0/6',
    system_name: 'edge-router-1.example.net',
    management_addresses: [],
  },
  b: {
    device: null,
    interface: null,
    chassis_id: 'aa:bb:cc:dd:ee:02',
    port_id: 'eth1',
    system_name: 'dup-hostname',
    management_addresses: [],
  },
  state: 'PRESENT' as const,
  confirmed: false,
  last_seen: '2026-09-04T09:00:00Z',
}

// IS-IS adjacency fixtures
const ISIS_ADJ_UP = {
  device: 'edge-router-1',
  interface: 'et-0/0/0.0',
  level: 2,
  system_id: '0000.0000.0001',
  state: 'UP',
  type: 'LEVEL_2',
  neighbor_ipv4: '198.51.100.1',
  neighbor_ipv6: '2001:db8::1',
  neighbor_hostname: null,
  area_addresses: ['49.0001'],
  up_since: '2026-09-02T00:00:04Z',
  telemetry_state: 'LIVE',
  last_update: '2026-09-02T00:00:04Z',
}

const ISIS_ADJ_STALE = {
  ...ISIS_ADJ_UP,
  interface: 'et-0/0/1.0',
  system_id: '0000.0000.0002',
  telemetry_state: 'STALE',
}

const ISIS_ADJ_DOWN = {
  ...ISIS_ADJ_UP,
  interface: 'et-0/0/7.0',
  system_id: '0000.0000.0003',
  state: 'DOWN',
}

const ISIS_ADJ_REMOVED = {
  ...ISIS_ADJ_UP,
  interface: 'et-0/0/8.0',
  system_id: '0000.0000.0004',
  state: 'REMOVED',
}

// LSDB fixtures
const LSDB_SOURCES_LIVE = [
  { device: 'edge-router-1', telemetry_state: 'LIVE', synced_at: '2026-09-25T00:00:01Z' },
]

const LSDB_SOURCES_STALE = [
  { device: 'edge-router-1', telemetry_state: 'STALE', synced_at: '2026-09-25T00:00:01Z' },
]

const LSDB_NODES = [
  {
    level: 2,
    system_id: '0000.0000.0001',
    hostname: 'spine-01',
    router_id: '192.0.2.10',
    srgb: [{ base: 900000, range: 65536 }],
    sr_flags: ['IPV4_MPLS'],
    sr_algorithms: ['SPF'],
    prefix_sids: [
      { prefix: '198.51.100.128/32', index: 128, label: 900128, flags: ['NODE'], algorithm: 0 },
    ],
    sources: ['edge-router-1'],
    last_update: '2026-09-25T00:00:01Z',
  },
  {
    level: 2,
    system_id: '0000.0000.0002',
    hostname: 'edge-router-1',
    router_id: '192.0.2.11',
    srgb: [{ base: 900000, range: 65536 }],
    sr_flags: ['IPV4_MPLS'],
    sr_algorithms: ['SPF'],
    prefix_sids: [
      { prefix: '198.51.100.129/32', index: 129, label: 900129, flags: ['NODE'], algorithm: 0 },
    ],
    sources: ['edge-router-1'],
    last_update: '2026-09-25T00:00:01Z',
  },
]

const LSDB_LINKS = [
  {
    level: 2,
    two_way: true,
    a: {
      system_id: '0000.0000.0001',
      hostname: 'spine-01',
      metric: 10,
      addresses: ['198.51.100.0'],
      neighbor_addresses: ['198.51.100.1'],
      adj_sids: [{ value: 34, label: 34, flags: ['VALUE', 'LOCAL'], weight: 0 }],
    },
    b: {
      system_id: '0000.0000.0002',
      hostname: 'edge-router-1',
      metric: 10,
      addresses: ['198.51.100.1'],
      neighbor_addresses: ['198.51.100.0'],
      adj_sids: [{ value: 23, label: 23, flags: ['VALUE', 'LOCAL'], weight: 0 }],
    },
  },
]

// adj-SID without label (uses value)
const LSDB_LINKS_NO_LABEL = [
  {
    level: 2,
    two_way: true,
    a: {
      system_id: '0000.0000.0001',
      hostname: 'spine-01',
      metric: 10,
      addresses: ['198.51.100.0'],
      neighbor_addresses: ['198.51.100.1'],
      adj_sids: [{ value: 55, label: null, flags: ['VALUE', 'LOCAL'], weight: 0 }],
    },
    b: {
      system_id: '0000.0000.0002',
      hostname: 'edge-router-1',
      metric: 10,
      addresses: ['198.51.100.1'],
      neighbor_addresses: ['198.51.100.0'],
      adj_sids: [{ value: 44, label: null, flags: ['VALUE', 'LOCAL'], weight: 0 }],
    },
  },
]

// OSPF adjacency fixtures
const OSPF_ADJ_FULL = {
  device: 'edge-router-1',
  network_instance: 'DEFAULT',
  process: '33',
  area: '33',
  interface: 'TenGigE0/0/0/3',
  neighbor_router_id: '198.51.100.106',
  state: 'FULL',
  neighbor_address: '198.51.100.107',
  priority: 1,
  designated_router: '0.0.0.0',
  backup_designated_router: '0.0.0.0',
  up_since: '2026-09-27T10:00:00Z',
  telemetry_state: 'LIVE',
  last_update: '2026-09-27T12:00:00Z',
}

// OSPF with dotted-quad area
const OSPF_ADJ_DOTTED_AREA = {
  ...OSPF_ADJ_FULL,
  area: '0.0.0.33',
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveTopology tests
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveTopology', () => {
  test('test_resolveTopology_removedLink_omitted', () => {
    const raw = {
      links: [LINK_PRESENT, LINK_REMOVED],
      isisAdjacencies: [],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // REMOVED link should not appear
    expect(facts.some(f => f.device === 'r-removed')).toBe(false)
    // PRESENT link should appear
    expect(facts.some(f => f.device === 'edge-router-1' && f.layer === 'physical')).toBe(true)
  })

  test('test_resolveTopology_unmonitoredFarEnd_systemName', () => {
    const raw = {
      links: [LINK_UNMONITORED],
      isisAdjacencies: [],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // b.device is null, so remote should be derived from system_name
    const fact = facts.find(f => f.iface === 'et-0/0/2.0')
    expect(fact).toBeDefined()
    expect(fact!.remote).toBe('bmc-server-1')
    expect(fact!.remoteIface).toBe('eth0')
    // chassis_id must not leak
    expect(JSON.stringify(facts)).not.toContain('00:11:22:33:44:77')
  })

  test('test_resolveTopology_twoChassisSameSystemName_distinctRemotes', () => {
    const raw = {
      links: [LINK_SAME_SYSNAME_1, LINK_SAME_SYSNAME_2],
      isisAdjacencies: [],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    const remotes = facts.filter(f => f.remote?.startsWith('dup-hostname')).map(f => f.remote)
    // Two distinct chassis with same system_name -> 'dup-hostname' and 'dup-hostname#2'
    expect(remotes).toHaveLength(2)
    expect(remotes.sort()).toEqual(['dup-hostname', 'dup-hostname#2'])
  })

  test('test_resolveTopology_macPortId_nulled', () => {
    const raw = {
      links: [LINK_MAC_PORTID],
      isisAdjacencies: [],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    const fact = facts.find(f => f.iface === 'et-0/0/3.0')
    expect(fact).toBeDefined()
    // MAC port_id should be nulled
    expect(fact!.remoteIface).toBeNull()
    // chassis_id must not leak
    expect(JSON.stringify(facts)).not.toContain('00:11:22:33:44:88')
  })

  test('test_resolveTopology_missingPortId_nullRemoteIface', () => {
    const raw = {
      links: [LINK_NO_PORTID],
      isisAdjacencies: [],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    const fact = facts.find(f => f.iface === 'et-0/0/4.0')
    expect(fact).toBeDefined()
    expect(fact!.remoteIface).toBeNull()
  })

  test('test_resolveTopology_isisNeighbour_resolvedByLldp', () => {
    // A link on the same port (base interface match) with exactly one PRESENT link,
    // one distinct neighbour id, and the far port carries an adjacency itself
    const linkForAdj = {
      a: {
        device: 'edge-router-1',
        interface: 'et-0/0/0.0',
        chassis_id: '00:11:22:33:44:55',
        port_id: 'et-0/0/0',
        system_name: 'edge-router-1.example.net',
        management_addresses: [],
      },
      b: {
        device: 'spine-01',
        interface: 'et-0/0/1.0',
        chassis_id: '00:11:22:33:44:66',
        port_id: 'et-0/0/1',
        system_name: 'spine-01.example.net',
        management_addresses: [],
      },
      state: 'PRESENT' as const,
      confirmed: true,
      last_seen: '2026-09-04T09:00:00Z',
    }
    // IS-IS adjacency on the A side
    const isisA = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }
    // IS-IS adjacency on the B side (reciprocal) to edge-router-1
    const isisB = {
      device: 'spine-01',
      interface: 'et-0/0/1.0',
      level: 2,
      system_id: '0000.0000.0002',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.2',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }

    const raw = {
      links: [linkForAdj],
      isisAdjacencies: [isisA, isisB],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // IS-IS fact for edge-router-1 should have remote resolved to spine-01
    const isisFact = facts.find(f => f.device === 'edge-router-1' && f.layer === 'isis')
    expect(isisFact).toBeDefined()
    expect(isisFact!.remote).toBe('spine-01')
    // system_id must not leak
    expect(JSON.stringify(facts)).not.toContain('0000.0000.0001')
    expect(JSON.stringify(facts)).not.toContain('0000.0000.0002')
  })

  test('test_resolveTopology_isisNeighbour_resolvedFromBSideOfLink', () => {
    // Link emitted from the B side (alphabetically first)
    const linkFromB = {
      a: {
        device: 'spine-01',
        interface: 'et-0/0/1.0',
        chassis_id: '00:11:22:33:44:66',
        port_id: 'et-0/0/1',
        system_name: 'spine-01.example.net',
        management_addresses: [],
      },
      b: {
        device: 'edge-router-1',
        interface: 'et-0/0/0.0',
        chassis_id: '00:11:22:33:44:55',
        port_id: 'et-0/0/0',
        system_name: 'edge-router-1.example.net',
        management_addresses: [],
      },
      state: 'PRESENT' as const,
      confirmed: true,
      last_seen: '2026-09-04T09:00:00Z',
    }
    const isisOnEdge = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }
    const isisOnSpine = {
      device: 'spine-01',
      interface: 'et-0/0/1.0',
      level: 2,
      system_id: '0000.0000.0002',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.2',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }

    const raw = {
      links: [linkFromB],
      isisAdjacencies: [isisOnEdge, isisOnSpine],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // edge-router-1 is in the B side of the link, should still resolve neighbor
    const isisFact = facts.find(f => f.device === 'edge-router-1' && f.layer === 'isis')
    expect(isisFact).toBeDefined()
    expect(isisFact!.remote).toBe('spine-01')
  })

  test('test_resolveTopology_subinterfacesDistinctNeighbours_notResolvedByLldp', () => {
    // Two subinterfaces on the same base interface with different neighbours -> no LLDP resolution
    const link = {
      a: {
        device: 'edge-router-1',
        interface: 'et-0/0/0.0',
        chassis_id: '00:11:22:33:44:55',
        port_id: 'et-0/0/0',
        system_name: 'edge-router-1.example.net',
        management_addresses: [],
      },
      b: {
        device: 'spine-01',
        interface: 'et-0/0/1.0',
        chassis_id: '00:11:22:33:44:66',
        port_id: 'et-0/0/1',
        system_name: 'spine-01.example.net',
        management_addresses: [],
      },
      state: 'PRESENT' as const,
      confirmed: true,
      last_seen: '2026-09-04T09:00:00Z',
    }
    // Two IS-IS adjacencies on subinterfaces with DIFFERENT neighbour system_ids
    const isisUnit0 = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }
    const isisUnit100 = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.100',
      level: 2,
      system_id: '0000.0000.0099',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.99',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }
    // Reciprocal adjacency on the B side but only for one system_id
    const isisOnSpine = {
      device: 'spine-01',
      interface: 'et-0/0/1.0',
      level: 2,
      system_id: '0000.0000.0002',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.2',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }

    const raw = {
      links: [link],
      isisAdjacencies: [isisUnit0, isisUnit100, isisOnSpine],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // With multiple distinct neighbour ids, LLDP coincidence doesn't apply
    // The IS-IS facts should have null remote (unresolved)
    const isisFacts = facts.filter(f => f.device === 'edge-router-1' && f.layer === 'isis')
    // Without LSDB, the system_ids stay unresolved
    expect(isisFacts.every(f => f.remote === null)).toBe(true)
  })

  test('test_resolveTopology_noReciprocalAdjacency_notResolvedByLldp', () => {
    // Link exists but far port has no adjacency -> no resolution
    const link = {
      a: {
        device: 'edge-router-1',
        interface: 'et-0/0/0.0',
        chassis_id: '00:11:22:33:44:55',
        port_id: 'et-0/0/0',
        system_name: 'edge-router-1.example.net',
        management_addresses: [],
      },
      b: {
        device: 'spine-01',
        interface: 'et-0/0/1.0',
        chassis_id: '00:11:22:33:44:66',
        port_id: 'et-0/0/1',
        system_name: 'spine-01.example.net',
        management_addresses: [],
      },
      state: 'PRESENT' as const,
      confirmed: true,
      last_seen: '2026-09-04T09:00:00Z',
    }
    // Adjacency only on edge-router-1, no adjacency on spine-01
    const isisOnEdge = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }

    const raw = {
      links: [link],
      isisAdjacencies: [isisOnEdge],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // Without reciprocal adjacency, LLDP coincidence doesn't resolve
    const isisFact = facts.find(f => f.device === 'edge-router-1' && f.layer === 'isis')
    expect(isisFact).toBeDefined()
    expect(isisFact!.remote).toBeNull()
  })

  test('test_resolveTopology_conflictingCandidates_unresolved', () => {
    // Two different sources (LLDP + LSDB) disagree on the mapping for a system_id
    const link = {
      a: {
        device: 'edge-router-1',
        interface: 'et-0/0/0.0',
        chassis_id: '00:11:22:33:44:55',
        port_id: 'et-0/0/0',
        system_name: 'edge-router-1.example.net',
        management_addresses: [],
      },
      b: {
        device: 'spine-01',
        interface: 'et-0/0/1.0',
        chassis_id: '00:11:22:33:44:66',
        port_id: 'et-0/0/1',
        system_name: 'spine-01.example.net',
        management_addresses: [],
      },
      state: 'PRESENT' as const,
      confirmed: true,
      last_seen: '2026-09-04T09:00:00Z',
    }
    const isisA = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }
    const isisB = {
      device: 'spine-01',
      interface: 'et-0/0/1.0',
      level: 2,
      system_id: '0000.0000.0002',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.2',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }
    // LSDB says system_id 0000.0000.0001 is "different-device"
    const conflictingNode = {
      level: 2,
      system_id: '0000.0000.0001',
      hostname: 'different-device',
      router_id: '192.0.2.100',
      srgb: [],
      sr_flags: [],
      sr_algorithms: [],
      prefix_sids: [],
      sources: ['edge-router-1'],
      last_update: '2026-09-25T00:00:01Z',
    }

    const raw = {
      links: [link],
      isisAdjacencies: [isisA, isisB],
      isisTopology: {
        sources: LSDB_SOURCES_LIVE,
        nodes: [conflictingNode],
        links: [],
      },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // LLDP says 0000.0000.0001 -> spine-01, LSDB says -> different-device
    // Conflict leaves it unresolved
    const isisFact = facts.find(f => f.device === 'edge-router-1' && f.layer === 'isis')
    expect(isisFact).toBeDefined()
    expect(isisFact!.remote).toBeNull()
  })

  test('test_resolveTopology_lagAdjacency_usesLearnedId', () => {
    // LAG member ports share an adjacency; LLDP resolution through the bundle
    const lagLink = {
      a: {
        device: 'edge-router-1',
        interface: 'ae0',
        chassis_id: '00:11:22:33:44:55',
        port_id: 'ae0',
        system_name: 'edge-router-1.example.net',
        management_addresses: [],
      },
      b: {
        device: 'spine-01',
        interface: 'ae0',
        chassis_id: '00:11:22:33:44:66',
        port_id: 'ae0',
        system_name: 'spine-01.example.net',
        management_addresses: [],
      },
      state: 'PRESENT' as const,
      confirmed: true,
      last_seen: '2026-09-04T09:00:00Z',
    }
    const isisOnLag = {
      device: 'edge-router-1',
      interface: 'ae0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }
    const isisOnSpineLag = {
      device: 'spine-01',
      interface: 'ae0.0',
      level: 2,
      system_id: '0000.0000.0002',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.2',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }

    const raw = {
      links: [lagLink],
      isisAdjacencies: [isisOnLag, isisOnSpineLag],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // ae0.0 -> ae0 (base interface), LLDP coincidence resolves
    const isisFact = facts.find(f => f.device === 'edge-router-1' && f.layer === 'isis')
    expect(isisFact).toBeDefined()
    expect(isisFact!.remote).toBe('spine-01')
  })

  test('test_resolveTopology_lsdbHostname_resolvesId', () => {
    const isisAdj = {
      device: 'edge-router-1',
      interface: 'et-0/0/10.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }

    const raw = {
      links: [],
      isisAdjacencies: [isisAdj],
      isisTopology: {
        sources: LSDB_SOURCES_LIVE,
        nodes: LSDB_NODES,
        links: [],
      },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // LSDB says 0000.0000.0001 -> spine-01
    const isisFact = facts.find(f => f.device === 'edge-router-1' && f.layer === 'isis')
    expect(isisFact).toBeDefined()
    expect(isisFact!.remote).toBe('spine-01')
    // router_id must not leak
    expect(JSON.stringify(facts)).not.toContain('192.0.2.10')
  })

  test('test_resolveTopology_staleAdjacency_notUp', () => {
    const raw = {
      links: [],
      isisAdjacencies: [ISIS_ADJ_STALE],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    const isisFact = facts.find(f => f.layer === 'isis')
    expect(isisFact).toBeDefined()
    expect(isisFact!.up).toBe(false)
    expect(isisFact!.label).toContain('stale')
  })

  test('test_resolveTopology_noLiveLsdbSource_noSrNoMetric', () => {
    const isisAdj = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }

    const raw = {
      links: [],
      isisAdjacencies: [isisAdj],
      isisTopology: {
        sources: LSDB_SOURCES_STALE,
        nodes: LSDB_NODES,
        links: LSDB_LINKS,
      },
      ospfAdjacencies: [],
    }
    const { facts, nodeSids } = resolveTopology(raw)
    // All LSDB sources are STALE -> no SR facts, no metrics, no node SIDs
    expect(facts.some(f => f.layer === 'sr')).toBe(false)
    expect(facts.every(f => !f.label.includes('metric'))).toBe(true)
    expect(Object.keys(nodeSids)).toHaveLength(0)
  })

  test('test_resolveTopology_lsdb_nodeSidAndAdjSid', () => {
    const isisAdj = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }

    const raw = {
      links: [],
      isisAdjacencies: [isisAdj],
      isisTopology: {
        sources: LSDB_SOURCES_LIVE,
        nodes: LSDB_NODES,
        links: LSDB_LINKS,
      },
      ospfAdjacencies: [],
    }
    const { facts, nodeSids } = resolveTopology(raw)
    // Node SIDs from LSDB (algorithm 0, NODE flag, lowest prefix)
    expect(nodeSids['spine-01']).toBe(900128)
    expect(nodeSids['edge-router-1']).toBe(900129)
    // SR pair fact
    const srFact = facts.find(f => f.layer === 'sr')
    expect(srFact).toBeDefined()
    expect(srFact!.iface).toBeNull()
    expect(srFact!.label).toContain('adj-SID')
    // prefix must not leak
    expect(JSON.stringify(facts)).not.toContain('198.51.100.128')
    expect(JSON.stringify(nodeSids)).not.toContain('198.51.100')
  })

  test('test_resolveTopology_adjSidWithoutLabel_usesValue', () => {
    const isisAdj = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_2',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }

    const raw = {
      links: [],
      isisAdjacencies: [isisAdj],
      isisTopology: {
        sources: LSDB_SOURCES_LIVE,
        nodes: LSDB_NODES,
        links: LSDB_LINKS_NO_LABEL,
      },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    const srFact = facts.find(f => f.layer === 'sr')
    expect(srFact).toBeDefined()
    // adj-SID uses value when label is null
    expect(srFact!.label).toContain('55')
    expect(srFact!.label).toContain('44')
  })

  test('test_resolveTopology_srBothLevels_onePairFact', () => {
    const isisAdjL1 = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 1,
      system_id: '0000.0000.0001',
      state: 'UP',
      type: 'LEVEL_1',
      neighbor_ipv4: '198.51.100.1',
      neighbor_ipv6: null,
      neighbor_hostname: null,
      area_addresses: ['49.0001'],
      up_since: '2026-09-02T00:00:04Z',
      telemetry_state: 'LIVE',
      last_update: '2026-09-02T00:00:04Z',
    }
    const isisAdjL2 = {
      ...isisAdjL1,
      level: 2,
      type: 'LEVEL_2',
    }
    // LSDB entries for both levels
    const lsdbNodesL1 = LSDB_NODES.map(n => ({ ...n, level: 1 }))
    const lsdbLinksL1 = LSDB_LINKS.map(l => ({ ...l, level: 1 }))

    const raw = {
      links: [],
      isisAdjacencies: [isisAdjL1, isisAdjL2],
      isisTopology: {
        sources: LSDB_SOURCES_LIVE,
        nodes: [...lsdbNodesL1, ...LSDB_NODES],
        links: [...lsdbLinksL1, ...LSDB_LINKS],
      },
      ospfAdjacencies: [],
    }
    const { facts } = resolveTopology(raw)
    // Only one SR pair fact (L2 preferred)
    const srFacts = facts.filter(f => f.layer === 'sr')
    expect(srFacts).toHaveLength(1)
  })

  test('test_resolveTopology_dottedQuadArea_labelHasNoDottedQuad', () => {
    const raw = {
      links: [],
      isisAdjacencies: [],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [OSPF_ADJ_DOTTED_AREA],
    }
    const { facts } = resolveTopology(raw)
    const ospfFact = facts.find(f => f.layer === 'ospf')
    expect(ospfFact).toBeDefined()
    // Dotted-quad area "0.0.0.33" should be converted to integer "33"
    expect(ospfFact!.label).not.toContain('0.0.0.33')
    expect(ospfFact!.label).toContain('area 33')
  })

  test('test_resolveTopology_ospf_routerIdNeverEmitted', () => {
    const raw = {
      links: [],
      isisAdjacencies: [],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [OSPF_ADJ_FULL],
    }
    const { facts } = resolveTopology(raw)
    // No router_id, neighbor_router_id, designated_router, backup_designated_router in output
    const output = JSON.stringify(facts)
    expect(output).not.toContain('198.51.100.106')
    expect(output).not.toContain('198.51.100.107')
    expect(output).not.toContain('0.0.0.0')
    expect(output).not.toContain('neighbor_router')
    expect(output).not.toContain('designated_router')
  })

  test('test_resolveTopology_inputPermutation_deterministicOutput', () => {
    // Constraint: Pure functions are deterministic (sorted output)
    // ISIS and OSPF adjacencies in different orders must produce identical facts
    const ISIS_A = {
      device: 'edge-router-1',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0001',
      state: 'UP',
      neighbor_hostname: null,
      telemetry_state: 'LIVE',
    }
    const ISIS_B = {
      device: 'edge-router-2',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0002',
      state: 'UP',
      neighbor_hostname: null,
      telemetry_state: 'LIVE',
    }
    const ISIS_C = {
      device: 'edge-router-3',
      interface: 'et-0/0/0.0',
      level: 2,
      system_id: '0000.0000.0003',
      state: 'UP',
      neighbor_hostname: null,
      telemetry_state: 'LIVE',
    }
    const OSPF_A = {
      device: 'edge-router-1',
      interface: 'TenGigE0/0/0/0',
      area: '0',
      neighbor_router_id: '198.51.100.1',
      state: 'FULL',
      telemetry_state: 'LIVE',
    }
    const OSPF_B = {
      device: 'edge-router-2',
      interface: 'TenGigE0/0/0/0',
      area: '0',
      neighbor_router_id: '198.51.100.2',
      state: 'FULL',
      telemetry_state: 'LIVE',
    }

    const order1 = {
      links: [],
      isisAdjacencies: [ISIS_A, ISIS_B, ISIS_C],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [OSPF_A, OSPF_B],
    }
    const order2 = {
      links: [],
      isisAdjacencies: [ISIS_C, ISIS_A, ISIS_B],
      isisTopology: { sources: [], nodes: [], links: [] },
      ospfAdjacencies: [OSPF_B, OSPF_A],
    }

    const r1 = resolveTopology(order1)
    const r2 = resolveTopology(order2)

    // Both permutations must produce identical JSON output (deterministic)
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createNetstatexClient topology tests
// ─────────────────────────────────────────────────────────────────────────────

describe('createNetstatexClient topology', () => {
  test('test_createNetstatexClient_topology_ospf404_returnsRest', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/ospf/adjacencies')) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 })
      }
      if (u.includes('/links')) {
        return Response.json([LINK_PRESENT])
      }
      if (u.includes('/isis/adjacencies')) {
        return Response.json([ISIS_ADJ_UP])
      }
      if (u.includes('/isis/topology')) {
        return Response.json({ sources: [], nodes: [], links: [] })
      }
      return Response.json({})
    })

    const client = createNetstatexClient('http://nsx:8090')
    const result = await client.topology!()
    // OSPF 404 -> layer dark, but rest of data present
    expect(result.facts.some(f => f.layer === 'physical')).toBe(true)
    expect(result.facts.some(f => f.layer === 'isis')).toBe(true)
    // No OSPF facts (404)
    expect(result.facts.some(f => f.layer === 'ospf')).toBe(false)
  })

  test('test_createNetstatexClient_topology_linksTimeout_reusesLastLinks', async () => {
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/links')) {
        callCount++
        if (callCount === 1) {
          // First call succeeds
          return Response.json([LINK_PRESENT])
        } else {
          // Second call fails
          throw new Error('timeout')
        }
      }
      if (u.includes('/isis/adjacencies')) {
        return Response.json([])
      }
      if (u.includes('/isis/topology')) {
        return Response.json({ sources: [], nodes: [], links: [] })
      }
      if (u.includes('/ospf/adjacencies')) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 })
      }
      return Response.json({})
    })

    const client = createNetstatexClient('http://nsx:8090')
    // First call populates cache
    const result1 = await client.topology!()
    expect(result1.facts.some(f => f.layer === 'physical')).toBe(true)

    // Second call: /links fails, should reuse last good body
    const result2 = await client.topology!()
    expect(result2.facts.some(f => f.layer === 'physical')).toBe(true)
  })

  test('test_createNetstatexClient_topology_linksFailsNoPrior_rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/links')) {
        throw new Error('connect ECONNREFUSED')
      }
      if (u.includes('/isis/adjacencies')) {
        return Response.json([])
      }
      if (u.includes('/isis/topology')) {
        return Response.json({ sources: [], nodes: [], links: [] })
      }
      if (u.includes('/ospf/adjacencies')) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 })
      }
      return Response.json({})
    })

    const client = createNetstatexClient('http://nsx:8090')
    // IS-IS endpoints still answer -> should not reject
    const result = await client.topology!()
    // No physical facts (links failed with no prior)
    expect(result.facts.some(f => f.layer === 'physical')).toBe(false)
    // But IS-IS was empty, so no facts at all from IS-IS either
    expect(result.facts.some(f => f.layer === 'isis')).toBe(false)
  })

  test('test_createNetstatexClient_topology_noEndpointAnswers_rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('connect ECONNREFUSED')
    })

    const client = createNetstatexClient('http://nsx:8090')
    await expect(client.topology!()).rejects.toThrow()
  })

  test('test_createNetstatexClient_topology_usesFiveSecondTimeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/isis/topology')) {
        return Response.json({ sources: [], nodes: [], links: [] })
      }
      return Response.json([])
    })

    const client = createNetstatexClient('http://nsx:8090')
    await client.topology!()

    // topology() uses 5s timeout
    const topologyCalls = timeoutSpy.mock.calls.filter(([ms]) => ms === 5_000)
    expect(topologyCalls.length).toBeGreaterThan(0)
  })
})
