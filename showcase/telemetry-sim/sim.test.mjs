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
