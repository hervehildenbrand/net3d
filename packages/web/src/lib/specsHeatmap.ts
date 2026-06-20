import type { DeviceSpecs, SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'

/** Numeric hardware-capacity metrics that can drive the heatmap (cpuModel is excluded — it's text). */
export type SpecMetric = 'cpuCores' | 'ramGb' | 'storageTb' | 'powerDrawW'

/** Canonical metric order, used by the legend selector and availableMetrics. */
const METRIC_ORDER: SpecMetric[] = ['cpuCores', 'ramGb', 'storageTb', 'powerDrawW']

export interface SpecsRange {
  min: number
  max: number
}

function metricValue(specs: DeviceSpecs | undefined, metric: SpecMetric): number | undefined {
  const v = specs?.[metric]
  return typeof v === 'number' ? v : undefined
}

/**
 * Metrics that at least one device populates, in canonical order. The legend hides
 * the rest, since many device types carry no specs at all.
 */
export function availableMetrics(racks: SiteRack[]): SpecMetric[] {
  return METRIC_ORDER.filter((metric) =>
    racks.some((r) => r.devices.some((d) => metricValue(d.specs, metric) !== undefined)),
  )
}

/** Min/max of a metric across every device that has it; {0,0} when none do. */
export function computeSpecsRange(racks: SiteRack[], metric: SpecMetric): SpecsRange {
  let min = Infinity
  let max = -Infinity
  for (const r of racks) {
    for (const d of r.devices) {
      const v = metricValue(d.specs, metric)
      if (v === undefined) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return min === Infinity ? { min: 0, max: 0 } : { min, max }
}

/** Per-channel linear blend between two '#rrggbb' colors; exact at frac 0 and 1. */
function hexLerp(a: string, b: string, frac: number): string {
  const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  const ch = ca.map((v, i) => Math.round(v + (cb[i]! - v) * frac))
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/**
 * Heatmap color for a value within [min,max]. undefined -> no-data slate. A flat
 * range (min === max, every device equal) reads as the mid stop, not a misleading
 * low/high extreme. The two-segment ramp lands exactly on low/mid/high at t=0/0.5/1.
 */
export function specsColor(value: number | undefined, min: number, max: number): string {
  if (value === undefined) return theme.heatmap.noData
  const t = max > min ? (value - min) / (max - min) : 0.5
  if (t <= 0.5) return hexLerp(theme.heatmap.low, theme.heatmap.mid, t / 0.5)
  return hexLerp(theme.heatmap.mid, theme.heatmap.high, (t - 0.5) / 0.5)
}

/** A rack's metric value rolled up across its devices; undefined when none carry it. */
export function rackAggregate(
  rack: SiteRack,
  metric: SpecMetric,
  mode: 'max' | 'mean' = 'max',
): number | undefined {
  const vals: number[] = []
  for (const d of rack.devices) {
    const v = metricValue(d.specs, metric)
    if (v !== undefined) vals.push(v)
  }
  if (vals.length === 0) return undefined
  if (mode === 'mean') return vals.reduce((s, v) => s + v, 0) / vals.length
  return Math.max(...vals)
}
