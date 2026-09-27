import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInventory, capacityFromIfaceType, hash, interfacesAt, isStale, rateBps } from './model.mjs'

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
