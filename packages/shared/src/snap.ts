/** Axis-aligned XZ rectangle in meters (floor-plane footprint). */
export interface RectXZ {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Snap a value to the nearest grid line; a pitch <= 0 disables snapping. */
export function snapToGrid(value: number, gridPitch: number): number {
  if (gridPitch <= 0) return value
  return Math.round(value / gridPitch) * gridPitch
}

/** Snap an XZ point to the grid. */
export function snapPointToGrid(x: number, z: number, gridPitch: number): { x: number; z: number } {
  return { x: snapToGrid(x, gridPitch), z: snapToGrid(z, gridPitch) }
}

/**
 * Effective footprint after a yaw rotation. 0/180 keep width x depth;
 * 90/270 swap them. Angle is normalized to [0, 360).
 */
export function rotatedFootprint(
  width: number,
  depth: number,
  rotationDeg: number,
): { width: number; depth: number } {
  const norm = ((rotationDeg % 360) + 360) % 360
  return norm === 90 || norm === 270 ? { width: depth, depth: width } : { width, depth }
}

/** Clamp an XZ center so the (rotation-aware) footprint stays inside bounds. */
export function clampToBounds(
  x: number,
  z: number,
  width: number,
  depth: number,
  rotationDeg: number,
  bounds: RectXZ,
): { x: number; z: number } {
  const fp = rotatedFootprint(width, depth, rotationDeg)
  const halfW = fp.width / 2
  const halfD = fp.depth / 2
  return {
    x: Math.max(bounds.minX + halfW, Math.min(bounds.maxX - halfW, x)),
    z: Math.max(bounds.minZ + halfD, Math.min(bounds.maxZ - halfD, z)),
  }
}
