export interface LldpNeighbor {
  hostname: string
  port: string
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

export interface LldpMatch {
  cableId: string
  localInterface: string
  neighbor: string
  neighborPort: string
}

export interface LldpOnly {
  localInterface: string
  neighbor: string
  neighborPort: string
}

export interface CableOnly {
  cableId: string
  localInterface: string
  documentedNeighbor: string | null
}

export interface LldpDiffResult {
  matches: LldpMatch[]
  lldpOnly: LldpOnly[]
  cableOnly: CableOnly[]
}

/** Console/power runs never show up in LLDP — exclude from the audit. (mgmt ports DO speak LLDP.) */
const NON_LLDP_INTERFACE = /^(console|con\d|aux|power|psu)/i

const shortName = (h: string) => h.split('.')[0]!.toLowerCase()

/** Compare LLDP-discovered neighbors against NetBox-documented cables for one device. */
export function lldpDiff(
  lldp: Record<string, LldpNeighbor[]>,
  cables: CableLike[],
  deviceName: string,
): LldpDiffResult {
  const matches: LldpMatch[] = []
  const cableOnly: CableOnly[] = []
  const matchedLocalIfs = new Set<string>()

  for (const c of cables) {
    const local = [c.a, c.b].find((s) => s?.deviceName === deviceName)
    if (!local || NON_LLDP_INTERFACE.test(local.name)) continue
    const remote = c.a === local ? c.b : c.a
    const neighbors = lldp[local.name] ?? []
    const hit = remote?.deviceName
      ? neighbors.find((n) => shortName(n.hostname) === shortName(remote.deviceName!))
      : undefined
    if (hit) {
      matches.push({
        cableId: c.id,
        localInterface: local.name,
        neighbor: hit.hostname,
        neighborPort: hit.port,
      })
      matchedLocalIfs.add(local.name)
    } else {
      cableOnly.push({
        cableId: c.id,
        localInterface: local.name,
        // circuit ends have no device — fall back to the circuit id
        documentedNeighbor: remote?.deviceName ?? remote?.name ?? null,
      })
    }
  }

  const lldpOnly: LldpOnly[] = []
  for (const [localInterface, neighbors] of Object.entries(lldp)) {
    for (const n of neighbors) {
      const documented = matches.some(
        (m) => m.localInterface === localInterface && shortName(m.neighbor) === shortName(n.hostname),
      )
      if (!documented) {
        lldpOnly.push({ localInterface, neighbor: n.hostname, neighborPort: n.port })
      }
    }
  }

  return { matches, lldpOnly, cableOnly }
}
