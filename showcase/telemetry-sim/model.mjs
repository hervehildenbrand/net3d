// Pure, deterministic traffic model for the showcase telemetry simulator: no I/O, no clock and no
// randomness, so every run, every net3d instance and every test sees the same rate for a (link, time).

/** Showcase seed role names (NetBox + Infrahub) whose ports are monitored: switches and routers only. */
export const MONITORED_ROLES = new Set(['Core', 'Spine', 'Leaf', 'OOB']) // ponytail: showcase names only; make it an env list if pointed at another SoT

/** FNV-1a, 32-bit unsigned. */
export function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193)
  return h >>> 0
}

const unit = (str) => hash(str) / 2 ** 32 // uniform in [0, 1)

/** Port line rate in bps from a NetBox/Infrahub interface type slug; null when unknown (LAG, virtual, ...). */
export function capacityFromIfaceType(type) {
  const g = /^(\d+)gbase/i.exec(type ?? '')
  if (g) return Number(g[1]) * 1e9
  return /^1000base/i.test(type ?? '') ? 1e9 : null
}

/**
 * bps for one direction of one link at tMs: a hashed log-uniform base (0.05 %–60 % of capacity, so the
 * whole 0.01–100 % colour scale is used) × a day/night swing on the sender's local solar hour
 * × two hashed 20–120 s sines (±15 % together), clamped to capacity.
 */
export function rateBps(key, tMs, lonDeg, capBps) {
  const cap = capBps ?? 1e9 // unknown port type: bps only, never a % (capacity_bps stays null)
  const base = 0.0005 * 1200 ** unit(key)
  const hour = tMs / 3.6e6 + lonDeg / 15
  const day = 0.65 + 0.35 * Math.sin((2 * Math.PI * (hour - 9)) / 24) // 0.3 at 03:00, 1.0 at 15:00 local
  let wobble = 1
  for (const n of [1, 2]) {
    const periodMs = 20_000 + 100_000 * unit(`${key}#p${n}`)
    wobble += 0.075 * Math.sin(2 * Math.PI * (tMs / periodMs + unit(`${key}#f${n}`)))
  }
  return Math.round(Math.min(cap, cap * base * day * wobble))
}

/** ~1.5 % of devices (hashed) report STALE for 60 s of every 10 min, each at its own hashed offset. */
export function isStale(device, tMs) {
  if (unit(`${device}#stale`) >= 0.015) return false
  const s = (tMs / 1000 - 600 * unit(`${device}#phase`)) % 600
  return (s < 0 ? s + 600 : s) < 60
}

const isPort = (e) => e?.kind === 'device' && e.termType === 'interface' && !!e.deviceName && !!e.name
const portId = (e) => `${e.deviceName}|${e.name}`
// one traffic direction; both ends of a link hold the same object, so a.tx === b.rx by construction
const flow = (key, lon, ...ends) => {
  const caps = ends.map((e) => capacityFromIfaceType(e.ifaceType)).filter((c) => c !== null)
  return { key, lon, capBps: caps.length ? Math.min(...caps) : null }
}

/**
 * sites: [{ lon, detail }] with detail = net3d's GET /api/sites/:name payload. Returns
 * Map<deviceName, Map<ifaceName, { capBps, tx, rx }>> for monitored devices' cabled interfaces.
 * Direct device↔device cables share per-cable flows; circuit cables share per-cid flows with the ends
 * ordered by device name (A and Z agree whichever site loads first); anything else (patch-panel
 * routed, dangling) gets its own per-port flows.
 */
