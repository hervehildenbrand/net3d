import type { LldpNeighbor } from './lldp'

export interface RackLocation {
  rackId: string
  rackName: string
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

export type LldpScope = 'intra-rack' | 'inter-rack' | 'external'

export interface LldpCableSegment {
  id: string
  localDeviceName: string
  localInterface: string
  remoteDeviceName: string
  remoteInterface: string
  localRackId: string
  remoteRackId: string | null
  scope: LldpScope
}

const short = (h: string) => h.split('.')[0]!.toLowerCase()

/**
 * Convert per-device LLDP answers into drawable cable segments:
 * - links already documented as NetBox cables are suppressed,
 * - the same physical link reported from both ends collapses to one segment,
 * - scope tells the renderer where the segment belongs.
 */
export function lldpToSegments(
  lldpByDevice: Record<string, Record<string, LldpNeighbor[]>>,
  deviceLocations: Record<string, RackLocation>,
  documentedCables: CableLike[],
): LldpCableSegment[] {
  // documented links indexed by (device|interface) of either side
  const documented = new Set<string>()
  for (const c of documentedCables) {
    if (c.a?.deviceName) documented.add(`${short(c.a.deviceName)}|${c.a.name}`)
    if (c.b?.deviceName) documented.add(`${short(c.b.deviceName)}|${c.b.name}`)
  }

  const segments: LldpCableSegment[] = []
  const seenLinks = new Set<string>()

  for (const [localDeviceName, byInterface] of Object.entries(lldpByDevice)) {
    const localLoc = deviceLocations[short(localDeviceName)]
    if (!localLoc) continue
    for (const [localInterface, neighbors] of Object.entries(byInterface)) {
      for (const n of neighbors) {
        const remoteName = short(n.hostname)
        if (documented.has(`${short(localDeviceName)}|${localInterface}`)) continue

        // canonical key so A→B and B→A collapse into one link
        const endA = `${short(localDeviceName)}|${localInterface}`
        const endB = `${remoteName}|${n.port}`
        const linkKey = [endA, endB].sort().join('~')
        if (seenLinks.has(linkKey)) continue
        seenLinks.add(linkKey)

        const remoteLoc = deviceLocations[remoteName] ?? null
        const scope: LldpScope = !remoteLoc
          ? 'external'
          : remoteLoc.rackId === localLoc.rackId
            ? 'intra-rack'
            : 'inter-rack'

        segments.push({
          id: `lldp:${short(localDeviceName)}:${localInterface}`,
          localDeviceName: short(localDeviceName),
          localInterface,
          remoteDeviceName: remoteName,
          remoteInterface: n.port,
          localRackId: localLoc.rackId,
          remoteRackId: remoteLoc?.rackId ?? null,
          scope,
        })
      }
    }
  }
  return segments
}
