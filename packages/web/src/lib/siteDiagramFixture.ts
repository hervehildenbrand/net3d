/**
 * Real-shape fixtures for site diagram layout testing.
 * Uses buildLogicalGraph with realistic AMS1 and PoP structures.
 */
import {
  buildLogicalGraph,
  type GraphDevice,
  type GraphInput,
  type LogicalGraph,
  type TopologyCable,
  type TopologyFact,
  type CollectorTopology,
} from '@net3d/shared'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RackInput {
  name: string
  location: string | null
  devices: { id: string; roleName: string }[]
}

export interface SiteFixture {
  graph: LogicalGraph
  racks: RackInput[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Device and link builders
// ─────────────────────────────────────────────────────────────────────────────

function device(name: string, roleName: string, site: string): GraphDevice {
  return {
    id: `${site.toLowerCase()}-${name.toLowerCase()}-id`,
    name: `${site}-${name}`,
    siteName: site,
    roleName,
    roleColor: roleColorFor(roleName),
  }
}

function roleColorFor(roleName: string): string {
  if (/core|router/i.test(roleName)) return '#dc2626'
  if (/spine/i.test(roleName)) return '#f97316'
  if (/leaf|access|tor/i.test(roleName)) return '#22c55e'
  if (/oob/i.test(roleName)) return '#16a34a'
  return '#64748b'
}

function link(
  aDevice: string,
  aIface: string,
  bDevice: string,
  bIface: string,
): TopologyCable {
  return {
    id: `${aDevice}:${aIface}~${bDevice}:${bIface}`,
    a: { deviceName: aDevice, name: aIface },
    b: { deviceName: bDevice, name: bIface },
  }
}

function physicalFact(device: string, iface: string, remote: string, remoteIface: string): TopologyFact {
  return { layer: 'physical', device, iface, remote, remoteIface, up: true, label: '' }
}

function isisFact(device: string, remote: string, label = 'L2 UP'): TopologyFact {
  return { layer: 'isis', device, iface: null, remote, remoteIface: null, up: true, label }
}

function ospfFact(device: string, iface: string, remote: string, remoteIface: string, label = 'area 0 FULL'): TopologyFact {
  return { layer: 'ospf', device, iface, remote, remoteIface, up: true, label }
}

function srFact(device: string, remote: string, label: string): TopologyFact {
  return { layer: 'sr', device, iface: null, remote, remoteIface: null, up: true, label }
}

// ─────────────────────────────────────────────────────────────────────────────
// AMS1 Fixture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the AMS1 real-shape fixture.
 * Network: 2 cores, 8 spines, 2 oob-aggs in NET-01..04.
 * Server: 46 racks (SRV-01..46), each with leaf-1, leaf-2, oob, pdu-A/B, pp-1, srv-01..18.
 * Peers: 6 remote sites with IS-IS and SR adjacencies.
 */
export function ams1Fixture(): SiteFixture {
  const site = 'AMS1'
  const devices: GraphDevice[] = []
  const links: TopologyCable[] = []
  const facts: TopologyFact[] = []
  const nodeSids: Record<string, number> = {}
  const racks: RackInput[] = []

  // ─────────────────────────────────────────────────────────────────────────
  // Network racks (NET-01..04)
  // ─────────────────────────────────────────────────────────────────────────
  const netRackDevices: { name: string; roleName: string }[][] = [
    // NET-01: core-01, core-02, spine-01, spine-02, oob-agg-1, pdu-A, pdu-B, xc-1..4
    [
      { name: 'core-01', roleName: 'Core Router' },
      { name: 'core-02', roleName: 'Core Router' },
      { name: 'spine-01', roleName: 'Spine' },
      { name: 'spine-02', roleName: 'Spine' },
      { name: 'oob-agg-1', roleName: 'OOB' },
      { name: 'pdu-A', roleName: 'PDU' },
      { name: 'pdu-B', roleName: 'PDU' },
      { name: 'xc-1', roleName: 'Patch-panel' },
      { name: 'xc-2', roleName: 'Patch-panel' },
      { name: 'xc-3', roleName: 'Patch-panel' },
      { name: 'xc-4', roleName: 'Patch-panel' },
    ],
    // NET-02: spine-03, spine-04, oob-agg-2
    [
      { name: 'spine-03', roleName: 'Spine' },
      { name: 'spine-04', roleName: 'Spine' },
      { name: 'oob-agg-2', roleName: 'OOB' },
    ],
    // NET-03: spine-05, spine-06
    [
      { name: 'spine-05', roleName: 'Spine' },
      { name: 'spine-06', roleName: 'Spine' },
    ],
    // NET-04: spine-07, spine-08
    [
      { name: 'spine-07', roleName: 'Spine' },
      { name: 'spine-08', roleName: 'Spine' },
    ],
  ]

  for (let i = 0; i < 4; i++) {
    const rackName = `NET-0${i + 1}`
    const rackDevs = netRackDevices[i]!
    const rackInputDevices: { id: string; roleName: string }[] = []

    for (const rd of rackDevs) {
      const d = device(rd.name, rd.roleName, site)
      devices.push(d)
      rackInputDevices.push({ id: d.id, roleName: rd.roleName })
    }

    racks.push({ name: rackName, location: 'network-core', devices: rackInputDevices })
  }

  // Core SIDs
  nodeSids[`${site}-core-01`] = 16395
  nodeSids[`${site}-core-02`] = 16014

  // ─────────────────────────────────────────────────────────────────────────
  // Core to spine links (16 total) with physical facts
  // ─────────────────────────────────────────────────────────────────────────
  for (const coreIdx of [1, 2]) {
    const coreName = `${site}-core-0${coreIdx}`
    for (let spineIdx = 1; spineIdx <= 8; spineIdx++) {
      const spineName = `${site}-spine-0${spineIdx}`
      const coreIface = `et-0/0/${spineIdx - 1}`
      const spineIface = `et-0/0/${coreIdx - 1}`
      links.push(link(coreName, coreIface, spineName, spineIface))
      facts.push(physicalFact(coreName, coreIface, spineName, spineIface))
      facts.push(physicalFact(spineName, spineIface, coreName, coreIface))
      facts.push(ospfFact(coreName, coreIface, spineName, spineIface))
      facts.push(ospfFact(spineName, spineIface, coreName, coreIface))
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core to oob-agg links (2 total) with physical facts
  // ─────────────────────────────────────────────────────────────────────────
  for (const coreIdx of [1, 2]) {
    const coreName = `${site}-core-0${coreIdx}`
    const aggName = `${site}-oob-agg-${coreIdx}`
    const coreIface = `et-0/1/0`
    const aggIface = `et-0/0/0`
    links.push(link(coreName, coreIface, aggName, aggIface))
    facts.push(physicalFact(coreName, coreIface, aggName, aggIface))
    facts.push(physicalFact(aggName, aggIface, coreName, coreIface))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // oob-agg to spines (8 total: oob-agg-1 -> odd spines, oob-agg-2 -> even)
  // ─────────────────────────────────────────────────────────────────────────
  for (let spineIdx = 1; spineIdx <= 8; spineIdx++) {
    const aggIdx = spineIdx % 2 === 1 ? 1 : 2
    const aggName = `${site}-oob-agg-${aggIdx}`
    const spineName = `${site}-spine-0${spineIdx}`
    const aggIface = `et-0/0/${Math.ceil(spineIdx / 2)}`
    const spineIface = `et-0/1/${aggIdx - 1}`
    links.push(link(aggName, aggIface, spineName, spineIface))
    facts.push(physicalFact(aggName, aggIface, spineName, spineIface))
    facts.push(physicalFact(spineName, spineIface, aggName, aggIface))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Peer links (6 peers) with IS-IS and SR facts
  // ─────────────────────────────────────────────────────────────────────────
  const peers = [
    { site: 'FRA1', core: 1 },
    { site: 'HKG1', core: 1 },
    { site: 'LHR1', core: 2 },
    { site: 'DFW1', core: 2 },
    { site: 'GRU1', core: 2 },
    { site: 'MIA1', core: 1 },
  ]

  for (const peer of peers) {
    const localCore = `${site}-core-0${peer.core}`
    const remoteCore = `${peer.site}-core-0${peer.core}`
    const peerDevice = device(`core-0${peer.core}`, 'Core Router', peer.site)
    devices.push(peerDevice)

    // Circuit link (handled by circuitSites)
    // ISIS and SR facts
    facts.push(isisFact(localCore, remoteCore))
    facts.push(isisFact(remoteCore, localCore))
    facts.push(srFact(localCore, remoteCore, `adj-SID ${16000 + peers.indexOf(peers.find(p => p.site === peer.site)!)}`))
    facts.push(srFact(remoteCore, localCore, `adj-SID ${16100 + peers.indexOf(peers.find(p => p.site === peer.site)!)}`))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Server racks (SRV-01..46)
  // ─────────────────────────────────────────────────────────────────────────
  for (let srvIdx = 1; srvIdx <= 46; srvIdx++) {
    const rackName = `SRV-${String(srvIdx).padStart(2, '0')}`
    const location = srvIdx <= 23 ? 'server-hall-1' : 'server-hall-2'
    const rackInputDevices: { id: string; roleName: string }[] = []

    // Leaf switches
    const leaf1 = device(`${rackName}-leaf-1`, 'Leaf', site)
    const leaf2 = device(`${rackName}-leaf-2`, 'Leaf', site)
    const oob = device(`${rackName}-oob`, 'OOB', site)
    devices.push(leaf1, leaf2, oob)
    rackInputDevices.push(
      { id: leaf1.id, roleName: 'Leaf' },
      { id: leaf2.id, roleName: 'Leaf' },
      { id: oob.id, roleName: 'OOB' },
    )

    // PDUs and patch panel
    const pduA = device(`${rackName}-pdu-A`, 'PDU', site)
    const pduB = device(`${rackName}-pdu-B`, 'PDU', site)
    const pp = device(`${rackName}-pp-1`, 'Patch-panel', site)
    devices.push(pduA, pduB, pp)
    rackInputDevices.push(
      { id: pduA.id, roleName: 'PDU' },
      { id: pduB.id, roleName: 'PDU' },
      { id: pp.id, roleName: 'Patch-panel' },
    )

    // Servers
    for (let sIdx = 1; sIdx <= 18; sIdx++) {
      const serverName = `${rackName}-srv-${String(sIdx).padStart(2, '0')}`
      const serverRoles = ['Bare-metal', 'K8s Worker', 'ESX Host']
      const srv = device(serverName.replace(`${site}-`, ''), serverRoles[sIdx % 3]!, site)
      devices.push(srv)
      rackInputDevices.push({ id: srv.id, roleName: serverRoles[sIdx % 3]! })

      // Server links to leaf-1, leaf-2, oob (3 links per server)
      const srvName = `${site}-${serverName.replace(`${site}-`, '')}`
      links.push(link(srvName, 'eth0', leaf1.name, `et-0/0/${sIdx - 1}`))
      links.push(link(srvName, 'eth1', leaf2.name, `et-0/0/${sIdx - 1}`))
      links.push(link(srvName, 'mgmt0', oob.name, `ge-0/0/${sIdx - 1}`))
      // Physical facts
      facts.push(physicalFact(srvName, 'eth0', leaf1.name, `et-0/0/${sIdx - 1}`))
      facts.push(physicalFact(srvName, 'eth1', leaf2.name, `et-0/0/${sIdx - 1}`))
      facts.push(physicalFact(srvName, 'mgmt0', oob.name, `ge-0/0/${sIdx - 1}`))
    }

    // leaf-1 to spine-01..04 (4 uplinks)
    for (let spineIdx = 1; spineIdx <= 4; spineIdx++) {
      const spineName = `${site}-spine-0${spineIdx}`
      const leafIface = `et-0/1/${spineIdx - 1}`
      const spineIface = `et-0/0/${16 + srvIdx}`
      links.push(link(leaf1.name, leafIface, spineName, spineIface))
      // NO physical fact for spine-ToR (intentionally layerless)
    }

    // leaf-2 to spine-05..08 (4 uplinks)
    for (let spineIdx = 5; spineIdx <= 8; spineIdx++) {
      const spineName = `${site}-spine-0${spineIdx}`
      const leafIface = `et-0/1/${spineIdx - 5}`
      const spineIface = `et-0/0/${16 + srvIdx}`
      links.push(link(leaf2.name, leafIface, spineName, spineIface))
      // NO physical fact for spine-ToR (intentionally layerless)
    }

    // oob to oob-agg-1/2
    links.push(link(oob.name, 'ge-0/1/0', `${site}-oob-agg-1`, `ge-0/0/${srvIdx}`))
    links.push(link(oob.name, 'ge-0/1/1', `${site}-oob-agg-2`, `ge-0/0/${srvIdx}`))
    facts.push(physicalFact(oob.name, 'ge-0/1/0', `${site}-oob-agg-1`, `ge-0/0/${srvIdx}`))
    facts.push(physicalFact(oob.name, 'ge-0/1/1', `${site}-oob-agg-2`, `ge-0/0/${srvIdx}`))

    // leaf-1 to leaf-2 (local)
    links.push(link(leaf1.name, 'et-0/2/0', leaf2.name, 'et-0/2/0'))
    facts.push(physicalFact(leaf1.name, 'et-0/2/0', leaf2.name, 'et-0/2/0'))
    facts.push(physicalFact(leaf2.name, 'et-0/2/0', leaf1.name, 'et-0/2/0'))

    // oob to leaf-1 (mgmt) - only one leaf for management
    links.push(link(oob.name, 'ge-0/2/0', leaf1.name, 'mgmt0'))
    facts.push(physicalFact(oob.name, 'ge-0/2/0', leaf1.name, 'mgmt0'))

    racks.push({ name: rackName, location, devices: rackInputDevices })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Build circuit sites for peers
  // ─────────────────────────────────────────────────────────────────────────
  const circuitSites: Record<string, [string, string]> = {}
  const circuits: TopologyCable[] = []
  for (const peer of peers) {
    const cid = `${site}-${peer.site}-001`
    circuitSites[cid] = [site, peer.site]
    circuits.push({
      id: cid,
      a: { deviceName: `${site}-core-0${peer.core}`, name: 'et-1/0/0' },
      b: { deviceName: `${peer.site}-core-0${peer.core}`, name: 'et-1/0/0' },
    })
    // Physical fact for circuit
    facts.push(physicalFact(`${site}-core-0${peer.core}`, 'et-1/0/0', `${peer.site}-core-0${peer.core}`, 'et-1/0/0'))
  }

  const topology: CollectorTopology = { facts, nodeSids, circuits }
  const input: GraphInput = {
    devices,
    links,
    circuits,
    circuitSites,
    lldp: {},
    topology,
  }

  const graph = buildLogicalGraph(input, site)
  return { graph, racks }
}

// ─────────────────────────────────────────────────────────────────────────────
// PoP Fixture (smaller site)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a PoP fixture with 6 server racks (3+3 in two locations).
 */
export function popFixture(): SiteFixture {
  const site = 'DXB1'
  const devices: GraphDevice[] = []
  const links: TopologyCable[] = []
  const facts: TopologyFact[] = []
  const nodeSids: Record<string, number> = {}
  const racks: RackInput[] = []

  // Network rack
  const netDevices = [
    { name: 'core-01', roleName: 'Core Router' },
    { name: 'core-02', roleName: 'Core Router' },
    { name: 'spine-01', roleName: 'Spine' },
    { name: 'spine-02', roleName: 'Spine' },
  ]

  const netRackInputDevices: { id: string; roleName: string }[] = []
  for (const nd of netDevices) {
    const d = device(nd.name, nd.roleName, site)
    devices.push(d)
    netRackInputDevices.push({ id: d.id, roleName: nd.roleName })
  }
  racks.push({ name: 'NET-01', location: 'network-core', devices: netRackInputDevices })

  nodeSids[`${site}-core-01`] = 16500
  nodeSids[`${site}-core-02`] = 16501

  // Core to spine links
  for (const coreIdx of [1, 2]) {
    const coreName = `${site}-core-0${coreIdx}`
    for (let spineIdx = 1; spineIdx <= 2; spineIdx++) {
      const spineName = `${site}-spine-0${spineIdx}`
      links.push(link(coreName, `et-0/0/${spineIdx - 1}`, spineName, `et-0/0/${coreIdx - 1}`))
      facts.push(physicalFact(coreName, `et-0/0/${spineIdx - 1}`, spineName, `et-0/0/${coreIdx - 1}`))
      facts.push(ospfFact(coreName, `et-0/0/${spineIdx - 1}`, spineName, `et-0/0/${coreIdx - 1}`))
    }
  }

  // 6 Server racks (SRV-01..06)
  for (let srvIdx = 1; srvIdx <= 6; srvIdx++) {
    const rackName = `SRV-${String(srvIdx).padStart(2, '0')}`
    const location = srvIdx <= 3 ? 'server-hall-1' : 'server-hall-2'
    const rackInputDevices: { id: string; roleName: string }[] = []

    const leaf1 = device(`${rackName}-leaf-1`, 'Leaf', site)
    const leaf2 = device(`${rackName}-leaf-2`, 'Leaf', site)
    const oob = device(`${rackName}-oob`, 'OOB', site)
    devices.push(leaf1, leaf2, oob)
    rackInputDevices.push(
      { id: leaf1.id, roleName: 'Leaf' },
      { id: leaf2.id, roleName: 'Leaf' },
      { id: oob.id, roleName: 'OOB' },
    )

    // Servers
    for (let sIdx = 1; sIdx <= 18; sIdx++) {
      const serverName = `${rackName}-srv-${String(sIdx).padStart(2, '0')}`
      const srv = device(serverName.replace(`${site}-`, ''), 'Bare-metal', site)
      devices.push(srv)
      rackInputDevices.push({ id: srv.id, roleName: 'Bare-metal' })

      const srvName = `${site}-${serverName.replace(`${site}-`, '')}`
      links.push(link(srvName, 'eth0', leaf1.name, `et-0/0/${sIdx - 1}`))
      links.push(link(srvName, 'eth1', leaf2.name, `et-0/0/${sIdx - 1}`))
      links.push(link(srvName, 'mgmt0', oob.name, `ge-0/0/${sIdx - 1}`))
      facts.push(physicalFact(srvName, 'eth0', leaf1.name, `et-0/0/${sIdx - 1}`))
      facts.push(physicalFact(srvName, 'eth1', leaf2.name, `et-0/0/${sIdx - 1}`))
      facts.push(physicalFact(srvName, 'mgmt0', oob.name, `ge-0/0/${sIdx - 1}`))
    }

    // leaf uplinks to spines
    links.push(link(leaf1.name, 'et-0/1/0', `${site}-spine-01`, `et-0/0/${10 + srvIdx}`))
    links.push(link(leaf2.name, 'et-0/1/0', `${site}-spine-02`, `et-0/0/${10 + srvIdx}`))

    // leaf-1 to leaf-2 local link
    links.push(link(leaf1.name, 'et-0/2/0', leaf2.name, 'et-0/2/0'))
    facts.push(physicalFact(leaf1.name, 'et-0/2/0', leaf2.name, 'et-0/2/0'))

    racks.push({ name: rackName, location, devices: rackInputDevices })
  }

  // Peers
  const peers = [
    { site: 'FRA1', core: 1 },
    { site: 'HKG1', core: 1 },
    { site: 'LHR1', core: 2 },
    { site: 'DFW1', core: 2 },
    { site: 'GRU1', core: 2 },
    { site: 'MIA1', core: 1 },
  ]

  const circuitSites: Record<string, [string, string]> = {}
  const circuits: TopologyCable[] = []
  for (const peer of peers) {
    const peerDevice = device(`core-0${peer.core}`, 'Core Router', peer.site)
    devices.push(peerDevice)
    const cid = `${site}-${peer.site}-001`
    circuitSites[cid] = [site, peer.site]
    circuits.push({
      id: cid,
      a: { deviceName: `${site}-core-0${peer.core}`, name: 'et-1/0/0' },
      b: { deviceName: `${peer.site}-core-0${peer.core}`, name: 'et-1/0/0' },
    })
    facts.push(physicalFact(`${site}-core-0${peer.core}`, 'et-1/0/0', `${peer.site}-core-0${peer.core}`, 'et-1/0/0'))
    facts.push(isisFact(`${site}-core-0${peer.core}`, `${peer.site}-core-0${peer.core}`))
    facts.push(srFact(`${site}-core-0${peer.core}`, `${peer.site}-core-0${peer.core}`, `adj-SID 16200`))
  }

  const topology: CollectorTopology = { facts, nodeSids, circuits }
  const input: GraphInput = {
    devices,
    links,
    circuits,
    circuitSites,
    lldp: {},
    topology,
  }

  const graph = buildLogicalGraph(input, site)
  return { graph, racks }
}
