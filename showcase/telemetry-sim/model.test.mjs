import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInventory, capacityFromIfaceType, hash, interfacesAt, isStale, protocolsFor, rateBps } from './model.mjs'

const T = Date.UTC(2026, 0, 1, 12) // fixed clock, aligned to the 10 min stale cycle
const port = (deviceName, name, ifaceType = '100gbase-x-qsfp28', termType = 'interface') => ({
  kind: 'device', name, deviceName, rackName: 'R1', ifaceType, termType, pairedPort: null,
})
const circuit = (cid) => ({
  kind: 'circuit', name: cid, deviceName: null, rackName: null, ifaceType: null, termType: 'other', pairedPort: null,
})
const site = (lon, devices, cables) => ({
  lon,
  detail: {
    racks: [{ id: 'r1', name: 'R1', uHeight: 42, location: null, devices: devices.map(([name, roleName]) => ({ name, roleName })) }],
    cables,
    power: { panels: [], feeds: [] },
  },
})
const row = (inv, device, iface, t = T) => interfacesAt(inv, device, t).find((r) => r.interface === iface)

test('test_hash_knownVectors_matchesFnv1a32', () => {
  assert.equal(hash(''), 0x811c9dc5)
  assert.equal(hash('a'), 0xe40c292c)
  assert.equal(hash('foobar'), 0xbf9cf968)
})

test('test_capacityFromIfaceType_slugTable_parsesLineRate', () => {
  const table = {
    '400gbase-x-qsfpdd': 4e11,
    '100gbase-x-qsfp28': 1e11,
    '25gbase-x-sfp28': 2.5e10,
    '10gbase-x-sfpp': 1e10,
    '1000base-t': 1e9,
    '100base-tx': null,
    virtual: null,
    lag: null,
  }
  for (const [type, bps] of Object.entries(table)) assert.equal(capacityFromIfaceType(type), bps, type)
  assert.equal(capacityFromIfaceType(null), null)
})

test('test_rateBps_manyLinksAllDay_deterministicPositiveWithinCapacity', () => {
  const cap = 1e11
  const pcts = []
  for (let k = 0; k < 300; k++) {
    for (let h = 0; h < 24; h++) {
      const t = T + h * 3.6e6
      const r = rateBps(`link${k}`, t, 0, cap)
      assert.equal(r, rateBps(`link${k}`, t, 0, cap))
      assert.ok(Number.isInteger(r) && r > 0 && r <= cap, `${k}@${h}h: ${r}`)
      pcts.push((r * 100) / cap)
    }
  }
  assert.ok(Math.min(...pcts) < 0.05 && Math.max(...pcts) > 30) // spans the 0.01–100 % colour scale
  assert.ok(rateBps('link0', T, 0, null) <= 1e9) // unknown capacity rates as 1G
})

test('test_rateBps_localAfternoonVsNight_busierInAfternoon', () => {
  const at = (utcHour, lon) => rateBps('link', Date.UTC(2026, 0, 1, utcHour), lon, 1e11)
  assert.ok(at(15, 0) > at(3, 0)) // 15:00 vs 03:00 local at Greenwich
  assert.ok(at(3, 180) > at(3, 0)) // same instant, half a world apart
})

test('test_rateBps_tenSecondsLater_moves', () => {
  assert.notEqual(rateBps('link', T, 0, 1e11), rateBps('link', T + 10_000, 0, 1e11))
})

test('test_isStale_2000Devices_fewStaleFor60sPer10min', () => {
  const staleSamples = (n) => Array.from({ length: 60 }, (_, k) => isStale(n, T + k * 10_000)).filter(Boolean).length
  const flaky = Array.from({ length: 2000 }, (_, i) => `dev${i}`).filter((n) => staleSamples(n) > 0)
  assert.ok(flaky.length >= 10 && flaky.length <= 60, `${flaky.length} of 2000`) // 0.5–3 %
  for (const n of flaky) assert.equal(staleSamples(n), 6, n) // 60 s of each 600 s cycle
})

