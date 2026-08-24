/** Structural subset of a cable termination for trace building. */
export interface TraceCableEnd {
  kind: string
  name: string
  deviceName: string | null
  rackName: string | null
  termType?: string          // absent (older payloads / infrahub) => treat kind==='device' end as interface
  pairedPort?: string | null
}

export interface TraceCable {
  id: string
  a: TraceCableEnd | null
  b: TraceCableEnd | null
}

export interface TraceHop {
  kind: 'interface' | 'front-port' | 'rear-port'
  portName: string
  deviceName: string | null
  rackName: string | null
}

export interface TracePath {
  hops: TraceHop[]
  cableIds: string[]
  complete: boolean
  panelCount: number
}

// ponytail: \0 delimiter - device/port names may contain '|' but never NUL
const SEP = '\0'

/** One display row of a trace: a device visit with the port(s) touched there. */
export interface TraceRow {
  deviceName: string | null
  rackName: string | null
  ports: string[]
  panel: boolean
}

/** Collapse hops into one row per device visit — panel front/rear pairs merge. */
export function groupTraceHops(trace: TracePath): TraceRow[] {
  const rows: TraceRow[] = []
  for (const h of trace.hops) {
    const prev = rows[rows.length - 1]
    if (h.kind === 'interface') {
      rows.push({ deviceName: h.deviceName, rackName: h.rackName, ports: [h.portName], panel: false })
    } else if (prev?.panel && prev.deviceName === h.deviceName) {
      prev.ports.push(h.portName)
    } else {
      rows.push({ deviceName: h.deviceName, rackName: h.rackName, ports: [h.portName], panel: true })
    }
  }
  return rows
}

/**
 * Build a bidirectional map from "deviceName\0portName" to "deviceName\0pairedPort"
 * for all front-port ends with a pairedPort set.
 */
export function extractFrontRearPairs(cables: TraceCable[]): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const c of cables) {
    for (const end of [c.a, c.b]) {
      if (!end || !end.deviceName || end.termType !== 'front-port' || !end.pairedPort) continue
      const frontKey = `${end.deviceName}${SEP}${end.name}`
      const rearKey = `${end.deviceName}${SEP}${end.pairedPort}`
      pairs.set(frontKey, rearKey)
      pairs.set(rearKey, frontKey)
    }
  }
  return pairs
}

/** Determine hop kind from an end. */
function hopKind(end: TraceCableEnd): 'interface' | 'front-port' | 'rear-port' {
  if (end.termType === 'front-port') return 'front-port'
  if (end.termType === 'rear-port') return 'rear-port'
  return 'interface'
}

/** Check if end is an interface (explicit or legacy payload without termType). */
export function isInterfaceEnd(end: TraceCableEnd): boolean {
  if (end.termType === 'interface') return true
  if (!end.termType && end.kind === 'device') return true
  return false
}

function makeHop(end: TraceCableEnd): TraceHop {
  return { kind: hopKind(end), portName: end.name, deviceName: end.deviceName, rackName: end.rackName }
}

/**
 * Build a cable path from a device interface through any patch panels.
 * Returns null if no cable connects to startDevice:startInterface.
 */
export function buildCablePath(
  cables: TraceCable[],
  pairs: Map<string, string>,
  startDevice: string,
  startInterface: string,
): TracePath | null {
  // Find initial cable
  let startCable: TraceCable | undefined
  let localEnd: TraceCableEnd | undefined
  let farEnd: TraceCableEnd | null | undefined

  for (const c of cables) {
    if (c.a?.deviceName === startDevice && c.a.name === startInterface && isInterfaceEnd(c.a)) {
      startCable = c; localEnd = c.a; farEnd = c.b; break
    }
    if (c.b?.deviceName === startDevice && c.b.name === startInterface && isInterfaceEnd(c.b)) {
      startCable = c; localEnd = c.b; farEnd = c.a; break
    }
  }

  if (!startCable || !localEnd) return null

  const hops: TraceHop[] = [makeHop(localEnd)]
  const cableIds: string[] = [startCable.id]
  const usedCables = new Set<string>([startCable.id])
  const visited = new Set<string>([`${localEnd.deviceName}${SEP}${localEnd.name}`])
  let panelCount = 0

  // Walk through the path
  let current = farEnd

  while (current) {
    const currentKey = `${current.deviceName}${SEP}${current.name}`
    if (visited.has(currentKey)) {
      // Cycle detected
      return { hops, cableIds, complete: false, panelCount }
    }
    visited.add(currentKey)

    hops.push(makeHop(current))

    // Terminal cases: interface or non-device ends (circuit, powerfeed)
    if (isInterfaceEnd(current)) {
      return { hops, cableIds, complete: true, panelCount }
    }
    if (current.termType !== 'front-port' && current.termType !== 'rear-port') {
      // circuit/powerfeed/other - terminate
      return { hops, cableIds, complete: false, panelCount }
    }

    // Front or rear port - look up paired port
    const pairedKey = pairs.get(currentKey)
    if (!pairedKey) {
      // No paired port info
      return { hops, cableIds, complete: false, panelCount }
    }

    // Add pass-through hop
    const [pairedDev, pairedPort] = pairedKey.split(SEP)
    const oppositeKind = current.termType === 'front-port' ? 'rear-port' : 'front-port'
    hops.push({ kind: oppositeKind, portName: pairedPort!, deviceName: pairedDev!, rackName: current.rackName })
    panelCount++

    visited.add(pairedKey)

    // Find next cable from the paired port
    let nextCable: TraceCable | undefined
    let nextFar: TraceCableEnd | null | undefined

    for (const c of cables) {
      if (usedCables.has(c.id)) continue
      if (c.a && c.a.deviceName === pairedDev && c.a.name === pairedPort) {
        nextCable = c; nextFar = c.b; break
      }
      if (c.b && c.b.deviceName === pairedDev && c.b.name === pairedPort) {
        nextCable = c; nextFar = c.a; break
      }
    }

    if (!nextCable) {
      // No onward cable
      return { hops, cableIds, complete: false, panelCount }
    }

    usedCables.add(nextCable.id)
    cableIds.push(nextCable.id)
    current = nextFar
  }

  // Reached null end (dangling)
  return { hops, cableIds, complete: false, panelCount }
}

