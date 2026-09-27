import { formatBps, type CableLive, type LiveIface } from '@net3d/shared'
import { theme } from '../theme'
import { specsColor } from './specsHeatmap'

/**
 * Log10-based utilisation transform: maps [0.01, 100] to [0, 1] with 1% at midpoint.
 * 0 → 0 (before log), clipped to [0, 1].
 */
export const utilT = (pct: number): number => {
  if (pct <= 0) return 0
  return Math.max(0, Math.min(1, (Math.log10(pct) + 2) / 4))
}

/** Utilisation heatmap color via log scale; anchors: 0.01% → low, 1% → mid, 100% → high. */
export const utilColor = (pct: number): string => specsColor(utilT(pct), 0, 1)

/**
 * Format a percentage for display: no trailing zeros, precision by magnitude.
 * 0 → '0', <0.01 → '<0.01', <1 → 2 decimals, <10 → 1 decimal, else integer.
 */
export function formatPct(pct: number): string {
  if (pct === 0) return '0'
  if (pct < 0.005) return '<0.01'
  if (pct < 0.995) return pct.toFixed(2)
  if (pct < 9.95) return pct.toFixed(1)
  return String(Math.round(pct))
}

/** A single cable's live color: stale telemetry greys out, no pct falls back to the static "up" green. */
export function liveColor(c: CableLive): string {
  if (c.stale) return theme.heatmap.noData
  if (c.pct === null) return theme.cable.up
  return utilColor(c.pct)
}

/**
 * A bundle's color from its member cables' live state: the busiest member wins so a hot
 * link in a bundle still reads as hot. null when no member has any telemetry (render as today).
 */
export function bundleColor(ids: string[], live: Map<string, CableLive>): string | null {
  const members = ids.map((id) => live.get(id)).filter((m): m is CableLive => !!m)
  if (members.length === 0) return null

  const pcts = members.map((m) => m.pct).filter((p): p is number => p !== null)
  if (pcts.length > 0) return utilColor(Math.max(...pcts))
  if (members.every((m) => m.stale)) return theme.heatmap.noData
  return theme.cable.up
}

/** One interface's live label/color, from the device's own perspective (rx = traffic into this port). */
export function ifaceLive(t: LiveIface | undefined): { text: string; color: string } | null {
  if (!t) return null
  if (t.stale) return { text: 'stale', color: theme.heatmap.noData }
  if (t.rxBps === null && t.txBps === null) return null

  const rx = t.rxBps ?? 0
  const tx = t.txBps ?? 0
  const text = `↓${formatBps(rx)} ↑${formatBps(tx)}`
  if (!t.capacityBps) return { text, color: theme.cable.up }

  const pct = (Math.max(rx, tx) * 100) / t.capacityBps
  return { text: `${text} ${formatPct(pct)}%`, color: utilColor(pct) }
}

/**
 * A group (LAG / bundle) of cables' live state: busiest color + sum of non-stale bps.
 * Returns null when no member is in the live map.
 */
export function groupLive(ids: string[], live: Map<string, CableLive>): { color: string; bps: number | null } | null {
  const color = bundleColor(ids, live)
  if (color === null) return null

  let bps: number | null = null
  for (const id of ids) {
    const m = live.get(id)
    if (m && !m.stale && m.bps !== null) {
      bps = (bps ?? 0) + m.bps
    }
  }
  return { color, bps }
}