test('test_buildInventory_directCable_endsMirror', () => {
  const inv = buildInventory([
    site(2, [['X-spine-01', 'Spine'], ['X-core-01', 'Core']], [
      { id: '7', a: port('X-spine-01', 'Core1'), b: port('X-core-01', 'spine1-1') },
    ]),
  ])
  for (const t of [T, T + 7_000, T + 3.6e6]) {
    const a = row(inv, 'X-spine-01', 'Core1', t)
    const b = row(inv, 'X-core-01', 'spine1-1', t)
    assert.equal(a.tx_bps, b.rx_bps)
    assert.equal(a.rx_bps, b.tx_bps)
    assert.notEqual(a.tx_bps, a.rx_bps) // the two directions are independent flows
  }
})

test('test_buildInventory_circuitSeenFromBothSites_endsMirrorInEitherOrder', () => {
  const cid = 'ACME-AAA1-BBB1-001'
  const aaa = site(2, [['AAA1-core-01', 'Core']], [{ id: '1', a: port('AAA1-core-01', 'et-0/0/0'), b: circuit(cid) }])
  const bbb = site(-74, [['BBB1-core-02', 'Core']], [{ id: '2', a: circuit(cid), b: port('BBB1-core-02', 'et-0/0/3') }])
  const ends = (inv) => [row(inv, 'AAA1-core-01', 'et-0/0/0'), row(inv, 'BBB1-core-02', 'et-0/0/3')]
  const [a, b] = ends(buildInventory([aaa, bbb]))
  assert.equal(a.telemetry_state, 'LIVE')
  assert.equal(a.tx_bps, b.rx_bps)
  assert.equal(a.rx_bps, b.tx_bps)
  assert.deepEqual(ends(buildInventory([bbb, aaa])), [a, b])
})

test('test_buildInventory_mixedRoles_onlySwitchAndRouterInterfaces', () => {
  const inv = buildInventory([
    site(0, [['L-leaf-1', 'Leaf'], ['L-oob', 'OOB'], ['L-pp-1', 'Patch-panel'], ['L-srv-01', 'Database'], ['L-pdu-a', 'PDU']], [
      { id: '1', a: port('L-leaf-1', 'Ethernet1'), b: port('L-pp-1', 'Front1', null, 'front-port') }, // panel-routed uplink
      { id: '2', a: port('L-srv-01', 'mgmt0', '1000base-t'), b: port('L-oob', 'Server-01', '1000base-t') },
      { id: '3', a: port('L-pdu-a', 'Outlet1', null, 'other'), b: port('L-leaf-1', 'PSU1', null, 'other') }, // power cord
    ]),
  ])
  assert.deepEqual([...inv.keys()].sort(), ['L-leaf-1', 'L-oob'])
  assert.deepEqual([...inv.get('L-leaf-1').keys()], ['Ethernet1'])
  const uplink = row(inv, 'L-leaf-1', 'Ethernet1')
  assert.equal(uplink.capacity_bps, 1e11)
  assert.notEqual(uplink.tx_bps, uplink.rx_bps)
  assert.equal(row(inv, 'L-oob', 'Server-01').capacity_bps, 1e9)
})

test('test_interfacesAt_staleOrUnknownDevice_nullRatesOrNull', () => {
  const name = Array.from({ length: 5000 }, (_, i) => `dev${i}`).find((n) => isStale(n, T))
  const inv = buildInventory([site(0, [[name, 'Core']], [{ id: '9', a: port(name, 'et-0/0/0'), b: circuit('C-1') }])])
  assert.deepEqual(interfacesAt(inv, name, T), [
    { interface: 'et-0/0/0', telemetry_state: 'STALE', capacity_bps: 1e11, rx_bps: null, tx_bps: null },
  ])
  assert.equal(interfacesAt(inv, 'nope', T), null)
})

// ─────────────────────────────────────────────────────────────────────────────
// protocolsFor tests (Task 12)
// ─────────────────────────────────────────────────────────────────────────────

const rack = (name, devices) => ({
  id: `r${name}`, name, uHeight: 42, location: null, devices: devices.map(([n, roleName]) => ({ name: n, roleName })),
})
const siteWithRacks = (lon, racks, cables) => ({
  lon,
  detail: { racks, cables, power: { panels: [], feeds: [] } },
})

