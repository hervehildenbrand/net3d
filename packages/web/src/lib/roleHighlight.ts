import { deviceTransform, type RackPlacement } from '@net3d/shared'
import type { SiteDevice, SiteRack } from '../hooks/useSiteDetail'

/** How far the belt extends past each rack face (m) so it stays visible on every side. */
const MARKER_INFLATE = 0.05

export interface SiteRoleSummary {
  name: string
  /** NetBox role color, 6-hex WITHOUT a leading '#'. */
  color: string
  /** Placeable (rack-mounted) devices with this role across the site. */
  count: number
}

export interface RoleMarker {
  position: [number, number, number]
  scale: [number, number, number]
  /** '#'-prefixed CSS color. */
  color: string
}

/** A device that can actually be marked: it has a real U-position. */
function isPlaceable(d: SiteDevice): boolean {
  return d.position != null
}

/**
 * Unique device roles across the site, counting only placeable (rack-mounted)
 * devices — a role with no placeable device can't be marked, so it is omitted.
 * Sorted: the 'unknown' bucket last, then by count desc, then name asc.
 */
export function collectSiteRoles(racks: SiteRack[]): SiteRoleSummary[] {
  const byName = new Map<string, SiteRoleSummary>()
  for (const rack of racks) {
    for (const d of rack.devices) {
      if (!isPlaceable(d)) continue
      const existing = byName.get(d.roleName)
      if (existing) existing.count += 1
      else byName.set(d.roleName, { name: d.roleName, color: d.roleColor, count: 1 })
    }
  }
  return [...byName.values()].sort((a, b) => {
    const au = a.name === 'unknown' ? 1 : 0
    const bu = b.name === 'unknown' ? 1 : 0
    if (au !== bu) return au - bu
    if (a.count !== b.count) return b.count - a.count
    return a.name.localeCompare(b.name)
  })
}

/**
 * Rack ids holding at least one placeable device whose role is highlighted.
 * "Matched" === "shows >=1 marker", keeping rack dimming coherent with markers.
 */
export function racksWithRole(racks: SiteRack[], highlighted: Set<string>): Set<string> {
  const matched = new Set<string>()
  if (highlighted.size === 0) return matched
  for (const rack of racks) {
    for (const d of rack.devices) {
      if (isPlaceable(d) && highlighted.has(d.roleName)) {
        matched.add(rack.id)
        break
      }
    }
  }
  return matched
}

/**
 * One marker per highlighted, placeable device: a thin belt wrapping the whole
 * rack at the device's real U-position, inflated past every face so it reads from
 * any orbit angle (not just the front). Reuses deviceTransform for the U-math
 * (y center + height) so markers track the same U_METERS source as the rack view.
 */
export function buildRoleMarkers(
  racks: SiteRack[],
  placements: RackPlacement[],
  highlighted: Set<string>,
): RoleMarker[] {
  if (highlighted.size === 0) return []
  const racksById = new Map(racks.map((r) => [r.id, r]))
  const markers: RoleMarker[] = []
  for (const p of placements) {
    const rack = racksById.get(p.rackId)
    if (!rack) continue
    for (const d of rack.devices) {
      if (!highlighted.has(d.roleName)) continue
      const box = deviceTransform(p, d) // null when position is null -> unplaceable
      if (!box) continue
      markers.push({
        // belt centered on the rack at the device's U-height, inflated past every
        // face so the band is visible from any side, not only the front.
        position: [box.x, box.y, p.z],
        scale: [p.width + MARKER_INFLATE, box.h, p.depth + MARKER_INFLATE],
        color: `#${d.roleColor}`,
      })
    }
  }
  return markers
}
