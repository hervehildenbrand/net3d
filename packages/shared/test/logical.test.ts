import { describe, expect, test } from 'vitest'
import { baseInterface, safeName, classifyTier, sotLinks, factCable } from '../src/logical'
import type { TraceCable } from '../src/cabletrace'

describe('baseInterface', () => {
  test('test_baseInterface_junosUnit_stripsSuffix', () => {
    expect(baseInterface('et-0/0/0.0')).toBe('et-0/0/0')
    expect(baseInterface('xe-1/2/3.100')).toBe('xe-1/2/3')
    expect(baseInterface('ge-0/0/0.999')).toBe('ge-0/0/0')
    // no unit suffix -> unchanged
    expect(baseInterface('et-0/0/0')).toBe('et-0/0/0')
    expect(baseInterface('Ethernet1/1')).toBe('Ethernet1/1')
  })
})

describe('safeName', () => {
  test('test_safeName_ipv4Anywhere_returnsNull', () => {
    // exact addresses
    expect(safeName('192.0.2.1')).toBeNull()
    expect(safeName('198.51.100.254')).toBeNull()
    expect(safeName('203.0.113.0')).toBeNull()
    // embedded in larger string
    expect(safeName('device-192.0.2.1.example.net')).toBeNull()
    expect(safeName('prefix-192.0.2.40-suffix')).toBeNull()
    // safe names pass through
    expect(safeName('edge-router-1')).toBe('edge-router-1')
    expect(safeName('site-a-leaf-01')).toBe('site-a-leaf-01')
    // null in, null out
    expect(safeName(null)).toBeNull()
  })

  test('test_safeName_ipv6OrMac_returnsNull', () => {
    // IPv6 (colon-separated hex)
    expect(safeName('2001:db8::1')).toBeNull()
    expect(safeName('fe80::1')).toBeNull()
    expect(safeName('::1')).toBeNull()
    // MAC colon notation
    expect(safeName('00:11:22:33:44:55')).toBeNull()
    expect(safeName('aa:bb:cc:dd:ee:ff')).toBeNull()
    // MAC dash notation
    expect(safeName('00-11-22-33-44-55')).toBeNull()
    expect(safeName('AA-BB-CC-DD-EE-FF')).toBeNull()
    // MAC dotted-quad-of-hex notation (Cisco-style)
    expect(safeName('0011.2233.4455')).toBeNull()
    expect(safeName('aabb.ccdd.eeff')).toBeNull()
    // safe: colons in port names are fine when not hex pattern
    expect(safeName('Ethernet1:1')).toBe('Ethernet1:1')
  })
})

describe('classifyTier', () => {
  test('test_classifyTier_showcaseAndFixtureRoles_expectedTiers', () => {
    // Showcase roles (from seed.py ROLE_COLORS)
    expect(classifyTier('spine', false)).toBe('spine')
    expect(classifyTier('Spine', false)).toBe('spine')  // case-insensitive
    expect(classifyTier('leaf', false)).toBe('leaf')
    expect(classifyTier('Leaf', false)).toBe('leaf')
    expect(classifyTier('core', false)).toBe('core')
    expect(classifyTier('Core', false)).toBe('core')
    expect(classifyTier('oob', false)).toBe('leaf')
    expect(classifyTier('server', false)).toBe('end')
    expect(classifyTier('patch-panel', false)).toBe('end')

    // Generic fixture roles
    expect(classifyTier('access', false)).toBe('leaf')
    expect(classifyTier('switch', false)).toBe('leaf')
    expect(classifyTier('router', false)).toBe('core')
    expect(classifyTier('edge', false)).toBe('core')
    expect(classifyTier('border', false)).toBe('core')
    expect(classifyTier('firewall', false)).toBe('core')
  })

  test('test_classifyTier_monitorAndStorage_end', () => {
    // 'monitor' and 'storage' must NOT match the leaf regex (which uses word-bounded 'tor')
    expect(classifyTier('monitor', false)).toBe('end')
    expect(classifyTier('storage', false)).toBe('end')
    expect(classifyTier('storage-server', false)).toBe('end')
    // 'tor' as standalone word IS leaf
    expect(classifyTier('tor', false)).toBe('leaf')
    expect(classifyTier('tor-01', false)).toBe('leaf')
    expect(classifyTier('dc1-tor', false)).toBe('leaf')
    expect(classifyTier('dc1-tor-01', false)).toBe('leaf')
  })

  test('test_classifyTier_unknownRoleWithIgp_core', () => {
    // Unknown role without IGP is end
    expect(classifyTier('database', false)).toBe('end')
    expect(classifyTier('unknown-thing', false)).toBe('end')
    // Unknown role with IGP is core
    expect(classifyTier('database', true)).toBe('core')
    expect(classifyTier('unknown-thing', true)).toBe('core')
    // Named roles still win over hasIgp
    expect(classifyTier('leaf', true)).toBe('leaf')
    expect(classifyTier('spine', true)).toBe('spine')
  })
})