test('test_protocolsFor_confirmedPair_emittedOnceFromLowerEnd', () => {
  // Two monitored devices cabled together: link emitted once from alphabetically-first device
  const sites = [siteWithRacks(0, [rack('R1', [['AAA-core-01', 'Core'], ['ZZZ-core-02', 'Core']])], [
    { id: '1', a: port('AAA-core-01', 'et-0/0/0'), b: port('ZZZ-core-02', 'et-0/0/1') },
  ])]
  const { links } = protocolsFor(sites, { lsdb: true, ospf: true })
  const pair = links.filter((l) =>
    (l.a.device === 'AAA-core-01' && l.b.device === 'ZZZ-core-02') ||
    (l.a.device === 'ZZZ-core-02' && l.b.device === 'AAA-core-01')
  )
  assert.equal(pair.length, 1, 'confirmed pair should appear exactly once')
  assert.equal(pair[0].a.device, 'AAA-core-01', 'a side should be the alphabetically-first device')
  assert.equal(pair[0].b.device, 'ZZZ-core-02')
  assert.equal(pair[0].confirmed, true)
})

test('test_protocolsFor_panelRoutedUplink_lldpLinkPresent', () => {
  // Cable from leaf interface through a front-port (panel-routed): still generates an LLDP link
  const sites = [siteWithRacks(0, [
    rack('R1', [['site-a-leaf-01', 'Leaf'], ['site-a-pp-01', 'Patch-panel'], ['site-a-spine-01', 'Spine']]),
  ], [
    // leaf -> panel front-port
    { id: '1', a: port('site-a-leaf-01', 'Ethernet49', '100gbase-x-qsfp28', 'interface'),
              b: { kind: 'device', name: 'Front1', deviceName: 'site-a-pp-01', rackName: 'R1', ifaceType: null, termType: 'front-port', pairedPort: 'Rear1' } },
    // panel rear-port -> spine
    { id: '2', a: { kind: 'device', name: 'Rear1', deviceName: 'site-a-pp-01', rackName: 'R1', ifaceType: null, termType: 'rear-port', pairedPort: 'Front1' },
              b: port('site-a-spine-01', 'Core1', '100gbase-x-qsfp28') },
  ])]
  const { links } = protocolsFor(sites, { lsdb: true, ospf: true })
  // The leaf should see spine as LLDP neighbour (panel-routed uplink)
  const leafLink = links.find((l) => l.a.device === 'site-a-leaf-01' || l.b.device === 'site-a-leaf-01')
  assert.ok(leafLink, 'leaf should have an LLDP link')
  assert.equal(leafLink.state, 'PRESENT')
})

test('test_protocolsFor_serverCable_farEndUnmonitored', () => {
  // Cable from leaf to a server (Database role): server side is unmonitored (b.device = null)
  const sites = [siteWithRacks(0, [rack('R1', [['site-a-leaf-01', 'Leaf'], ['site-a-srv-01', 'Database']])], [
    { id: '1', a: port('site-a-leaf-01', 'Ethernet1'), b: port('site-a-srv-01', 'eth0', '25gbase-x-sfp28') },
  ])]
  const { links } = protocolsFor(sites, { lsdb: true, ospf: true })
  const leafLink = links.find((l) => l.a.device === 'site-a-leaf-01' && l.a.interface === 'Ethernet1')
  assert.ok(leafLink, 'leaf should emit link to server')
  assert.equal(leafLink.b.device, null, 'server is unmonitored: b.device should be null')
  assert.ok(leafLink.b.system_name, 'should have system_name for far end')
  assert.ok(leafLink.b.chassis_id, 'should have chassis_id for far end')
  assert.equal(leafLink.state, 'PRESENT')
  assert.equal(leafLink.confirmed, false, 'unconfirmed because far end is not monitored')
})

