import {
  computeBuildingBounds,
  computeRackLayout,
  type Bounds,
  type RackForLayout,
  type RackPlacement,
} from './layout'
import { rotatedFootprint } from './snap'

/** Bump when the persisted SiteLayout shape changes; old versions load as null. */
export const SITE_LAYOUT_VERSION = 1

export type Rotation = 0 | 90 | 180 | 270

/** A user-set position/rotation for one rack (meters, origin-centered). */
export interface RackOverride {
  rackId: string
  x: number
  z: number
  rotationDeg: Rotation
}

/** Axis-aligned room rectangle, center-based to match rack placements. */
export interface RoomRect {
  x: number
  z: number
  width: number
  depth: number
}

/** A named room/zone drawn on the floor. */
export interface LayoutRoom {
  id: string
  name: string
  bounds: RoomRect
  color?: string
}

/** Explicit floor size; when null, bounds are computed from racks + rooms. */
export interface FloorDimensions {
  width: number
  depth: number
}

/**
 * A persisted, user-edited floor plan for a site. Keyed by site name and
 * backend-agnostic — a site's physical footprint is the same whether the data
 * comes from NetBox or Infrahub.
 */
export interface SiteLayout {
  version: typeof SITE_LAYOUT_VERSION
  /** ISO timestamp, stamped server-side on save. */
  updatedAt: string
  /** Racks NOT listed here fall back to the auto-layout position. */
  racks: RackOverride[]
  rooms: LayoutRoom[]
  floor: FloorDimensions | null
}

/** Result of merging a SiteLayout onto the auto-computed layout. */
export interface AppliedLayout {
  placements: RackPlacement[]
  rooms: LayoutRoom[]
  bounds: Bounds
  /** Override entries whose rack no longer exists in the SoT. */
  orphanedRackIds: string[]
}

function boundsFromFloor(floor: FloorDimensions, placements: RackPlacement[]): Bounds {
  const hw = floor.width / 2
  const hd = floor.depth / 2
  // Keep a sane shell height even when a floor is saved for a site with no racks.
  const maxH = placements.reduce((m, p) => Math.max(m, p.height), 0)
  return { min: { x: -hw, y: 0, z: -hd }, max: { x: hw, y: Math.max(maxH + 1, 2), z: hd } }
}

/**
 * Validate an untrusted layout payload (the editable {racks, rooms, floor} shape)
 * before persisting or applying it. Returns an error string, or null if valid.
 * Shared by the server PUT handler and the client JSON-import path so both reject
 * the same malformed input (NaN/Infinity coordinates, bad rotation, etc.).
 */
export function validateLayoutInput(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'body must be an object'
  const b = body as Record<string, unknown>

  if (!Array.isArray(b.racks)) return 'racks must be an array'
  for (const r of b.racks) {
    if (typeof r !== 'object' || r === null) return 'each rack must be an object'
    const rk = r as Record<string, unknown>
    if (typeof rk.rackId !== 'string') return 'rack.rackId must be a string'
    if (!Number.isFinite(rk.x) || !Number.isFinite(rk.z)) return 'rack.x and rack.z must be finite numbers'
    if (![0, 90, 180, 270].includes(rk.rotationDeg as number)) return 'rack.rotationDeg must be 0/90/180/270'
  }

  if (!Array.isArray(b.rooms)) return 'rooms must be an array'
  for (const room of b.rooms) {
    if (typeof room !== 'object' || room === null) return 'each room must be an object'
    const rm = room as Record<string, unknown>
    if (typeof rm.id !== 'string' || typeof rm.name !== 'string') return 'room.id and room.name must be strings'
    if (typeof rm.bounds !== 'object' || rm.bounds === null) return 'room.bounds must be an object'
    const bd = rm.bounds as Record<string, unknown>
    if (!['x', 'z', 'width', 'depth'].every((k) => Number.isFinite(bd[k]))) {
      return 'room.bounds needs finite x/z/width/depth'
    }
    if ((bd.width as number) <= 0 || (bd.depth as number) <= 0) {
      return 'room.bounds width and depth must be positive'
    }
  }

  if (b.floor !== null && b.floor !== undefined) {
    if (typeof b.floor !== 'object') return 'floor must be an object or null'
    const f = b.floor as Record<string, unknown>
    if (!Number.isFinite(f.width) || (f.width as number) <= 0) return 'floor.width must be a positive number'
    if (!Number.isFinite(f.depth) || (f.depth as number) <= 0) return 'floor.depth must be a positive number'
  }

  return null
}

function expandBoundsForRooms(bounds: Bounds, rooms: LayoutRoom[]): Bounds {
  const out: Bounds = {
    min: { ...bounds.min },
    max: { ...bounds.max },
  }
  for (const room of rooms) {
    const { x, z, width, depth } = room.bounds
    out.min.x = Math.min(out.min.x, x - width / 2)
    out.max.x = Math.max(out.max.x, x + width / 2)
    out.min.z = Math.min(out.min.z, z - depth / 2)
    out.max.z = Math.max(out.max.z, z + depth / 2)
  }
  return out
}

/**
 * Merge a persisted SiteLayout onto the schematic auto-layout. Racks listed in
 * the layout get their saved position/rotation (footprint swapped for 90/270);
 * every other rack keeps its auto position. A null layout yields the unchanged
 * auto-layout, so behavior is identical until a site is edited.
 */
export function applyLayoutOverrides(
  racks: RackForLayout[],
  layout: SiteLayout | null,
): AppliedLayout {
  const auto = computeRackLayout(racks)
  if (!layout) {
    return { placements: auto, rooms: [], bounds: computeBuildingBounds(auto), orphanedRackIds: [] }
  }

  const overrides = new Map(layout.racks.map((o) => [o.rackId, o]))
  const placements: RackPlacement[] = auto.map((p) => {
    const o = overrides.get(p.rackId)
    if (!o) return p
    const fp = rotatedFootprint(p.width, p.depth, o.rotationDeg)
    return { ...p, x: o.x, z: o.z, rotationDeg: o.rotationDeg, width: fp.width, depth: fp.depth }
  })

  const liveIds = new Set(racks.map((r) => r.id))
  const orphanedRackIds = layout.racks.filter((o) => !liveIds.has(o.rackId)).map((o) => o.rackId)

  const bounds = layout.floor
    ? boundsFromFloor(layout.floor, placements)
    : expandBoundsForRooms(computeBuildingBounds(placements), layout.rooms)

  return { placements, rooms: layout.rooms, bounds, orphanedRackIds }
}
