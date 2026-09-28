/**
 * Pure helpers for splitting a map arc into its two directions.
 * No leaflet/DOM imports — vitest env is node.
 */

/** Split an arc's points at its middle point; both halves keep that point so they meet. */
export function splitArc<P>(points: P[]): { a: P[]; z: P[]; mid: P; aLabel: P; zLabel: P } {
  const m = Math.floor(points.length / 2)
  return {
    a: points.slice(0, m + 1),
    z: points.slice(m),
    mid: points[m]!,
    aLabel: points[Math.floor(m / 2)]!,
    zLabel: points[m + Math.floor((points.length - 1 - m) / 2)]!,
  }
}

/** Screen angle in degrees (clockwise, as screen y grows downward) of the direction from `from` to `to`. */
export function screenAngleDeg(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
}
