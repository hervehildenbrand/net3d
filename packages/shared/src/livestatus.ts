export interface LiveInterface {
  is_up: boolean
}

interface CableSide {
  deviceName: string | null
  name: string
}

interface CableLike {
  id: string
  a: CableSide | null
  b: CableSide | null
}

export type CableStatus = 'up' | 'down'

/** One interface's live gNMI rates, as reported by a netstatex collector. */
export interface LiveIface {
  rxBps: number | null
  txBps: number | null
  capacityBps: number | null
  stale: boolean
}

/** Live telemetry for one site: device name -> interface name -> rates. `{}` = no monitored device at this site. */
export interface SiteTelemetry {
  devices: Record<string, Record<string, LiveIface>>
}

/** A cable's live utilisation, derived from its endpoints' telemetry. */
export interface CableLive {
  pct: number | null
  bps: number | null
  stale: boolean
}

/** Live traffic in one direction of a circuit or link: what leaves one site toward the other. */
export interface DirLive {
  bps: number | null
  pct: number | null
}

/** A circuit's live state plus its per-direction rates, keyed by the site the traffic leaves. */
export interface CircuitLive extends CableLive {
  dirs?: Record<string, DirLive>
}

/** One circuit end at a known site: the device port that site's own cable connects to circuit `cid`. */
export interface CircuitEnd {
  cid: string
  site: string
  deviceName: string
  name: string
}

/**
 * Map live gNMI interface rates onto documented cables. Each direction prefers that side's
 * own tx rate, falling back to the peer's rx when that side isn't itself monitored or its
 * tx rate is null. Cables with no monitored end, or whose rates are still initializing, are
 * absent from the result (render as today).
 */
// ponytail: direct cables only (both ends' own ports), no patch-panel trace fan-out; add via the cable-trace path if panels matter
export function mapTelemetryToCables(telemetry: SiteTelemetry, cables: CableLike[]): Map<string, CableLive> {
  const at = (side: CableSide | null): LiveIface | undefined =>
    side?.deviceName ? telemetry.devices[side.deviceName]?.[side.name] : undefined

  const result = new Map<string, CableLive>()
  for (const c of cables) {
    const a = at(c.a)
    const b = at(c.b)
    if (!a && !b) continue

    const ab = a?.txBps ?? b?.rxBps ?? null
    const ba = b?.txBps ?? a?.rxBps ?? null
    const known = [a, b].filter((x): x is LiveIface => !!x)
    const stale = known.every((x) => x.stale)
    if (ab === null && ba === null && !stale) continue

    const caps = known.map((x) => x.capacityBps).filter((c): c is number => !!c)
    const cap = caps.length ? Math.min(...caps) : null // ponytail: LAG/ae capacity is null -> pct null; sum member speeds if LAG utilisation matters
    const bps = ab !== null || ba !== null ? Math.max(ab ?? 0, ba ?? 0) : null
    const pct = cap && bps !== null ? (bps * 100) / cap : null

    result.set(c.id, { pct, bps, stale })
  }
  return result
}

/**
 * Color documented cables with live NAPALM interface state for one device.
 * Subinterface readings (et-0/0/0.0) also satisfy their base interface.
 */
export function mapInterfacesToCables(
  interfaces: Record<string, LiveInterface>,
  cables: CableLike[],
  deviceName: string,
): Map<string, CableStatus> {
  const byName = new Map<string, boolean>()
  for (const [name, i] of Object.entries(interfaces)) {
    byName.set(name, i.is_up)
    const base = name.split('.')[0]!
    if (base !== name && !byName.has(base)) byName.set(base, i.is_up)
  }

  const result = new Map<string, CableStatus>()
  for (const c of cables) {
    const side = [c.a, c.b].find((s) => s?.deviceName === deviceName)
    if (!side) continue
    const up = byName.get(side.name)
    if (up === undefined) continue
    result.set(c.id, up ? 'up' : 'down')
  }
  return result
}

interface CircuitCableEnd {
  kind: string
  name: string
  deviceName: string | null
}

