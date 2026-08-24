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
