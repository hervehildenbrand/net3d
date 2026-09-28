import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { start } from './sim.mjs'

const port = (deviceName, name) => ({
  kind: 'device', name, deviceName, rackName: 'R1', ifaceType: '100gbase-x-qsfp28', termType: 'interface', pairedPort: null,
})
const circuit = (cid) => ({
  kind: 'circuit', name: cid, deviceName: null, rackName: null, ifaceType: null, termType: 'other', pairedPort: null,
})
const detail = (devices, cables) => ({
  racks: [{ id: 'r1', name: 'R1', uHeight: 42, location: null, devices: devices.map(([name, roleName]) => ({ name, roleName })) }],
  cables,
  power: { panels: [], feeds: [] },
})
const CID = 'ACME-AAA1-BBB1-001'
const SITES = [{ name: 'AAA1', longitude: 2.3 }, { name: 'BBB 1', longitude: -77 }] // the space exercises URL encoding
const DETAILS = {
  AAA1: detail([['AAA1-core-01', 'Core'], ['AAA1-spine-01', 'Spine'], ['AAA1-srv-01', 'Database']], [
    { id: '1', a: port('AAA1-spine-01', 'Core1'), b: port('AAA1-core-01', 'spine1-1') },
    { id: '2', a: port('AAA1-core-01', 'et-0/0/0'), b: circuit(CID) },
  ]),
  'BBB 1': detail([['BBB1-core-01', 'Core']], [{ id: '3', a: circuit(CID), b: port('BBB1-core-01', 'et-0/0/0') }]),
}

/** A net3d double serving /api/sites + /api/sites/:name; 503 while unhealthy, and once for each site name in failOnce. */
async function fakeNet3d(healthy) {
  const state = { healthy, siteListCalls: 0, failOnce: new Set() }
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url)
    if (path === '/api/sites') state.siteListCalls++
    const site = path.replace('/api/sites/', '')
    const ok = state.healthy && !state.failOnce.delete(site)
    const body = !ok ? null : path === '/api/sites' ? SITES : DETAILS[site]
    res.writeHead(body ? 200 : 503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body ?? { error: 'netbox_unavailable' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { state, server, url: `http://127.0.0.1:${server.address().port}` }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
const simUrl = (sim, path) => `http://127.0.0.1:${sim.server.address().port}/api/v1${path}`
const deviceNames = async (sim) => (await (await fetch(simUrl(sim, '/devices'))).json()).map((d) => d.name).sort()

let fake, sim
before(async () => {
  fake = await fakeNet3d(true)
  sim = await start({ net3dUrls: [fake.url], port: 0 })
})
after(async () => {
  await sim.close()
  fake.server.close()
})

test('test_start_net3dUnavailable_bindsOnlyAfterDiscovery', async () => {
  const down = await fakeNet3d(false)
  let bound = false
  const pending = start({ net3dUrls: [down.url], port: 0, retryMs: 5 }).then((s) => {
    bound = true
    return s
  })
  while (down.state.siteListCalls < 3) await tick()
  assert.equal(bound, false)
  down.state.healthy = true
  const late = await pending
  assert.ok(late.server.listening)
  await late.close()
  down.server.close()
})

test('test_start_refreshFails_keepsLastGoodInventory', async () => {
  const flaky = await fakeNet3d(true)
  const s = await start({ net3dUrls: [flaky.url], port: 0, refreshMs: 10, retryMs: 5 })
  flaky.state.healthy = false
  const calls = flaky.state.siteListCalls
  while (flaky.state.siteListCalls < calls + 2) await tick()
  assert.equal((await deviceNames(s)).length, 3)
  await s.close()
  flaky.server.close()
})

test('test_start_oneSiteDetailFails_retriesUntilAllDevicesServed', async () => {
  const partial = await fakeNet3d(true)
  partial.state.failOnce.add('BBB 1')
  const s = await start({ net3dUrls: [partial.url], port: 0, retryMs: 5 }) // refreshMs stays at 10 min
  for (let i = 0; i < 200 && (await deviceNames(s)).length < 3; i++) await tick()
  assert.deepEqual(await deviceNames(s), ['AAA1-core-01', 'AAA1-spine-01', 'BBB1-core-01'])
  await s.close()
  partial.server.close()
})

test('test_start_getDevices_listsMonitoredDevices', async () => {
  const res = await fetch(simUrl(sim, '/devices'))
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).map((d) => d.name).sort(), ['AAA1-core-01', 'AAA1-spine-01', 'BBB1-core-01'])
})

test('test_start_getInterfaces_returnsContractRows', async () => {
  const rows = await (await fetch(simUrl(sim, `/devices/${encodeURIComponent('AAA1-core-01')}/interfaces`))).json()
  assert.deepEqual(rows.map((r) => r.interface).sort(), ['et-0/0/0', 'spine1-1'])
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['capacity_bps', 'interface', 'rx_bps', 'telemetry_state', 'tx_bps'])
    assert.equal(r.capacity_bps, 1e11)
    assert.ok(['LIVE', 'STALE'].includes(r.telemetry_state))
  }
})