// Test fixture helpers for cables
const iface = (dev: string, name: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'device', name, deviceName: dev, rackName: rack, termType: 'interface',
})
const front = (dev: string, name: string, rear: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'device', name, deviceName: dev, rackName: rack, termType: 'front-port', pairedPort: rear,
})
const rear = (dev: string, name: string, front_: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'device', name, deviceName: dev, rackName: rack, termType: 'rear-port', pairedPort: front_,
})
const power = (name: string, rack = 'R1'): NonNullable<TraceCable['a']> => ({
  kind: 'powerfeed', name, deviceName: null, rackName: rack,
})
const circuit = (name: string): NonNullable<TraceCable['a']> => ({
  kind: 'circuit', name, deviceName: null, rackName: null,
})

describe('sotLinks', () => {
  test('test_sotLinks_panelRouted_stableIdAcrossInputOrder', () => {
    // Panel-routed link id must not change based on input array order
    // (Task 3 relies on stable member ids)
    const cables_order1: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: front('panel-01', 'P1', 'R1') },
      { id: 'c2', a: rear('panel-01', 'R1', 'P1'), b: iface('spine-01', 'Ethernet1/1') },
    ]
    const cables_order2: TraceCable[] = [
      { id: 'c2', a: rear('panel-01', 'R1', 'P1'), b: iface('spine-01', 'Ethernet1/1') },
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: front('panel-01', 'P1', 'R1') },
    ]
    const links1 = sotLinks(cables_order1)
    const links2 = sotLinks(cables_order2)
    expect(links1).toHaveLength(1)
    expect(links2).toHaveLength(1)
    // Both orderings must yield identical id
    expect(links1[0]!.id).toBe(links2[0]!.id)
    // And identical endpoints (a/b)
    expect(links1[0]!.a).toEqual(links2[0]!.a)
    expect(links1[0]!.b).toEqual(links2[0]!.b)
  })

  test('test_sotLinks_directCable_oneLink', () => {
    // Direct interface<->interface cable yields one link
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: iface('spine-01', 'Ethernet1/1') },
    ]
    const links = sotLinks(cables)
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({
      id: 'c1',
      a: { deviceName: 'edge-router-1', name: 'et-0/0/0' },
      b: { deviceName: 'spine-01', name: 'Ethernet1/1' },
    })
  })

  test('test_sotLinks_panelRouted_joinsInterfaces', () => {
    // Cable through patch panel: interface -> front -> rear -> interface
    // Should collapse to one link between the two interfaces
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: front('panel-01', 'P1', 'R1') },
      { id: 'c2', a: rear('panel-01', 'R1', 'P1'), b: iface('spine-01', 'Ethernet1/1') },
    ]
    const links = sotLinks(cables)
    expect(links).toHaveLength(1)
    // id must be deterministic - use first cable's id for consistency
    expect(links[0]!.a).toEqual({ deviceName: 'edge-router-1', name: 'et-0/0/0' })
    expect(links[0]!.b).toEqual({ deviceName: 'spine-01', name: 'Ethernet1/1' })
  })

  test('test_sotLinks_incompleteTrace_omitted', () => {
    // Incomplete trace (dangling cable, no far interface) should be omitted
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: front('panel-01', 'P1', 'R1') },
      // No cable from rear port - incomplete trace
    ]
    const links = sotLinks(cables)
    expect(links).toHaveLength(0)
  })

  test('test_sotLinks_powerAndCircuitEnds_omitted', () => {
    // Power and circuit terminations should not yield links
    const cables: TraceCable[] = [
      { id: 'c1', a: iface('edge-router-1', 'et-0/0/0'), b: power('PDU-A-1') },
      { id: 'c2', a: iface('edge-router-1', 'et-0/0/1'), b: circuit('CID-001') },
      // Direct cable for comparison - this one should still work
      { id: 'c3', a: iface('edge-router-1', 'et-0/0/2'), b: iface('spine-01', 'Ethernet1/1') },
    ]
    const links = sotLinks(cables)
    expect(links).toHaveLength(1)
    expect(links[0]!.id).toBe('c3')
  })
})

