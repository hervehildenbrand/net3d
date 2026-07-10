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
 * Resolve an LLDP-reported hostname to a known device key. LLDP often reports
 * '<site>-<pod>-<name>.<domain>' while the SoT names the device just '<name>'
 * (prod: 'par1-cp01-lf1001.infra.eu.ginfra.net' vs NetBox 'lf1001'), so after
 * an exact short-name match, fall back to a '-<name>' suffix match.
 */
// ponytail: linear scan per neighbor; index the keys if sites grow past ~10k devices
function resolveRemote(hostname: string, locations: Record<string, RackLocation>): string {
  const s = short(hostname)
  if (locations[s]) return s
  for (const key in locations) if (s.endsWith(`-${key}`)) return key
  return s
}

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
        const remoteName = resolveRemote(n.hostname, deviceLocations)
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
