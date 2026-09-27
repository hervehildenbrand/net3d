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