test('test_start_unknownDevice_returns404', async () => {
  const res = await fetch(simUrl(sim, '/devices/nope/interfaces'))
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: { code: 'NOT_FOUND' } })
})

// ─────────────────────────────────────────────────────────────────────────────
// Task 12: Topology routes
// ─────────────────────────────────────────────────────────────────────────────

test('test_start_failedSiteRound_keepsPreviousLinks', async () => {
  // After a failed refresh, /links still serves the last good set
  const flaky = await fakeNet3d(true)
  const s = await start({ net3dUrls: [flaky.url], port: 0, refreshMs: 10, retryMs: 5 })
  // Fetch links while healthy
  const before = await fetch(simUrl(s, '/links'))
  assert.equal(before.status, 200)
  const linksBefore = await before.json()
  assert.ok(Array.isArray(linksBefore) && linksBefore.length > 0, 'should have links initially')
  // Make net3d unavailable and wait for a failed refresh
  flaky.state.healthy = false
  const calls = flaky.state.siteListCalls
  while (flaky.state.siteListCalls < calls + 2) await tick()
  // Links should still be served
  const after = await fetch(simUrl(s, '/links'))
  assert.equal(after.status, 200)
  const linksAfter = await after.json()
  assert.deepEqual(linksAfter.length, linksBefore.length, 'links count unchanged after failed refresh')
  await s.close()
  flaky.server.close()
})

test('test_start_getLinks_servesProtocolEndpoints', async () => {
  // The simulator serves /links, /isis/adjacencies, /isis/topology
  const [links, isis, topo] = await Promise.all([
    fetch(simUrl(sim, '/links')).then((r) => r.json()),
    fetch(simUrl(sim, '/isis/adjacencies')).then((r) => r.json()),
    fetch(simUrl(sim, '/isis/topology')).then((r) => r.json()),
  ])
  assert.ok(Array.isArray(links), '/links should return an array')
  assert.ok(Array.isArray(isis), '/isis/adjacencies should return an array')
  assert.ok(topo.sources && topo.nodes && topo.links, '/isis/topology should have sources, nodes, links')
  // Check that the fixture data produces something meaningful
  const coreLinks = links.filter((l) => l.a.device?.includes('core') || l.b?.device?.includes('core'))
  assert.ok(coreLinks.length > 0, 'should have core device links')
})

test('test_start_ospfDisabled_returns404', async () => {
  // With SIM_OSPF=0, /ospf/adjacencies returns 404
  const down = await fakeNet3d(true)
  const s = await start({ net3dUrls: [down.url], port: 0, ospfEnabled: false })
  const res = await fetch(simUrl(s, '/ospf/adjacencies'))
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: { code: 'NOT_FOUND' } })
  await s.close()
  down.server.close()
})

test('test_start_sitesWithSameLongitude_bothSurviveMerge', async () => {
  // C-T12-4: site merge must be keyed by name, not longitude - two sites at same lon both survive
  // The bug: protocolsFor receives lastGoodSites which merges by lon, so one site overwrites the other
  const sameLonSites = [{ name: 'SITE-A', longitude: 0 }, { name: 'SITE-B', longitude: 0 }]
  const sameLonDetails = {
    'SITE-A': detail([['site-a-core-01', 'Core'], ['site-a-spine-01', 'Spine']], [
      { id: '1', a: port('site-a-core-01', 'et-0/0/0'), b: port('site-a-spine-01', 'Ethernet1') },
    ]),
    'SITE-B': detail([['site-b-core-01', 'Core'], ['site-b-spine-01', 'Spine']], [
      { id: '2', a: port('site-b-core-01', 'et-0/0/0'), b: port('site-b-spine-01', 'Ethernet1') },
    ]),
  }
  const sameLonNet3d = createServer((req, res) => {
    const path = decodeURIComponent(req.url)
    const site = path.replace('/api/sites/', '')
    const body = path === '/api/sites' ? sameLonSites : sameLonDetails[site]
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body ?? { error: 'not found' }))
  })
  await new Promise((resolve) => sameLonNet3d.listen(0, '127.0.0.1', resolve))
  const sameLonUrl = `http://127.0.0.1:${sameLonNet3d.address().port}`
  const s = await start({ net3dUrls: [sameLonUrl], port: 0 })
  // Check that /links has data from BOTH sites (if merged by lon, only one site's data survives)
  const links = await (await fetch(simUrl(s, '/links'))).json()
  const devicesInLinks = new Set(links.flatMap((l) => [l.a.device, l.b.device]).filter(Boolean))
  assert.ok(devicesInLinks.has('site-a-core-01'), 'links should include site-a devices')
  assert.ok(devicesInLinks.has('site-b-core-01'), 'links should include site-b devices')
  await s.close()
  sameLonNet3d.close()
})