describe('factCable', () => {
  test('test_factCable_resolvedObservation_bothEnds', () => {
    // factCable builds a TopologyCable from a resolved observation
    const cable = factCable({
      device: 'edge-router-1',
      iface: 'et-0/0/0',
      remote: 'spine-01',
      remoteIface: 'Ethernet1/1',
    })
    expect(cable).toEqual({
      id: 'lldp:edge-router-1:et-0/0/0',
      a: { deviceName: 'edge-router-1', name: 'et-0/0/0' },
      b: { deviceName: 'spine-01', name: 'Ethernet1/1' },
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildLogicalGraph tests
// ─────────────────────────────────────────────────────────────────────────────

import { buildLogicalGraph, type GraphInput, type GraphDevice, type TopologyFact, type TopologyCable } from '../src/logical'

// Test fixture helpers
const dev = (name: string, site = 'site-a', role = 'server'): GraphDevice => ({
  id: name, name, siteName: site, roleName: role, roleColor: '2196f3',
})

const link = (id: string, aDevice: string, aPort: string, bDevice: string, bPort: string): TopologyCable => ({
  id,
  a: { deviceName: aDevice, name: aPort },
  b: { deviceName: bDevice, name: bPort },
})

const emptyInput = (): GraphInput => ({
  devices: [],
  links: [],
  circuits: [],
  circuitSites: {},
  lldp: {},
})

describe('buildLogicalGraph', () => {
  test('test_buildLogicalGraph_cableAndLldpSamePort_oneEdgeOneMember', () => {
    // A cable and an LLDP observation on the same port yield one edge with one member
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: 'spine-01', port: 'Ethernet1/1' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.members).toHaveLength(1)
    expect(graph.edges[0]!.members[0]!.id).toBe('c1')
  })

  test('test_buildLogicalGraph_lldpFromBothEnds_oneMember', () => {
    // LLDP reported from both ends of a link collapses to one member
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: 'spine-01', port: 'Ethernet1/1' }] },
        'spine-01': { 'Ethernet1/1': [{ hostname: 'leaf-01', port: 'et-0/0/0' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.members).toHaveLength(1)
  })

  test('test_buildLogicalGraph_crossSiteFactOnCircuitPort_noExtraMember', () => {
    // A collector physical fact on a circuit port does not create an extra member
    const input: GraphInput = {
      devices: [dev('edge-router-1', 'site-a', 'core')],
      links: [],
      circuits: [{ id: 'CID-001', a: { deviceName: 'edge-router-1', name: 'et-0/0/0' }, b: null }],
      circuitSites: { 'CID-001': ['site-a', 'site-b'] },
      lldp: {},
      topology: {
        facts: [{ layer: 'physical', device: 'edge-router-1', iface: 'et-0/0/0', remote: 'edge-router-2', remoteIface: 'et-0/0/0', up: true, label: 'L2 UP' }],
        nodeSids: {},
        circuits: [{ id: 'CID-001', a: { deviceName: 'edge-router-1', name: 'et-0/0/0' }, b: { deviceName: 'edge-router-2', name: 'et-0/0/0' } }],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    // The circuit to site:site-b should exist with no extra member from the fact
    const circuitEdge = graph.edges.find(e => e.a === 'edge-router-1' || e.b === 'edge-router-1')
    expect(circuitEdge).toBeDefined()
    expect(circuitEdge!.members).toHaveLength(1)
    expect(circuitEdge!.members[0]!.id).toBe('CID-001')
  })

  test('test_buildLogicalGraph_panelRoutedCableAndFact_oneMember', () => {
    // A panel-routed cable (collapsed by sotLinks) and a matching LLDP fact yield one member
    // (The links array already contains the collapsed link from sotLinks)
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: 'spine-01', port: 'Ethernet1/1' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.members).toHaveLength(1)
  })

  test('test_buildLogicalGraph_lldpContradictsCable_observedReplacesDocumented', () => {
    // LLDP says leaf-01:et-0/0/0 connects to spine-02, cable says spine-01
    // When observed remote is a known device, observed wins
    const input: GraphInput = {
      devices: [
        dev('leaf-01', 'site-a', 'leaf'),
        dev('spine-01', 'site-a', 'spine'),
        dev('spine-02', 'site-a', 'spine'),
      ],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: 'spine-02', port: 'Ethernet1/2' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    // Should have edge to spine-02, not spine-01
    const edge = graph.edges.find(e => e.a === 'leaf-01' || e.b === 'leaf-01')
    expect(edge).toBeDefined()
    expect(edge!.a === 'spine-02' || edge!.b === 'spine-02').toBe(true)
    expect(edge!.a === 'spine-01' || edge!.b === 'spine-01').toBe(false)
  })

  test('test_buildLogicalGraph_unresolvedNameOnCabledPort_documentedKept', () => {
    // LLDP reports an unknown hostname on a cabled port; documented member is kept
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: 'unknown-box.example.net', port: 'Ethernet1' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const edge = graph.edges.find(e => e.a === 'leaf-01' || e.b === 'leaf-01')
    expect(edge).toBeDefined()
    expect(edge!.a === 'spine-01' || edge!.b === 'spine-01').toBe(true)
    expect(edge!.members[0]!.id).toBe('c1')
  })

  test('test_buildLogicalGraph_unknownLldpNeighbour_endNode', () => {
    // LLDP reports an unknown hostname; creates an ext: end node
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf')],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: 'server-42.example.net', port: 'eth0' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const extNode = graph.nodes.find(n => n.id.startsWith('ext:'))
    expect(extNode).toBeDefined()
    expect(extNode!.tier).toBe('end')
  })

  test('test_buildLogicalGraph_unnamedNeighbour_portKeyedNode', () => {
    // LLDP reports null/empty hostname; node id is ext:<device>:<iface>
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf')],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: '', port: 'eth0' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const extNode = graph.nodes.find(n => n.id === 'ext:leaf-01:et-0/0/0')
    expect(extNode).toBeDefined()
    expect(extNode!.tier).toBe('end')
  })

  test('test_buildLogicalGraph_suffixedSystemNames_distinctEndNodes', () => {
    // LLDP reports 'server-01' and 'server-01#2' on different ports; they are distinct end nodes
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf')],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': {
          'et-0/0/0': [{ hostname: 'server-01', port: 'eth0' }],
          'et-0/0/1': [{ hostname: 'server-01#2', port: 'eth0' }],
        },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const extNodes = graph.nodes.filter(n => n.id.startsWith('ext:'))
    expect(extNodes.length).toBeGreaterThanOrEqual(2)
    const ids = new Set(extNodes.map(n => n.id))
    expect(ids.size).toBe(extNodes.length) // all distinct
  })

  test('test_buildLogicalGraph_mixedCaseSotName_resolvedToExactName', () => {
    // LLDP reports 'SPINE-01' (uppercase), SoT has 'Spine-01' (mixed case)
    // Should resolve to the exact SoT name
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), { ...dev('Spine-01', 'site-a', 'spine'), name: 'Spine-01' }],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: 'SPINE-01', port: 'Ethernet1/1' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const spineNode = graph.nodes.find(n => n.id === 'Spine-01')
    expect(spineNode).toBeDefined()
    expect(graph.nodes.filter(n => n.id.startsWith('ext:')).length).toBe(0)
  })

  test('test_buildLogicalGraph_fqdnAndSitePrefixedHostname_resolved', () => {
    // LLDP reports 'site-a-spine-01.example.net', SoT has 'spine-01'
    // Should resolve via suffix match
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: 'site-a-spine-01.example.net', port: 'Ethernet1/1' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const edge = graph.edges.find(e => e.a === 'leaf-01' || e.b === 'leaf-01')
    expect(edge).toBeDefined()
    expect(edge!.a === 'spine-01' || edge!.b === 'spine-01').toBe(true)
  })

  test('test_buildLogicalGraph_isisFactOnCabledPort_layerAdded', () => {
    // IS-IS fact on a cabled port adds the isis layer to that edge
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {},
      topology: {
        facts: [{ layer: 'isis', device: 'leaf-01', iface: 'et-0/0/0', remote: 'spine-01', remoteIface: 'Ethernet1/1', up: true, label: 'L2 UP metric 10' }],
        nodeSids: {},
        circuits: [],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.layers.isis).toBeDefined()
    expect(graph.edges[0]!.layers.isis!.up).toBe(1)
    expect(graph.edges[0]!.layers.isis!.total).toBe(1)
  })

  test('test_buildLogicalGraph_igpFactOnRemotePortOfFact_layerAdded', () => {
    // IGP fact references the remote port of another fact; layer is added correctly
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {},
      topology: {
        facts: [
          { layer: 'isis', device: 'leaf-01', iface: 'et-0/0/0', remote: 'spine-01', remoteIface: 'Ethernet1/1', up: true, label: 'L2 UP' },
          { layer: 'isis', device: 'spine-01', iface: 'Ethernet1/1', remote: 'leaf-01', remoteIface: 'et-0/0/0', up: true, label: 'L2 UP' },
        ],
        nodeSids: {},
        circuits: [],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.layers.isis!.total).toBe(2)
    expect(graph.edges[0]!.layers.isis!.up).toBe(2)
  })

  test('test_buildLogicalGraph_igpRemoteDiffersFromPortMember_ownEdge', () => {
    // IGP fact names a different remote than the port's member; gets its own edge
    const input: GraphInput = {
      devices: [
        dev('leaf-01', 'site-a', 'leaf'),
        dev('spine-01', 'site-a', 'spine'),
        dev('spine-02', 'site-a', 'spine'),
      ],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {},
      topology: {
        facts: [{ layer: 'isis', device: 'leaf-01', iface: 'et-0/0/0', remote: 'spine-02', remoteIface: null, up: true, label: 'L2 UP' }],
        nodeSids: {},
        circuits: [],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    // Should have edges to both spine-01 (cable) and spine-02 (IGP)
    const spine01Edge = graph.edges.find(e => e.a === 'spine-01' || e.b === 'spine-01')
    const spine02Edge = graph.edges.find(e => e.a === 'spine-02' || e.b === 'spine-02')
    expect(spine01Edge).toBeDefined()
    expect(spine02Edge).toBeDefined()
    expect(spine02Edge!.layers.isis).toBeDefined()
  })

  test('test_buildLogicalGraph_igpLagWithPhysicalMembers_noExtraMember', () => {
    // IGP fact on a LAG interface; physical members exist; no extra member added
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [
        link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1'),
        link('c2', 'leaf-01', 'et-0/0/1', 'spine-01', 'Ethernet1/2'),
      ],
      circuits: [],
      circuitSites: {},
      lldp: {},
      topology: {
        facts: [{ layer: 'isis', device: 'leaf-01', iface: 'ae0', remote: 'spine-01', remoteIface: null, up: true, label: 'L2 UP' }],
        nodeSids: {},
        circuits: [],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const edge = graph.edges.find(e => e.a === 'leaf-01' || e.b === 'leaf-01')
    expect(edge).toBeDefined()
    // Physical members only; no igp:<device>:<iface> member
    expect(edge!.members.every(m => !m.id.startsWith('igp:'))).toBe(true)
    expect(edge!.layers.isis).toBeDefined()
  })

  test('test_buildLogicalGraph_parallelIsisOneDown_upBelowTotal', () => {
    // Two IS-IS adjacencies on parallel links, one down
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [
        link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1'),
        link('c2', 'leaf-01', 'et-0/0/1', 'spine-01', 'Ethernet1/2'),
      ],
      circuits: [],
      circuitSites: {},
      lldp: {},
      topology: {
        facts: [
          { layer: 'isis', device: 'leaf-01', iface: 'et-0/0/0', remote: 'spine-01', remoteIface: 'Ethernet1/1', up: true, label: 'L2 UP' },
          { layer: 'isis', device: 'leaf-01', iface: 'et-0/0/1', remote: 'spine-01', remoteIface: 'Ethernet1/2', up: false, label: 'L2 DOWN' },
        ],
        nodeSids: {},
        circuits: [],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.layers.isis!.up).toBe(1)
    expect(graph.edges[0]!.layers.isis!.total).toBe(2)
  })

  test('test_buildLogicalGraph_l1UpL2Down_deterministicState', () => {
    // Physical layer up, IS-IS layer down on same port; layers independent
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {},
      topology: {
        facts: [
          { layer: 'physical', device: 'leaf-01', iface: 'et-0/0/0', remote: 'spine-01', remoteIface: 'Ethernet1/1', up: true, label: 'L1 UP' },
          { layer: 'isis', device: 'leaf-01', iface: 'et-0/0/0', remote: 'spine-01', remoteIface: 'Ethernet1/1', up: false, label: 'L2 DOWN' },
        ],
        nodeSids: {},
        circuits: [],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.layers.physical!.up).toBe(1)
    expect(graph.edges[0]!.layers.isis!.up).toBe(0)
  })

  test('test_buildLogicalGraph_unresolvedFact_dropped', () => {
    // IGP fact with unresolved remote (device not in SoT); dropped
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf')],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {},
      topology: {
        facts: [{ layer: 'isis', device: 'leaf-01', iface: 'et-0/0/0', remote: 'unknown-device', remoteIface: null, up: true, label: 'L2 UP' }],
        nodeSids: {},
        circuits: [],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    // leaf-01 should be present (it's a leaf) but no edge to unknown-device
    expect(graph.nodes.find(n => n.id === 'leaf-01')).toBeDefined()
    expect(graph.edges.filter(e => e.layers.isis).length).toBe(0)
  })

  test('test_buildLogicalGraph_pairFactSr_layerAndSid', () => {
    // SR pair fact (iface null) adds sr layer and node SIDs
    const input: GraphInput = {
      devices: [dev('core-01', 'site-a', 'core'), dev('core-02', 'site-a', 'core')],
      links: [link('c1', 'core-01', 'et-0/0/0', 'core-02', 'et-0/0/0')],
      circuits: [],
      circuitSites: {},
      lldp: {},
      topology: {
        facts: [{ layer: 'sr', device: 'core-01', iface: null, remote: 'core-02', remoteIface: null, up: true, label: 'adj-SID 34/23' }],
        nodeSids: { 'core-01': 100, 'core-02': 101 },
        circuits: [],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const edge = graph.edges.find(e => (e.a === 'core-01' && e.b === 'core-02') || (e.a === 'core-02' && e.b === 'core-01'))
    expect(edge).toBeDefined()
    expect(edge!.layers.sr).toBeDefined()
    expect(edge!.layers.sr!.label).toBe('adj-SID 34/23')
    // Check SIDs on nodes
    const core01 = graph.nodes.find(n => n.id === 'core-01')
    const core02 = graph.nodes.find(n => n.id === 'core-02')
    expect(core01!.sid).toBe(100)
    expect(core02!.sid).toBe(101)
  })

  test('test_buildLogicalGraph_twoNeighboursOnePort_twoEdges', () => {
    // Two LLDP neighbours on one port (e.g., shared media); creates two edges
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf')],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': {
          'et-0/0/0': [
            { hostname: 'server-01', port: 'eth0' },
            { hostname: 'server-02', port: 'eth0' },
          ],
        },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    // leaf-01 should have edges to both ext:server-01 and ext:server-02
    const leafEdges = graph.edges.filter(e => e.a === 'leaf-01' || e.b === 'leaf-01')
    expect(leafEdges.length).toBe(2)
  })

  test('test_buildLogicalGraph_circuitEnds_memberIdIsCid', () => {
    // Circuit endpoint member id is the cid
    const input: GraphInput = {
      devices: [dev('edge-router-1', 'site-a', 'core')],
      links: [],
      circuits: [{ id: 'CID-001', a: { deviceName: 'edge-router-1', name: 'et-0/0/0' }, b: null }],
      circuitSites: { 'CID-001': ['site-a', 'site-b'] },
      lldp: {},
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const edge = graph.edges.find(e => e.members.some(m => m.id === 'CID-001'))
    expect(edge).toBeDefined()
    expect(edge!.members[0]!.id).toBe('CID-001')
  })

  test('test_buildLogicalGraph_circuitPeerUnknown_siteNodeRemoteTier', () => {
    // Circuit far end unknown; creates site:<peer> node with tier remote
    const input: GraphInput = {
      devices: [dev('edge-router-1', 'site-a', 'core')],
      links: [],
      circuits: [{ id: 'CID-001', a: { deviceName: 'edge-router-1', name: 'et-0/0/0' }, b: null }],
      circuitSites: { 'CID-001': ['site-a', 'site-b'] },
      lldp: {},
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const siteNode = graph.nodes.find(n => n.id === 'site:site-b')
    expect(siteNode).toBeDefined()
    expect(siteNode!.tier).toBe('remote')
  })

  test('test_buildLogicalGraph_neighbourOtherSite_remoteTier', () => {
    // LLDP neighbour is a known device in another site; tier is remote
    const input: GraphInput = {
      devices: [
        dev('leaf-01', 'site-a', 'leaf'),
        dev('edge-router-2', 'site-b', 'core'),
      ],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/0': [{ hostname: 'edge-router-2', port: 'et-0/0/0' }] },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const remoteNode = graph.nodes.find(n => n.id === 'edge-router-2')
    expect(remoteNode).toBeDefined()
    expect(remoteNode!.tier).toBe('remote')
  })

  test('test_buildLogicalGraph_noSite_backboneOnly', () => {
    // site === null: only devices with inter-site edges survive
    const input: GraphInput = {
      devices: [
        dev('core-01', 'site-a', 'core'),
        dev('core-02', 'site-b', 'core'),
        dev('leaf-01', 'site-a', 'leaf'),
      ],
      links: [],
      circuits: [{ id: 'CID-001', a: { deviceName: 'core-01', name: 'et-0/0/0' }, b: { deviceName: 'core-02', name: 'et-0/0/0' } }],
      circuitSites: { 'CID-001': ['site-a', 'site-b'] },
      lldp: {},
    }
    const graph = buildLogicalGraph(input, null)
    // core-01 and core-02 have inter-site edge; leaf-01 does not
    expect(graph.nodes.find(n => n.id === 'core-01')).toBeDefined()
    expect(graph.nodes.find(n => n.id === 'core-02')).toBeDefined()
    expect(graph.nodes.find(n => n.id === 'leaf-01')).toBeUndefined()
  })

  test('test_buildLogicalGraph_withoutTopology_cablesAndLldpOnly', () => {
    // No topology input; builds graph from cables and LLDP only
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': { 'et-0/0/1': [{ hostname: 'server-01', port: 'eth0' }] },
      },
      // no topology field
    }
    const graph = buildLogicalGraph(input, 'site-a')
    expect(graph.edges.length).toBeGreaterThanOrEqual(2) // cable + LLDP
    expect(graph.nodes.find(n => n.id === 'leaf-01')).toBeDefined()
    expect(graph.nodes.find(n => n.id === 'spine-01')).toBeDefined()
  })

  test('test_buildLogicalGraph_sameInput_sameOutput', () => {
    // Determinism: same input produces byte-for-byte identical output
    const input: GraphInput = {
      devices: [
        dev('leaf-01', 'site-a', 'leaf'),
        dev('spine-01', 'site-a', 'spine'),
        dev('spine-02', 'site-a', 'spine'),
      ],
      links: [
        link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1'),
        link('c2', 'leaf-01', 'et-0/0/1', 'spine-02', 'Ethernet1/1'),
      ],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': {
          'et-0/0/0': [{ hostname: 'spine-01', port: 'Ethernet1/1' }],
          'et-0/0/1': [{ hostname: 'spine-02', port: 'Ethernet1/1' }],
        },
      },
      topology: {
        facts: [
          { layer: 'isis', device: 'leaf-01', iface: 'et-0/0/0', remote: 'spine-01', remoteIface: 'Ethernet1/1', up: true, label: 'L2 UP' },
          { layer: 'isis', device: 'leaf-01', iface: 'et-0/0/1', remote: 'spine-02', remoteIface: 'Ethernet1/1', up: true, label: 'L2 UP' },
        ],
        nodeSids: { 'spine-01': 200, 'spine-02': 201 },
        circuits: [],
      },
    }
    const graph1 = buildLogicalGraph(input, 'site-a')
    const graph2 = buildLogicalGraph(input, 'site-a')
    expect(JSON.stringify(graph1)).toBe(JSON.stringify(graph2))
  })

  // T3-F1: ext: node id uses full lowercased hostname, not short name
  test('test_buildLogicalGraph_extNodeId_fullLowercasedName', () => {
    // Two hosts with same short name but different FQDNs must produce distinct ext: nodes
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf')],
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {
        'leaf-01': {
          'et-0/0/0': [{ hostname: 'server-01.domain-a.example.net', port: 'eth0' }],
          'et-0/0/1': [{ hostname: 'server-01.domain-b.example.net', port: 'eth0' }],
        },
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const extNodes = graph.nodes.filter(n => n.id.startsWith('ext:'))
    // Should have two distinct ext: nodes with full lowercased names
    expect(extNodes).toHaveLength(2)
    expect(extNodes.find(n => n.id === 'ext:server-01.domain-a.example.net')).toBeDefined()
    expect(extNodes.find(n => n.id === 'ext:server-01.domain-b.example.net')).toBeDefined()
  })

  // T3-F4: IGP fact with remote=null uses port member's edge
  test('test_buildLogicalGraph_igpFactRemoteNull_usesPortMemberEdge', () => {
    const input: GraphInput = {
      devices: [dev('leaf-01', 'site-a', 'leaf'), dev('spine-01', 'site-a', 'spine')],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {},
      topology: {
        facts: [{
          layer: 'isis',
          device: 'leaf-01',
          iface: 'et-0/0/0',
          remote: null,
          remoteIface: null,
          up: true,
          label: 'L2 UP',
        }],
        nodeSids: {},
        circuits: [],
      },
    }
    const graph = buildLogicalGraph(input, 'site-a')
    const edge = graph.edges.find(e =>
      (e.a === 'leaf-01' && e.b === 'spine-01') ||
      (e.a === 'spine-01' && e.b === 'leaf-01')
    )
    expect(edge).toBeDefined()
    expect(edge!.layers.isis).toBeDefined()
  })

  // T3-F5: Backbone mode excludes devices with only intra-site edges
  test('test_buildLogicalGraph_backboneMode_intraSiteEdge_devicesExcluded', () => {
    const input: GraphInput = {
      devices: [
        dev('leaf-01', 'site-a', 'leaf'),
        dev('spine-01', 'site-a', 'spine'),
      ],
      links: [link('c1', 'leaf-01', 'et-0/0/0', 'spine-01', 'Ethernet1/1')],
      circuits: [],
      circuitSites: {},
      lldp: {},
    }
    const graph = buildLogicalGraph(input, null)
    // Neither should appear in backbone mode (same site, no inter-site edge)
    expect(graph.nodes.find(n => n.id === 'leaf-01')).toBeUndefined()
    expect(graph.nodes.find(n => n.id === 'spine-01')).toBeUndefined()
  })

  // T3-F6: Circuit peer site uses device's actual site, not filter site
  test('test_buildLogicalGraph_backboneMode_circuitToUnknownFarEnd_peerSiteCorrect', () => {
    const input: GraphInput = {
      devices: [dev('core-01', 'site-a', 'core')],
      links: [],
      circuits: [{ id: 'CID-001', a: { deviceName: 'core-01', name: 'et-0/0/0' }, b: null }],
      circuitSites: { 'CID-001': ['site-a', 'site-b'] },
      lldp: {},
    }
    const graph = buildLogicalGraph(input, null)
    expect(graph.nodes.find(n => n.id === 'core-01')).toBeDefined()
    // Should create site:site-b (the peer), not site:site-a (device's own site)
    expect(graph.nodes.find(n => n.id === 'site:site-b')).toBeDefined()
    expect(graph.nodes.find(n => n.id === 'site:site-a')).toBeUndefined()
  })
})