export function buildInventory(sites) {
  const monitored = new Set(
    sites.flatMap(({ detail }) =>
      detail.racks.flatMap((r) => r.devices).filter((d) => MONITORED_ROLES.has(d.roleName)).map((d) => d.name),
    ),
  )
  const inv = new Map()
  const add = (e, tx, rx) => {
    if (!monitored.has(e.deviceName)) return
    if (!inv.has(e.deviceName)) inv.set(e.deviceName, new Map())
    const ports = inv.get(e.deviceName)
    // ponytail: several NET3D_URLS union by device+port name, first URL wins; backends that cable different circuits to the same port names need one sim each
    if (!ports.has(e.name)) ports.set(e.name, { capBps: capacityFromIfaceType(e.ifaceType), tx, rx })
  }
  const circuits = new Map() // cid -> [{ e, lon }]
  for (const { lon, detail } of sites) {
    for (const { id, a, b } of detail.cables) {
      const cid = [a, b].find((e) => e?.kind === 'circuit' && e.name)?.name
      if (cid) {
        const e = [a, b].find(isPort)
        if (!e) continue
        if (!circuits.has(cid)) circuits.set(cid, [])
        const ends = circuits.get(cid)
        if (!ends.some((x) => portId(x.e) === portId(e))) ends.push({ e, lon })
      } else if (isPort(a) && isPort(b)) {
        const ab = flow(`${id}>`, lon, a, b)
        const ba = flow(`${id}<`, lon, a, b)
        add(a, ab, ba)
        add(b, ba, ab)
      } else {
        // ponytail: panel-routed ends move independently; follow the cable trace if both ends must agree
        for (const e of [a, b].filter(isPort)) add(e, flow(`${portId(e)}>`, lon, e), flow(`${portId(e)}<`, lon, e))
      }
    }
  }
  for (const [cid, ends] of circuits) {
    const [x, y = x] = ends.sort((p, q) => (portId(p.e) < portId(q.e) ? -1 : 1))
    const ab = flow(`${cid}>`, x.lon, x.e, y.e) // each direction follows its sender's sun
    const ba = flow(`${cid}<`, y.lon, x.e, y.e)
    add(x.e, ab, ba)
    add(y.e, ba, ab)
  }
  return inv
}

