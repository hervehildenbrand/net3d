/**
 * Pure label-placement helpers for map arc Gbps labels.
 * No leaflet/DOM imports — vitest env is node.
 */

/**
 * Approximate width of system-ui 11px text: ~5.8px per char average.
 * Badge: 6px padding + 2px border + 2px margin each side.
 */
const CHAR_WIDTH = 5.8
const PADDING_X = 6
const BORDER = 2
const MARGIN = 4 // breathing room for sub-pixel rendering
const LABEL_HEIGHT = 18 + BORDER * 2 + MARGIN * 2 // pill + border + margin

export interface LabelBox {
  key: string
  x: number // top-left x (center-anchored: computed from input cx)
  y: number // top-left y (center-anchored: computed from input cy)
  w: number
  h: number
  priority: number
}

/** A label that may sit at any of several candidate boxes, tried in order. */
export interface SlidingLabel {
  key: string
  priority: number
  candidates: LabelBox[] // same key/priority on every candidate; x/y = top-left
}

/**
 * Create a bounding box for a label centred at (cx, cy).
 * Returns top-left coords so the box centre is at the input point.
 * Includes border + margin so de-overlap keeps labels visually separated.
 */
export function labelBox(key: string, text: string, cx: number, cy: number, priority = 0): LabelBox {
  const w = text.length * CHAR_WIDTH + (PADDING_X + BORDER + MARGIN) * 2
  const h = LABEL_HEIGHT
  return { key, x: cx - w / 2, y: cy - h / 2, w, h, priority }
}

/** sRGB relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const lr = r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4
  const lg = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4
  const lb = b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

/** WCAG contrast ratio between two #rrggbb colors. */
export function wcagContrast(bg: string, fg: string): number {
  const l1 = luminance(bg)
  const l2 = luminance(fg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const TEXT_DARK = '#000000' // pure black for max contrast on bright mid-tones
const TEXT_LIGHT = '#ffffff'

/**
 * Pick text color that meets WCAG AA (>= 4.5:1) against the background.
 * Returns whichever of white or black yields the higher contrast.
 */
export function contrastText(hex: string): '#000000' | '#ffffff' {
  const darkRatio = wcagContrast(hex, TEXT_DARK)
  const lightRatio = wcagContrast(hex, TEXT_LIGHT)
  return lightRatio >= darkRatio ? TEXT_LIGHT : TEXT_DARK
}

/** Do two axis-aligned boxes overlap? */
function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export interface MarkerCircle {
  x: number
  y: number
  r: number
}

/** Does a box overlap a circular marker? (box-vs-circle AABB check) */
function hitsMarker(box: LabelBox, m: MarkerCircle): boolean {
  // Closest point on box to circle center
  const cx = Math.max(box.x, Math.min(m.x, box.x + box.w))
  const cy = Math.max(box.y, Math.min(m.y, box.y + box.h))
  const dx = m.x - cx
  const dy = m.y - cy
  return dx * dx + dy * dy < m.r * m.r
}

/**
 * Greedy placement, busiest first (stable for ties): each label takes its FIRST candidate that overlaps no site
 * marker and no already-placed label; labels with no free candidate are dropped.
 * Returns key -> index of the chosen candidate.
 */
export function placeSlidingLabels(labels: SlidingLabel[], markers: MarkerCircle[] = []): Map<string, number> {
  const sorted = labels
    .map((l, i) => ({ ...l, idx: i }))
    .sort((a, b) => b.priority - a.priority || a.idx - b.idx)
  const kept: LabelBox[] = []
  const result = new Map<string, number>()

  for (const label of sorted) {
    for (let i = 0; i < label.candidates.length; i++) {
      const box = label.candidates[i]!
      if (markers.some((m) => hitsMarker(box, m))) continue
      if (kept.some((k) => overlaps(box, k))) continue
      kept.push(box)
      result.set(label.key, i)
      break
    }
  }

  return result
}