test('test_protocolsFor_bmc_lldpOnlyNeighbour', () => {
  // One BMC per server rack: appears on an uncabled leaf port with a hashed name
  const sites = [siteWithRacks(0, [
    rack('R1', [['site-a-leaf-01', 'Leaf']]),
    rack('Srv-Rack-A', [['site-a-srv-01', 'Database'], ['site-a-srv-02', 'Database']]), // server rack
  ], [])] // no cables, so leaf ports are uncabled
  const { links } = protocolsFor(sites, { lsdb: true, ospf: true })
  const bmcLinks = links.filter((l) => l.b.system_name?.includes('-bmc'))
  assert.equal(bmcLinks.length, 1, 'one BMC link per server rack')
  assert.ok(bmcLinks[0].b.system_name.endsWith('.example.net'), 'BMC name uses .example.net')
  assert.equal(bmcLinks[0].b.device, null, 'BMC is unmonitored')
})

test('test_protocolsFor_circuit_isisInterfaceCarriesUnit', () => {
  // IS-IS adjacency on a circuit: interface has .0 unit suffix (requires both circuit ends to be Core)
  const cid = 'ACME-SITE-A-SITE-B-001'
  const siteA = siteWithRacks(0, [rack('R1', [['site-a-core-01', 'Core']])], [
    { id: '1', a: port('site-a-core-01', 'et-0/0/0'), b: circuit(cid) },
  ])
  const siteB = siteWithRacks(-74, [rack('R1', [['site-b-core-01', 'Core']])], [
    { id: '2', a: circuit(cid), b: port('site-b-core-01', 'et-0/0/1') },
  ])
  const { isisAdjacencies } = protocolsFor([siteA, siteB], { lsdb: true, ospf: true })
  const adj = isisAdjacencies.find((a) => a.device === 'site-a-core-01')
  assert.ok(adj, 'core should have IS-IS adjacency on circuit')
  assert.equal(adj.interface, 'et-0/0/0.0', 'interface should carry .0 unit suffix')
  assert.equal(adj.state, 'UP')
})

test('test_protocolsFor_lsdbOff_emptyTopologyAndNullHostnames', () => {
  // lsdb: false -> topology body is empty, adjacencies have null hostnames
  const sites = [siteWithRacks(0, [rack('R1', [['site-a-core-01', 'Core'], ['site-a-core-02', 'Core']])], [
    { id: '1', a: port('site-a-core-01', 'et-0/0/0'), b: port('site-a-core-02', 'et-0/0/1') },
  ])]
  const { isisAdjacencies, isisTopology } = protocolsFor(sites, { lsdb: false, ospf: true })
  assert.deepEqual(isisTopology, { sources: [], nodes: [], links: [] }, 'topology should be empty when lsdb=false')
  for (const adj of isisAdjacencies) {
    assert.equal(adj.neighbor_hostname, null, 'neighbor_hostname should be null when lsdb=false')
  }
})

test('test_protocolsFor_coreSpine_ospfFull', () => {
  // OSPF FULL adjacency on Core-to-Spine cables, area 0.0.0.0
  const sites = [siteWithRacks(0, [rack('R1', [['site-a-core-01', 'Core'], ['site-a-spine-01', 'Spine']])], [
    { id: '1', a: port('site-a-core-01', 'et-0/0/5'), b: port('site-a-spine-01', 'Ethernet1') },
  ])]
  const { ospfAdjacencies } = protocolsFor(sites, { lsdb: true, ospf: true })
  const adj = ospfAdjacencies.find((a) => a.device === 'site-a-core-01')
  assert.ok(adj, 'core should have OSPF adjacency to spine')
  assert.equal(adj.state, 'FULL')
  assert.equal(adj.area, '0.0.0.0')
})

test('test_protocolsFor_monitoredCoreOnly_leafEndsUnmonitored', () => {
  // SIM_MONITORED=Core: only Core role is monitored, leaf ends are unmonitored
  const sites = [siteWithRacks(0, [rack('R1', [['site-a-core-01', 'Core'], ['site-a-leaf-01', 'Leaf']])], [
    { id: '1', a: port('site-a-core-01', 'et-0/0/0'), b: port('site-a-leaf-01', 'Ethernet49') },
  ])]
  const { links } = protocolsFor(sites, { lsdb: true, ospf: true }, new Set(['Core']))
  const coreLink = links.find((l) => l.a.device === 'site-a-core-01')
  assert.ok(coreLink, 'core should emit link')
  assert.equal(coreLink.b.device, null, 'leaf is unmonitored when SIM_MONITORED=Core')
})