/** Contract rows for GET /api/v1/devices/{device}/interfaces at tMs; null for an unknown device. */
export function interfacesAt(inv, device, tMs) {
  const ports = inv.get(device)
  if (!ports) return null
  const stale = isStale(device, tMs)
  const rate = (f) => (stale ? null : rateBps(f.key, tMs, f.lon, f.capBps))
  return [...ports].map(([name, p]) => ({
    interface: name,
    telemetry_state: stale ? 'STALE' : 'LIVE',
    capacity_bps: p.capBps,
    rx_bps: rate(p.rx),
    tx_bps: rate(p.tx),
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Protocol fabrication for /links, /isis/adjacencies, /isis/topology, /ospf/adjacencies
// ─────────────────────────────────────────────────────────────────────────────

/** Locally administered MAC from hash (private, deterministic). */
const localMac = (str) => {
  const h = hash(str)
  // Locally administered unicast: second-lowest bit of first byte = 1, lowest bit = 0
  const bytes = [(h >>> 24) | 0x02, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff, hash(`${str}#4`) & 0xff, hash(`${str}#5`) & 0xff]
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(':')
}

/** IS-IS system-id from device name (deterministic, three groups of four hex digits). */
const systemId = (name) => {
  const h = hash(name)
  const h2 = hash(`${name}#sid`)
  // Contract: three dot-separated groups of four lowercase hex digits (0000.0000.0001)
  return [h >>> 16, h & 0xffff, h2 >>> 16]
    .map((w) => w.toString(16).padStart(4, '0'))
    .join('.')
}

/** RFC 5737 address from device name (deterministic, within 192.0.2.x). */
const rfc5737Addr = (name, suffix = 0) => `192.0.2.${(hash(`${name}#${suffix}`) % 254) + 1}`

const unitInterface = (iface) => `${iface}.0`

/** Fixed timestamp for deterministic protocol output (the simulator serves fabricated data). */
const FIXED_TS = '2026-01-01T00:00:00.000Z'

/** Unmonitored far end port_id: hashed share gets MAC-like, rest omit it (null). */
const unmonitoredPortId = (deviceName) => hash(deviceName) % 2 === 0 ? localMac(`${deviceName}#port`) : null

/**
 * Fabricate /links, /isis/adjacencies, /isis/topology, /ospf/adjacencies from SoT data.
 * @param sites - [{ lon, detail }] from net3d's /api/sites/:name
 * @param opts - { lsdb: boolean, ospf: boolean }
 * @param monitoredRoles - Set of role names to consider monitored (default: MONITORED_ROLES)
 */
export function protocolsFor(sites, { lsdb = true, ospf = true }, monitoredRoles = MONITORED_ROLES) {
  const links = []
  const isisAdjacencies = []
  const ospfAdjacencies = []

  // Build device-to-role map and monitored set
  const deviceRole = new Map()
  for (const { detail } of sites) {
    for (const rack of detail.racks) {
      for (const d of rack.devices) {
        deviceRole.set(d.name, d.roleName)
      }
    }
  }
  const monitored = new Set([...deviceRole].filter(([, r]) => monitoredRoles.has(r)).map(([n]) => n))

  // Find server racks (racks containing non-monitored devices, no monitored devices)
  const serverRacks = new Set()
  for (const { detail } of sites) {
    for (const rack of detail.racks) {
      const hasMonitored = rack.devices.some((d) => monitored.has(d.name))
      const hasUnmonitored = rack.devices.some((d) => !monitored.has(d.name) && !['Patch-panel', 'PDU'].includes(deviceRole.get(d.name)))
      if (!hasMonitored && hasUnmonitored) serverRacks.add(rack.name)
    }
  }

  // Track which monitored devices have been connected to BMC
  const bmcAssigned = new Set()

  // Track emitted link keys to emit confirmed pairs once
  const emittedLinkKeys = new Set()

  // Track cabled ports for BMC assignment
  const cabledPorts = new Map() // device -> Set of port names

  // Collect circuit terminations for cross-site join (cid -> [{iface, role, monitored}])
  const circuitEnds = new Map()
  // Track core pairs joined over circuits for LSDB links
  const circuitCorePairs = []

  // ponytail: follow front/rear-port pairs for panel-routed cables
  const pairedPorts = new Map() // (deviceName, portName) -> pairedPortName
  for (const { detail } of sites) {
    for (const c of detail.cables) {
      for (const e of [c.a, c.b]) {
        if (e?.termType === 'front-port' || e?.termType === 'rear-port') {
          if (e.pairedPort) pairedPorts.set(`${e.deviceName}|${e.name}`, e.pairedPort)
        }
      }
    }
  }

  // Build cable index for panel routing
  const cableIndex = new Map() // (deviceName|portName) -> cable
  for (const { detail } of sites) {
    for (const c of detail.cables) {
      if (c.a?.deviceName && c.a?.name) cableIndex.set(`${c.a.deviceName}|${c.a.name}`, { cable: c, end: 'a' })
      if (c.b?.deviceName && c.b?.name) cableIndex.set(`${c.b.deviceName}|${c.b.name}`, { cable: c, end: 'b' })
    }
  }

  // Follow panel route to find far end
  const followPanel = (fromDevice, fromPort, maxDepth = 5) => {
    const visited = new Set()
    let depth = 0
    let currentDevice = fromDevice
    let currentPort = fromPort

    while (depth < maxDepth) {
      const key = `${currentDevice}|${currentPort}`
      if (visited.has(key)) return null
      visited.add(key)

      // Find the cable at this port
      const entry = cableIndex.get(key)
      if (!entry) return null

      const farEnd = entry.end === 'a' ? entry.cable.b : entry.cable.a
      if (!farEnd) return null

      // If far end is a device interface, we're done
      if (farEnd.termType === 'interface' && farEnd.deviceName) {
        return farEnd
      }

      // If far end is a front/rear port, follow the paired port
      if ((farEnd.termType === 'front-port' || farEnd.termType === 'rear-port') && farEnd.deviceName) {
        const paired = pairedPorts.get(`${farEnd.deviceName}|${farEnd.name}`)
        if (!paired) return null
        currentDevice = farEnd.deviceName
        currentPort = paired
        depth++
        continue
      }

      return null
    }
    return null
  }

  // Process cables
  for (const { detail } of sites) {
    for (const c of detail.cables) {
      const a = c.a
      const b = c.b

      // Skip power cables (both ends are 'other'), but not circuit cables (circuit ends are 'other' but one end is an interface)
      const isPowerCable = a?.termType === 'other' && b?.termType === 'other'
      if (isPowerCable) continue

      // Direct device-to-device cable
      if (a?.kind === 'device' && a?.termType === 'interface' && b?.kind === 'device' && b?.termType === 'interface') {
        const aMonitored = monitored.has(a.deviceName)
        const bMonitored = monitored.has(b.deviceName)

        // Track cabled ports
        if (a.deviceName && a.name) {
          if (!cabledPorts.has(a.deviceName)) cabledPorts.set(a.deviceName, new Set())
          cabledPorts.get(a.deviceName).add(a.name)
        }
        if (b.deviceName && b.name) {
          if (!cabledPorts.has(b.deviceName)) cabledPorts.set(b.deviceName, new Set())
          cabledPorts.get(b.deviceName).add(b.name)
        }

        if (aMonitored || bMonitored) {
          // At least one end is monitored
          const emitter = aMonitored && (!bMonitored || a.deviceName < b.deviceName) ? a : b
          const far = emitter === a ? b : a
          const farMonitored = monitored.has(far.deviceName)

          // Confirmed pair key: emit once from lower end
          const pairKey = [a.deviceName, b.deviceName].sort().join('~')
          if (farMonitored && emittedLinkKeys.has(pairKey)) continue
          if (farMonitored) emittedLinkKeys.add(pairKey)

          links.push({
            a: { device: emitter.deviceName, interface: emitter.name, chassis_id: localMac(emitter.deviceName), port_id: emitter.name, system_name: `${emitter.deviceName}.example.net` },
            b: farMonitored
              ? { device: far.deviceName, interface: far.name, chassis_id: localMac(far.deviceName), port_id: far.name, system_name: `${far.deviceName}.example.net` }
              : { device: null, interface: null, chassis_id: localMac(far.deviceName), port_id: unmonitoredPortId(far.deviceName), system_name: `${far.deviceName}.example.net` },
            state: 'PRESENT',
            confirmed: farMonitored,
            last_seen: FIXED_TS,
          })

          // OSPF for Core-to-Spine cables
          if (ospf && aMonitored && bMonitored) {
            const aRole = deviceRole.get(a.deviceName)
            const bRole = deviceRole.get(b.deviceName)
            if ((aRole === 'Core' && bRole === 'Spine') || (aRole === 'Spine' && bRole === 'Core')) {
              // OSPF on both ends
              for (const [local, remote] of [[a, b], [b, a]]) {
                ospfAdjacencies.push({
                  device: local.deviceName,
                  network_instance: 'DEFAULT',
                  process: '1',
                  area: '0.0.0.0',
                  interface: local.name,
                  neighbor_router_id: rfc5737Addr(remote.deviceName),
                  state: 'FULL',
                  neighbor_address: rfc5737Addr(remote.deviceName, 1),
                  priority: 1,
                  designated_router: '0.0.0.0',
                  backup_designated_router: '0.0.0.0',
                  up_since: FIXED_TS,
                  telemetry_state: 'LIVE',
                  last_update: FIXED_TS,
                })
              }
            }
          }
        }
        continue
      }

      // Panel-routed cable: interface -> front-port
      if (a?.kind === 'device' && a?.termType === 'interface' && (b?.termType === 'front-port' || b?.termType === 'rear-port')) {
        const emitter = a
        if (!monitored.has(emitter.deviceName)) continue

        // Track cabled port
        if (!cabledPorts.has(emitter.deviceName)) cabledPorts.set(emitter.deviceName, new Set())
        cabledPorts.get(emitter.deviceName).add(emitter.name)

        // Follow panel route to find far end
        const paired = pairedPorts.get(`${b.deviceName}|${b.name}`)
        if (!paired) continue
        const farEnd = followPanel(b.deviceName, paired)
        if (farEnd && farEnd.deviceName) {
          const farMonitored = monitored.has(farEnd.deviceName)

          const pairKey = [emitter.deviceName, farEnd.deviceName].sort().join('~')
          if (farMonitored && emittedLinkKeys.has(pairKey)) continue
          if (farMonitored) emittedLinkKeys.add(pairKey)

          links.push({
            a: { device: emitter.deviceName, interface: emitter.name, chassis_id: localMac(emitter.deviceName), port_id: emitter.name, system_name: `${emitter.deviceName}.example.net` },
            b: farMonitored
              ? { device: farEnd.deviceName, interface: farEnd.name, chassis_id: localMac(farEnd.deviceName), port_id: farEnd.name, system_name: `${farEnd.deviceName}.example.net` }
              : { device: null, interface: null, chassis_id: localMac(farEnd.deviceName), port_id: unmonitoredPortId(farEnd.deviceName), system_name: `${farEnd.deviceName}.example.net` },
            state: 'PRESENT',
            confirmed: farMonitored,
            last_seen: FIXED_TS,
          })
        }
        continue
      }

      // Circuit cable: interface -> circuit - collect for cross-site join
      if ((a?.kind === 'device' && a?.termType === 'interface' && b?.kind === 'circuit') ||
          (b?.kind === 'device' && b?.termType === 'interface' && a?.kind === 'circuit')) {
        const iface = a?.termType === 'interface' ? a : b
        const ckt = a?.kind === 'circuit' ? a : b
        const cid = ckt.name
        if (!cid) continue

        // Track cabled port
        if (!cabledPorts.has(iface.deviceName)) cabledPorts.set(iface.deviceName, new Set())
        cabledPorts.get(iface.deviceName).add(iface.name)

        // Collect circuit terminations for cross-site join (like circuitLinks in livestatus.ts)
        if (!circuitEnds.has(cid)) circuitEnds.set(cid, [])
        circuitEnds.get(cid).push({ iface, role: deviceRole.get(iface.deviceName), monitored: monitored.has(iface.deviceName) })
      }
    }
  }

  // Join circuit terminations across all sites by cid
  for (const [cid, ends] of circuitEnds) {
    if (ends.length !== 2) continue // need exactly two ends
    const [e1, e2] = ends
    if (!e1.monitored && !e2.monitored) continue // at least one end must be monitored

    // Emit link row (confirmed when both monitored, from lower device)
    const both = e1.monitored && e2.monitored
    const [emitter, far] = both && e1.iface.deviceName < e2.iface.deviceName
      ? [e1, e2]
      : both && e2.iface.deviceName < e1.iface.deviceName
        ? [e2, e1]
        : e1.monitored ? [e1, e2] : [e2, e1]

    links.push({
      a: { device: emitter.iface.deviceName, interface: emitter.iface.name, chassis_id: localMac(emitter.iface.deviceName), port_id: emitter.iface.name, system_name: `${emitter.iface.deviceName}.example.net` },
      b: both
        ? { device: far.iface.deviceName, interface: far.iface.name, chassis_id: localMac(far.iface.deviceName), port_id: far.iface.name, system_name: `${far.iface.deviceName}.example.net` }
        : { device: null, interface: null, chassis_id: localMac(far.iface.deviceName), port_id: unmonitoredPortId(far.iface.deviceName), system_name: `${far.iface.deviceName}.example.net` },
      state: 'PRESENT',
      confirmed: both,
      last_seen: FIXED_TS,
    })

    // IS-IS adjacencies for Core-to-Core circuits (both ends must be Core and monitored)
    if (e1.role === 'Core' && e2.role === 'Core' && both) {
      for (const [local, remote] of [[e1, e2], [e2, e1]]) {
        isisAdjacencies.push({
          device: local.iface.deviceName,
          interface: unitInterface(local.iface.name),
          level: 2,
          system_id: systemId(remote.iface.deviceName),
          state: 'UP',
          type: 'LEVEL_2',
          neighbor_ipv4: rfc5737Addr(remote.iface.deviceName),
          neighbor_ipv6: null,
          neighbor_hostname: lsdb ? remote.iface.deviceName : null,
          area_addresses: ['49.0001'],
          up_since: FIXED_TS,
          telemetry_state: 'LIVE',
          last_update: FIXED_TS,
        })
      }
      // Track for LSDB links
      circuitCorePairs.push([e1.iface.deviceName, e2.iface.deviceName])
    }
  }

  // Add BMC links for server racks (one BMC per server rack, on first uncabled leaf port)
  for (const { detail } of sites) {
    for (const rack of detail.racks) {
      if (!serverRacks.has(rack.name)) continue

      // Find a leaf in another rack with an uncabled port
      for (const otherRack of detail.racks) {
        if (serverRacks.has(otherRack.name)) continue
        for (const d of otherRack.devices) {
          if (!monitored.has(d.name)) continue
          if (deviceRole.get(d.name) !== 'Leaf') continue
          if (bmcAssigned.has(rack.name)) break

          // Pick an uncabled port
          const usedPorts = cabledPorts.get(d.name) ?? new Set()
          const bmcPort = `Ethernet${hash(rack.name) % 48}`
          if (usedPorts.has(bmcPort)) continue

          links.push({
            a: { device: d.name, interface: bmcPort, chassis_id: localMac(d.name), port_id: bmcPort, system_name: `${d.name}.example.net` },
            b: { device: null, interface: null, chassis_id: localMac(`${rack.name}-bmc`), port_id: null, system_name: `${rack.name}-bmc.example.net` },
            state: 'PRESENT',
            confirmed: false,
            last_seen: FIXED_TS,
          })
          bmcAssigned.add(rack.name)
          break
        }
        if (bmcAssigned.has(rack.name)) break
      }
    }
  }

  // IS-IS adjacencies for Core-to-Core cables
  for (const { detail } of sites) {
    for (const c of detail.cables) {
      const a = c.a
      const b = c.b
      if (a?.kind !== 'device' || a?.termType !== 'interface') continue
      if (b?.kind !== 'device' || b?.termType !== 'interface') continue

      const aRole = deviceRole.get(a.deviceName)
      const bRole = deviceRole.get(b.deviceName)
      if (aRole !== 'Core' || bRole !== 'Core') continue
      if (!monitored.has(a.deviceName) || !monitored.has(b.deviceName)) continue

      // IS-IS on both ends
      for (const [local, remote] of [[a, b], [b, a]]) {
        isisAdjacencies.push({
          device: local.deviceName,
          interface: unitInterface(local.name),
          level: 2,
          system_id: systemId(remote.deviceName),
          state: 'UP',
          type: 'LEVEL_2',
          neighbor_ipv4: rfc5737Addr(remote.deviceName),
          neighbor_ipv6: null,
          neighbor_hostname: lsdb ? remote.deviceName : null,
          area_addresses: ['49.0001'],
          up_since: FIXED_TS,
          telemetry_state: 'LIVE',
          last_update: FIXED_TS,
        })
      }
    }
  }

  // Build IS-IS topology (LSDB)
  let isisTopology
  if (lsdb) {
    const nodes = []
    const lsdbLinks = []
    const coreDevices = [...monitored].filter((d) => deviceRole.get(d) === 'Core')

    for (const name of coreDevices) {
      const prefixSid = (hash(name) % 1000) + 16000
      nodes.push({
        level: 2,
        system_id: systemId(name),
        hostname: name,
        router_id: rfc5737Addr(name),
        srgb: [{ base: 16000, range: 8000 }],
        sr_flags: ['IPV4_MPLS'],
        sr_algorithms: ['SPF', 'STRICT_SPF'],
        prefix_sids: [{
          prefix: `${rfc5737Addr(name)}/32`,
          index: prefixSid - 16000,
          label: prefixSid,
          flags: ['NODE'],
          algorithm: 0,
        }],
        sources: [name],
        last_update: FIXED_TS,
      })
    }

    // Add LSDB links for Core-to-Core cables and circuit-connected core pairs
    const lsdbLinkKeys = new Set()
    const addLsdbLink = (first, second) => {
      const pairKey = [first, second].sort().join('~')
      if (lsdbLinkKeys.has(pairKey)) return
      lsdbLinkKeys.add(pairKey)
      const [a, b] = [first, second].sort()
      lsdbLinks.push({
        level: 2,
        two_way: true,
        a: {
          system_id: systemId(a),
          hostname: a,
          metric: 10,
          addresses: [rfc5737Addr(a, 10)],
          neighbor_addresses: [rfc5737Addr(b, 10)],
          adj_sids: [{ value: hash(`${a}-${b}`) % 1000 + 24000, label: null, flags: ['VALUE', 'LOCAL'], weight: 0 }],
        },
        b: {
          system_id: systemId(b),
          hostname: b,
          metric: 10,
          addresses: [rfc5737Addr(b, 10)],
          neighbor_addresses: [rfc5737Addr(a, 10)],
          adj_sids: [{ value: hash(`${b}-${a}`) % 1000 + 24000, label: null, flags: ['VALUE', 'LOCAL'], weight: 0 }],
        },
      })
    }

    // From direct Core-to-Core cables
    for (const { detail } of sites) {
      for (const c of detail.cables) {
        const a = c.a
        const b = c.b
        if (a?.kind !== 'device' || b?.kind !== 'device') continue
        const aRole = deviceRole.get(a.deviceName)
        const bRole = deviceRole.get(b.deviceName)
        if (aRole !== 'Core' || bRole !== 'Core') continue
        addLsdbLink(a.deviceName, b.deviceName)
      }
    }

    // From circuit-connected core pairs
    for (const [a, b] of circuitCorePairs) {
      addLsdbLink(a, b)
    }

    isisTopology = {
      sources: coreDevices.map((name) => ({ device: name, telemetry_state: 'LIVE', synced_at: FIXED_TS })),
      nodes,
      links: lsdbLinks,
    }
  } else {
    isisTopology = { sources: [], nodes: [], links: [] }
  }

  return { links, isisAdjacencies, isisTopology, ospfAdjacencies }
}