/**
 * Walk from a cable end toward an interface, following pass-through pairs.
 * Returns {dev, iface} of the first interface found, or null if dead-end.
 */
function walkToInterface(
  cables: TraceCable[],
  pairs: Map<string, string>,
  start: TraceCableEnd,
  usedCables: Set<string>,
): { dev: string; iface: string } | null {
  const visited = new Set<string>()
  let current: TraceCableEnd | null = start

  while (current) {
    const key = `${current.deviceName}${SEP}${current.name}`
    if (visited.has(key)) return null // cycle
    visited.add(key)

    if (isInterfaceEnd(current) && current.deviceName) {
      return { dev: current.deviceName, iface: current.name }
    }

    if (current.termType !== 'front-port' && current.termType !== 'rear-port') {
      return null // circuit/powerfeed/other
    }

    const pairedKey = pairs.get(key)
    if (!pairedKey) return null
    visited.add(pairedKey)

    const [pairedDev, pairedPort] = pairedKey.split(SEP)
    // Find next cable from paired port
    let nextFar: TraceCableEnd | null = null
    for (const c of cables) {
      if (usedCables.has(c.id)) continue
      const { a, b } = c
      if (a && a.deviceName === pairedDev && a.name === pairedPort) {
        usedCables.add(c.id)
        nextFar = b
        break
      }
      if (b && b.deviceName === pairedDev && b.name === pairedPort) {
        usedCables.add(c.id)
        nextFar = a
        break
      }
    }
    current = nextFar
  }
  return null
}

/**
 * Build a cable path starting from a patch-panel port (front or rear).
 * Walks outward to find an interface, then returns the full path via buildCablePath.
 * If interfaces found on both ends, picks consistently by (dev, iface) sort order.
 */
export function buildCablePathThrough(
  cables: TraceCable[],
  pairs: Map<string, string>,
  deviceName: string,
  portName: string,
): TracePath | null {
  // Find cable attached to this port
  let startCable: TraceCable | undefined
  let localEnd: TraceCableEnd | undefined
  let farEnd: TraceCableEnd | null | undefined

  const portKey = `${deviceName}${SEP}${portName}`

  for (const c of cables) {
    if (c.a?.deviceName === deviceName && c.a.name === portName &&
        (c.a.termType === 'front-port' || c.a.termType === 'rear-port')) {
      startCable = c; localEnd = c.a; farEnd = c.b; break
    }
    if (c.b?.deviceName === deviceName && c.b.name === portName &&
        (c.b.termType === 'front-port' || c.b.termType === 'rear-port')) {
      startCable = c; localEnd = c.b; farEnd = c.a; break
    }
  }

  // If port itself uncabled, try its paired port
  if (!startCable) {
    const pairedKey = pairs.get(portKey)
    if (pairedKey) {
      const [pairedDev, pairedPort] = pairedKey.split(SEP)
      for (const c of cables) {
        const { a, b } = c
        if (a && a.deviceName === pairedDev && a.name === pairedPort) {
          startCable = c; localEnd = a; farEnd = b; break
        }
        if (b && b.deviceName === pairedDev && b.name === pairedPort) {
          startCable = c; localEnd = b; farEnd = a; break
        }
      }
    }
  }

  if (!startCable || !localEnd) return null

  // Collect interfaces reachable from both directions
  const candidates: { dev: string; iface: string }[] = []

  // Walk toward farEnd
  const usedA = new Set<string>([startCable.id])
  const foundA = farEnd ? walkToInterface(cables, pairs, farEnd, usedA) : null
  if (foundA) candidates.push(foundA)

  // Walk through localEnd's pass-through (other direction)
  const pairedKey = pairs.get(`${localEnd.deviceName}${SEP}${localEnd.name}`)
  if (pairedKey) {
    const [pairedDev, pairedPort] = pairedKey.split(SEP)
    const usedB = new Set<string>([startCable.id])
    for (const c of cables) {
      if (c.id === startCable.id) continue
      const { a, b } = c
      let otherEnd: TraceCableEnd | null = null
      if (a && a.deviceName === pairedDev && a.name === pairedPort) {
        otherEnd = b
        usedB.add(c.id)
      } else if (b && b.deviceName === pairedDev && b.name === pairedPort) {
        otherEnd = a
        usedB.add(c.id)
      }
      if (otherEnd) {
        const foundB = walkToInterface(cables, pairs, otherEnd, usedB)
        if (foundB) candidates.push(foundB)
        break
      }
    }
  }

  if (candidates.length === 0) return null

  // ponytail: pick consistently by lex sort — same chain always anchors at same end
  candidates.sort((a, b) => a.dev.localeCompare(b.dev) || a.iface.localeCompare(b.iface))
  const anchor = candidates[0]!
  return buildCablePath(cables, pairs, anchor.dev, anchor.iface)
}
