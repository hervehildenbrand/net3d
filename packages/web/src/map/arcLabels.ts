/**
 * Pure label-placement helpers for map arc Gbps labels.
 * No leaflet/DOM imports — vitest env is node.
 */

/** Approximate width of monospace 11px text: ~6.6px per char + 4px padding each side. */
const CHAR_WIDTH = 6.6
const PADDING_X = 4
const LABEL_HEIGHT = 16

export interface LabelBox {
  key: string
  x: number
  y: number
  w: number
  h: number
  priority: number
}

/** Create a bounding box for a label at (x, y) with monospace 11px estimate. */
export function labelBox(key: string, text: string, x: number, y: number, priority = 0): LabelBox {
  const w = text.length * CHAR_WIDTH + PADDING_X * 2
  return { key, x, y, w, h: LABEL_HEIGHT, priority }
}

/** Do two axis-aligned boxes overlap? */
function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * Greedy de-overlap: sort boxes by priority descending, keep a box iff it overlaps no kept box.
 * Returns the set of kept keys.
 */
export function placeLabels(boxes: LabelBox[]): Set<string> {
  const sorted = [...boxes].sort((a, b) => b.priority - a.priority)
  const kept: LabelBox[] = []
  const result = new Set<string>()

  for (const box of sorted) {
    if (kept.every((k) => !overlaps(box, k))) {
      kept.push(box)
      result.add(box.key)
    }
  }

  return result
}