export interface CircuitCableLike {
  a: CircuitCableEnd | null
  b: CircuitCableEnd | null
}

/** The circuit id and device port a cable joins, or null when it is not a device↔circuit cable. */
function circuitEndOf(c: CircuitCableLike): { cid: string; deviceName: string; name: string } | null {
  const sides = [c.a, c.b].filter((s): s is CircuitCableEnd => !!s)
  const circuitEnd = sides.find((s) => s.kind === 'circuit' && s.name)
  const deviceEnd = sides.find((s) => s.kind === 'device' && s.deviceName)
  if (!circuitEnd || !deviceEnd?.deviceName) return null
  return { cid: circuitEnd.name, deviceName: deviceEnd.deviceName, name: deviceEnd.name }
}

/** Collect device endpoints per circuit cid from cables that connect a device to a circuit. */
export function circuitLinks(cables: CircuitCableLike[]): CableLike[] {
  const byCid = new Map<string, CableSide[]>()

  for (const c of cables) {
    const end = circuitEndOf(c)
    if (!end) continue
    const ends = byCid.get(end.cid) ?? []
    if (ends.some((e) => e.deviceName === end.deviceName && e.name === end.name)) continue
    ends.push({ deviceName: end.deviceName, name: end.name })
    byCid.set(end.cid, ends)
  }

  return [...byCid].map(([id, [a, b]]) => ({ id, a: a ?? null, b: b ?? null }))
}

/** Circuit ends located by the site whose own cables reach them (first port per circuit and site). */
export function circuitEnds(sites: { site: string; cables: CircuitCableLike[] }[]): CircuitEnd[] {
  const seen = new Set<string>()
  const result: CircuitEnd[] = []
  for (const { site, cables } of sites) {
    for (const c of cables) {
      const end = circuitEndOf(c)
      if (!end || seen.has(`${end.cid}\n${site}`)) continue
      seen.add(`${end.cid}\n${site}`)
      result.push({ ...end, site })
    }
  }
  return result
}

/**
 * Per-direction live rates for each circuit, keyed by the site the traffic leaves. The rate out of
 * site S is S's own port tx, else the far port's rx (the mapTelemetryToCables rule). `pairOf` names
 * both sites of a circuit, so one monitored end still yields both directions; without it the sites
 * come from the located ends. Circuits with no monitored end are absent.
 */
export function circuitDirections(
  telemetry: SiteTelemetry,
  ends: CircuitEnd[],
  pairOf: ReadonlyMap<string, readonly [string, string]> = new Map(),
): Map<string, Record<string, DirLive>> {
  const at = (e: CircuitEnd | undefined): LiveIface | undefined =>
    e ? telemetry.devices[e.deviceName]?.[e.name] : undefined
  const byCid = new Map<string, CircuitEnd[]>()
  for (const e of ends) byCid.set(e.cid, [...(byCid.get(e.cid) ?? []), e])

  const result = new Map<string, Record<string, DirLive>>()
  for (const [cid, cidEnds] of byCid) {
    const [s1, s2] = pairOf.get(cid) ?? [...new Set(cidEnds.map((e) => e.site))]
    if (!s1) continue
    const i1 = at(cidEnds.find((e) => e.site === s1))
    const i2 = s2 ? at(cidEnds.find((e) => e.site === s2)) : undefined
    const known = [i1, i2].filter((x): x is LiveIface => !!x)
    if (known.length === 0) continue

    const caps = known.map((x) => x.capacityBps).filter((c): c is number => !!c)
    const cap = caps.length ? Math.min(...caps) : null
    const dir = (bps: number | null): DirLive => ({ bps, pct: cap && bps !== null ? (bps * 100) / cap : null })
    const dirs: Record<string, DirLive> = { [s1]: dir(i1?.txBps ?? i2?.rxBps ?? null) }
    if (s2) dirs[s2] = dir(i2?.txBps ?? i1?.rxBps ?? null)
    result.set(cid, dirs)
  }
  return result
}
