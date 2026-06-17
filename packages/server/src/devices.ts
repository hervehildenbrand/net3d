import type { SiteDetail } from './prewarm'

/**
 * A single searchable device, flattened out of its rack and tagged with its
 * location. Carries just enough to drive the search dropdown (name + context)
 * and the staged navigation that frames it (siteName → rackId → device id).
 */
export interface DeviceIndexEntry {
  id: string
  name: string
  siteName: string
  rackId: string
  rackName: string
  /** U position; null for unracked/child/0U devices (still findable). */
  position: number | null
  roleName: string
  roleColor: string
  model: string
  status: string
}

/**
 * Flatten cached per-site details into one global device index.
 *
 * Backend-agnostic by construction: it consumes the normalized
 * SiteRack[]/SiteDevice shapes that both the NetBox and Infrahub adapters
 * produce, so the same index pipeline serves either backend. Order is
 * preserved (insertion order of the map, then rack, then device); the frontend
 * ranks results.
 */
export function buildDeviceIndex(details: Map<string, SiteDetail>): DeviceIndexEntry[] {
  const index: DeviceIndexEntry[] = []
  for (const [siteName, detail] of details) {
    for (const rack of detail.racks) {
      for (const d of rack.devices) {
        index.push({
          id: d.id,
          name: d.name,
          siteName,
          rackId: rack.id,
          rackName: rack.name,
          position: d.position,
          roleName: d.roleName,
          roleColor: d.roleColor,
          model: d.model,
          status: d.status,
        })
      }
    }
  }
  return index
}
