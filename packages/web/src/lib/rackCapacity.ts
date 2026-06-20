import type { SiteDevice, SiteRack } from '../hooks/useSiteDetail'

export interface RackCapacity {
  /** Rack height in U. */
  totalU: number
  /** Distinct U slots occupied by at least one device. */
  usedU: number
  /** usedU / totalU, in [0, 1]; 0 for a zero-height rack. */
  fill: number
}

export interface EmptySlot {
  /** Lowest (1-based) U position of the free span. */
  start: number
  /** Contiguous free U count. */
  size: number
}

/**
 * The distinct U positions a rack's devices occupy. A device at U `position`
 * with height `uHeight` claims `position … position+uHeight-1`, clamped to the
 * rack. Devices with a null position (PDUs, child devices) claim nothing, and
 * front/rear devices sharing a U are unioned — so a U counts once however many
 * devices sit at it. This makes "used U" a true measure of rack-height taken.
 */
function occupiedSlots(rack: SiteRack): Set<number> {
  const used = new Set<number>()
  for (const d of rack.devices) {
    if (d.position == null) continue
    const top = Math.min(d.position + Math.max(d.uHeight, 1) - 1, rack.uHeight)
    for (let u = Math.max(d.position, 1); u <= top; u++) used.add(u)
  }
  return used
}

export function computeRackCapacity(rack: SiteRack): RackCapacity {
  const usedU = occupiedSlots(rack).size
  const totalU = rack.uHeight
  return { totalU, usedU, fill: totalU > 0 ? usedU / totalU : 0 }
}

/**
 * Contiguous runs of free U in the rack, largest first (ties by lowest start).
 * Answers "where does an N-U device fit?" — the first span with size ≥ N.
 */
export function findEmptySlots(rack: SiteRack): EmptySlot[] {
  const used = occupiedSlots(rack)
  const spans: EmptySlot[] = []
  let start: number | null = null
  for (let u = 1; u <= rack.uHeight; u++) {
    if (used.has(u)) {
      if (start != null) spans.push({ start, size: u - start })
      start = null
    } else if (start == null) {
      start = u
    }
  }
  if (start != null) spans.push({ start, size: rack.uHeight - start + 1 })
  return spans.sort((a, b) => b.size - a.size || a.start - b.start)
}