// ─────────────────────────────────────────────────────────────────────────────
// Fix round 1 regression tests
// ─────────────────────────────────────────────────────────────────────────────

const isMacLike = (s) => /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(s)

test('test_protocolsFor_determinism_sameInputSameOutput', () => {
  // T12-F2: protocolsFor must be deterministic - no Date, no random
  const sites = [siteWithRacks(0, [rack('R1', [['site-a-core-01', 'Core'], ['site-a-spine-01', 'Spine']])], [
    { id: '1', a: port('site-a-core-01', 'et-0/0/0'), b: port('site-a-spine-01', 'Ethernet1') },
  ])]
  const run1 = protocolsFor(sites, { lsdb: true, ospf: true })
  const run2 = protocolsFor(sites, { lsdb: true, ospf: true })
  // Compare a link's timestamp field - must be identical
  const link1 = run1.links[0]
  const link2 = run2.links.find((l) => l.a.device === link1.a.device && l.a.interface === link1.a.interface)
  assert.equal(link1.last_seen, link2.last_seen, 'last_seen must be deterministic')
  // Compare OSPF timestamps
  const ospf1 = run1.ospfAdjacencies[0]
  const ospf2 = run2.ospfAdjacencies.find((a) => a.device === ospf1.device && a.interface === ospf1.interface)
  assert.equal(ospf1.up_since, ospf2.up_since, 'up_since must be deterministic')
  assert.equal(ospf1.last_update, ospf2.last_update, 'last_update must be deterministic')
})

