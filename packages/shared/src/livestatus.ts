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

/**
 * Map live gNMI interface rates onto documented cables. Each direction prefers that side's
 * own tx rate, falling back to the peer's rx when that side isn't itself monitored or is
 * stale. Cables with no monitored end, or whose rates are still initializing, are absent
 * from the result (render as today).
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

interface CircuitCableLike {
  a: CircuitCableEnd | null
  b: CircuitCableEnd | null
}

/** Collect device endpoints per circuit cid from cables that connect a device to a circuit. */
export function circuitLinks(cables: CircuitCableLike[]): CableLike[] {
  const byCid = new Map<string, CableSide[]>()

  for (const c of cables) {
    const sides = [c.a, c.b].filter((s): s is CircuitCableEnd => !!s)
    const circuitEnd = sides.find((s) => s.kind === 'circuit' && s.name)
    const deviceEnd = sides.find((s) => s.kind === 'device' && s.deviceName)
    if (!circuitEnd || !deviceEnd) continue

    const cid = circuitEnd.name
    const ends = byCid.get(cid) ?? []
    if (ends.some((e) => e.deviceName === deviceEnd.deviceName && e.name === deviceEnd.name)) continue
    ends.push({ deviceName: deviceEnd.deviceName, name: deviceEnd.name })
    byCid.set(cid, ends)
  }

  return [...byCid].map(([id, [a, b]]) => ({ id, a: a ?? null, b: b ?? null }))
}
