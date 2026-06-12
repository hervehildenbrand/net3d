import type { Vec3 } from './types'

/** 1 rack unit in meters. */
export const U_METERS = 0.0445
export const RACK_WIDTH_M = 0.6
export const RACK_DEPTH_M = 1.2
const RACK_GAP_M = 0.15
const AISLE_M = 1.8
const BUILDING_PADDING_M = 2

export interface RackForLayout {
  id: string
  name: string
  uHeight: number
  location: string | null
}

export interface RackPlacement {
  rackId: string
  name: string
  location: string | null
  x: number
  z: number
  width: number
  depth: number
  height: number
}

export interface Bounds {
  min: Vec3
  max: Vec3
}

/** Compare strings treating embedded digit runs as numbers ("R2" < "R10"). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * NetBox has no rack coordinates — generate a schematic floor plan:
 * one row per location, racks in natural name order, centered on the origin.
 */
export function computeRackLayout(racks: RackForLayout[]): RackPlacement[] {
  const byLocation = new Map<string, RackForLayout[]>()
  for (const r of racks) {
    const key = r.location ?? ''
    if (!byLocation.has(key)) byLocation.set(key, [])
    byLocation.get(key)!.push(r)
  }

  const locations = [...byLocation.keys()].sort(naturalCompare)
  const placements: RackPlacement[] = []
  const pitch = RACK_WIDTH_M + RACK_GAP_M

  locations.forEach((loc, row) => {
    const rowRacks = byLocation.get(loc)!.sort((a, b) => naturalCompare(a.name, b.name))
    const rowWidth = rowRacks.length * pitch - RACK_GAP_M
    rowRacks.forEach((r, i) => {
      placements.push({
        rackId: r.id,
        name: r.name,
        location: r.location,
        x: i * pitch + RACK_WIDTH_M / 2 - rowWidth / 2, // center each row on x=0
        z: row * (RACK_DEPTH_M + AISLE_M),
        width: RACK_WIDTH_M,
        depth: RACK_DEPTH_M,
        height: r.uHeight * U_METERS,
      })
    })
  })

  // center rows on z=0
  if (placements.length > 0) {
    const minZ = Math.min(...placements.map((p) => p.z))
    const maxZ = Math.max(...placements.map((p) => p.z))
    const zShift = (minZ + maxZ) / 2
    for (const p of placements) p.z -= zShift
  }

  return placements
}

export function computeBuildingBounds(placements: RackPlacement[]): Bounds {
  if (placements.length === 0) {
    return { min: { x: -3, y: 0, z: -3 }, max: { x: 3, y: 3, z: 3 } }
  }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let maxH = 0
  for (const p of placements) {
    minX = Math.min(minX, p.x - p.width / 2)
    maxX = Math.max(maxX, p.x + p.width / 2)
    minZ = Math.min(minZ, p.z - p.depth / 2)
    maxZ = Math.max(maxZ, p.z + p.depth / 2)
    maxH = Math.max(maxH, p.height)
  }
  return {
    min: { x: minX - BUILDING_PADDING_M, y: 0, z: minZ - BUILDING_PADDING_M },
    max: { x: maxX + BUILDING_PADDING_M, y: maxH + 1, z: maxZ + BUILDING_PADDING_M },
  }
}