test('test_protocolsFor_unmonitoredPortId_macLikeOrNull', () => {
  // T12-F3: unmonitored far end port_id should be MAC-like or null, not interface name
  const sites = [siteWithRacks(0, [rack('R1', [['site-a-leaf-01', 'Leaf'], ['site-a-srv-01', 'Database']])], [
    { id: '1', a: port('site-a-leaf-01', 'Ethernet1'), b: port('site-a-srv-01', 'eth0') },
  ])]
  const { links } = protocolsFor(sites, { lsdb: true, ospf: true })
  const link = links.find((l) => l.a.device === 'site-a-leaf-01')
  assert.equal(link.b.device, null, 'far end is unmonitored')
  // port_id must be MAC-like or null, NOT the interface name
  if (link.b.port_id !== null) {
    assert.ok(isMacLike(link.b.port_id), `port_id should be MAC-like or null, got: "${link.b.port_id}"`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Fix round 1 regression tests (findings C-T12-1 through C-T12-4)
// ─────────────────────────────────────────────────────────────────────────────

const isSystemId3Groups = (s) => /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/.test(s)

test('test_protocolsFor_systemId_threeGroupsOfFourHexDigits', () => {
  // C-T12-3: system_id must be three dot-separated groups of four hex digits (0000.0000.0001)
  const sites = [siteWithRacks(0, [rack('R1', [['site-a-core-01', 'Core'], ['site-a-core-02', 'Core']])], [
    { id: '1', a: port('site-a-core-01', 'et-0/0/0'), b: port('site-a-core-02', 'et-0/0/1') },
  ])]
  const { isisAdjacencies, isisTopology } = protocolsFor(sites, { lsdb: true, ospf: true })
  // Check adjacency system_id format
  for (const adj of isisAdjacencies) {
    assert.ok(isSystemId3Groups(adj.system_id), `adjacency system_id should be 3 groups, got: "${adj.system_id}"`)
  }
  // Check topology node system_id format
  for (const node of isisTopology.nodes) {
    assert.ok(isSystemId3Groups(node.system_id), `node system_id should be 3 groups, got: "${node.system_id}"`)
  }
  // Check topology link system_id format
  for (const link of isisTopology.links) {
    assert.ok(isSystemId3Groups(link.a.system_id), `link a.system_id should be 3 groups, got: "${link.a.system_id}"`)
    assert.ok(isSystemId3Groups(link.b.system_id), `link b.system_id should be 3 groups, got: "${link.b.system_id}"`)
  }
})

test('test_protocolsFor_circuitCores_linkRowAndIsisWithPeerHostname', () => {
  // C-T12-1: Two cores joined only by a circuit should:
  // - emit one /links row (confirmed pair from lower device)
  // - emit IS-IS adjacencies with peer's real system_id and hostname
  const cid = 'ACME-SITE-A-SITE-B-001'
  const siteA = siteWithRacks(2, [rack('R1', [['site-a-core-01', 'Core']])], [
    { id: '1', a: port('site-a-core-01', 'et-0/0/0'), b: circuit(cid) },
  ])
  const siteB = siteWithRacks(-74, [rack('R1', [['site-b-core-01', 'Core']])], [
    { id: '2', a: circuit(cid), b: port('site-b-core-01', 'et-0/0/1') },
  ])
  const { links, isisAdjacencies } = protocolsFor([siteA, siteB], { lsdb: true, ospf: true })

  // Should have exactly one link row for this circuit (confirmed pair)
  const circuitLinks = links.filter((l) =>
    (l.a.device === 'site-a-core-01' && l.b.device === 'site-b-core-01') ||
    (l.a.device === 'site-b-core-01' && l.b.device === 'site-a-core-01')
  )
  assert.equal(circuitLinks.length, 1, 'circuit should have exactly one link row')
  assert.equal(circuitLinks[0].a.device, 'site-a-core-01', 'emitted from alphabetically lower device')
  assert.equal(circuitLinks[0].b.device, 'site-b-core-01')
  assert.equal(circuitLinks[0].confirmed, true)

  // IS-IS adjacencies should have peer's real system_id and hostname
  const adjA = isisAdjacencies.find((a) => a.device === 'site-a-core-01')
  const adjB = isisAdjacencies.find((a) => a.device === 'site-b-core-01')
  assert.ok(adjA, 'site-a-core-01 should have IS-IS adjacency')
  assert.ok(adjB, 'site-b-core-01 should have IS-IS adjacency')
  // Each adjacency should point to the OTHER device's system_id
  assert.equal(adjA.neighbor_hostname, 'site-b-core-01', 'adjacency should have peer hostname')
  assert.equal(adjB.neighbor_hostname, 'site-a-core-01', 'adjacency should have peer hostname')
  // system_id should match the peer's deterministic id, not a fake circuit-peer id
  assert.notEqual(adjA.system_id, adjB.system_id, 'adjacencies should point to different peers')
})

test('test_protocolsFor_circuitCores_lsdbLinkWithAdjSids', () => {
  // C-T12-2: Two cores joined only by a circuit with LSDB on should produce one LSDB link with adj-SIDs
  const cid = 'ACME-SITE-A-SITE-B-001'
  const siteA = siteWithRacks(2, [rack('R1', [['site-a-core-01', 'Core']])], [
    { id: '1', a: port('site-a-core-01', 'et-0/0/0'), b: circuit(cid) },
  ])
  const siteB = siteWithRacks(-74, [rack('R1', [['site-b-core-01', 'Core']])], [
    { id: '2', a: circuit(cid), b: port('site-b-core-01', 'et-0/0/1') },
  ])
  const { isisTopology } = protocolsFor([siteA, siteB], { lsdb: true, ospf: true })

  // Should have nodes for both cores
  assert.equal(isisTopology.nodes.length, 2, 'should have two LSDB nodes')
  const nodeA = isisTopology.nodes.find((n) => n.hostname === 'site-a-core-01')
  const nodeB = isisTopology.nodes.find((n) => n.hostname === 'site-b-core-01')
  assert.ok(nodeA, 'should have node for site-a-core-01')
  assert.ok(nodeB, 'should have node for site-b-core-01')

  // Should have exactly one link between them
  assert.equal(isisTopology.links.length, 1, 'should have exactly one LSDB link')
  const link = isisTopology.links[0]
  assert.ok(link.a.adj_sids?.length > 0, 'link a side should have adj_sids')
  assert.ok(link.b.adj_sids?.length > 0, 'link b side should have adj_sids')
})
