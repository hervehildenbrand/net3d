/**
 * Pure helpers for splitting a map arc into its two directions.
 * No leaflet/DOM imports — vitest env is node.
 */

/** Split an arc's points at its middle point; both halves keep that point so they meet. */
export function splitArc<P>(points: P[]): { a: P[]; z: P[]; mid: P; midIndex: number; aLabel: P; zLabel: P } {
  const m = Math.floor(points.length / 2)
  return {
    a: points.slice(0, m + 1),
    z: points.slice(m),
    mid: points[m]!,
    midIndex: m,
    aLabel: points[Math.floor(m / 2)]!,
    zLabel: points[m + Math.floor((points.length - 1 - m) / 2)]!,
  }
}

/**
 * Indices of a half-arc's interior points in placement preference order: the half's middle first, then
 * alternating one step toward each end (closer to the arc midpoint first on ties), never the half's two end points.
 * @param from - inclusive start index of the half
 * @param to - inclusive end index of the half
 * @param midAt - which end is the arc's midpoint (from or to)
 */
export function halfCandidates(from: number, to: number, midAt: number): number[] {
  // Interior points only (exclude endpoints)
  const start = from + 1
  const end = to - 1
  if (start > end) return []

  const mid = Math.floor((start + end) / 2)
  const result: number[] = [mid]
  let lo = mid - 1
  let hi = mid + 1

  // Determine which direction is "toward midAt" to prefer on ties
  const preferLow = midAt === from

  while (lo >= start || hi <= end) {
    if (lo >= start && hi <= end) {
      // Both valid: prefer the one toward midAt
      if (preferLow) {
        result.push(lo--, hi++)
      } else {
        result.push(hi++, lo--)
      }
    } else if (lo >= start) {
      result.push(lo--)
    } else if (hi <= end) {
      result.push(hi++)
    }
  }
  return result
}

/** Screen angle in degrees (clockwise, as screen y grows downward) of the direction from `from` to `to`. */
export function screenAngleDeg(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
}

/**
 * Whether to draw arrowheads on an arc: only when the arc is long enough on screen
 * and its midpoint lies outside all site marker circles (avoids clutter in dense clusters).
 */
export function showArrows(
  a: { x: number; y: number },
  z: { x: number; y: number },
  mid: { x: number; y: number },
  sites: { x: number; y: number; r: number }[],
  minLenPx = 60,
): boolean {
  const dx = z.x - a.x
  const dy = z.y - a.y
  if (dx * dx + dy * dy < minLenPx * minLenPx) return false
  for (const s of sites) {
    const mx = mid.x - s.x
    const my = mid.y - s.y
    if (mx * mx + my * my < s.r * s.r) return false
  }
  return true
}

/**
 * Greedy thinning: keep points whose midpoints are at least minDistPx apart.
 * Priority descending; ties preserve original order.
 */
export function spreadPoints(
  points: { key: string; x: number; y: number; priority: number }[],
  minDistPx: number,
): Set<string> {
  const sorted = points
    .map((p, i) => ({ ...p, idx: i }))
    .sort((a, b) => b.priority - a.priority || a.idx - b.idx)
  const kept: { x: number; y: number }[] = []
  const result = new Set<string>()
  const d2 = minDistPx * minDistPx
  for (const p of sorted) {
    if (kept.some((k) => (p.x - k.x) ** 2 + (p.y - k.y) ** 2 < d2)) continue
    kept.push({ x: p.x, y: p.y })
    result.add(p.key)
  }
  return result
}
