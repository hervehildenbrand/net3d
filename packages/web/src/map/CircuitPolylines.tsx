import { Fragment, useMemo, useState } from 'react'
import { Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { divIcon } from 'leaflet'
import {
  formatBps,
  formatCommitRate,
  type CircuitGroup,
  type CircuitLive,
} from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { theme } from '../theme'
import { dirLive, formatPct, type DirGroup } from '../lib/liveTelemetry'
import { labelBox, placeSlidingLabels, contrastText, circlesClearOfBoxes, MARKER_RADIUS, type LabelBox, type MarkerCircle, type SlidingLabel, type ObstacleBox } from './arcLabels'
import { halfCandidates, screenAngleDeg, showArrows, splitArc, spreadPoints } from './arcHalves'
import { circuitLines, type ArcLine, type LatLng } from './arcLines'

/** Empty obstacles array - shared constant for physical mode */
const NO_BOXES: ObstacleBox[] = []

/** Both directions of a link, or null when none of its circuits has telemetry (draw it as today). */
function lineDirs(l: ArcLine, live: Map<string, CircuitLive>): { a: DirGroup; z: DirGroup } | null {
  const a = dirLive(l.cids, live, l.siteA)
  const z = dirLive(l.cids, live, l.siteZ)
  return a && z ? { a, z } : null
}

/** Screen radius kept clear around the arrowheads at an arc's midpoint. */
const ARROW_RADIUS = 9
/** Minimum distance between kept arrow pairs; two arrowheads are ~20 px tip to tail. */
const ARROW_SPACING = 22

/** Rate pill; background and text colour are appended per label. */
const PILL_STYLE =
  "display:inline-flex;width:max-content;transform:translate(-50%,-50%);font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:11px;font-variant-numeric:tabular-nums;padding:2px 6px;border-radius:9px;border:2px solid rgba(255,255,255,0.95);box-shadow:0 0 0 1px rgba(0,0,0,0.08);white-space:nowrap;line-height:1.2"

/** Arrowhead whose tip sits on the marker point, rotated to `angle` (degrees, screen space). */
const arrowHtml = (color: string, angle: number) =>
  `<svg width="14" height="12" viewBox="-12 -6 14 12" style="position:absolute;left:-12px;top:-6px;overflow:visible;transform-origin:12px 6px;transform:rotate(${angle}deg)"><path d="M0,0 L-10,-5 L-10,5 Z" fill="${color}" stroke="rgba(255,255,255,0.95)" stroke-width="1.5" stroke-linejoin="round"/></svg>`

interface Arrow {
  key: string
  at: LatLng
  angle: number
  color: string
}

type Bead = { key: string; bps: number; color: string; at: LatLng }

/** Per-direction arrowheads and rate beads for live links; beads de-overlapped on zoom/move. */
function ArcLabels({
  lines,
  live,
  sites,
  circles: circlesProp,
  boxes: boxesProp,
}: {
  lines: ArcLine[]
  live: Map<string, CircuitLive>
  sites: Site[]
  circles?: { at: LatLng; r: number }[]
  boxes?: ObstacleBox[]
}) {
  const map = useMap()
  const [tick, setTick] = useState(0)
  useMapEvents({
    zoomend: () => setTick((t) => t + 1),
    moveend: () => setTick((t) => t + 1),
  })

  const { arrows, beads } = useMemo(() => {
    void tick // recompute screen positions after every zoom/move
    const px = (p: LatLng) => map.latLngToContainerPoint(p)

    // Use provided circles, or compute from sites
    const markers: MarkerCircle[] = circlesProp
      ? circlesProp.map((c) => {
          const pt = px(c.at)
          return { x: pt.x, y: pt.y, r: c.r }
        })
      : sites
          .filter((s) => s.latitude !== null)
          .map((s) => {
            const pt = px([s.latitude!, s.longitude!])
            return { x: pt.x, y: pt.y, r: MARKER_RADIUS }
          })

    // Convert boxes prop to LabelBox format for blocking
    const blocked: LabelBox[] = boxesProp
      ? boxesProp.map((b, i) => {
          const pt = px(b.at)
          return { key: `box-${i}`, x: pt.x + b.dx, y: pt.y + b.dy, w: b.w, h: b.h, priority: 0 }
        })
      : []

    const arrows: Arrow[] = []
    const slidingLabels: (SlidingLabel & { bps: number; color: string; positions: LatLng[] })[] = []
    // site circles for showArrows check (only MARKER_RADIUS site markers, not arrow avoid-circles)
    const siteCircles = markers.slice()

    // Pass 1: collect arrow candidates
    type ArrowCandidate = {
      key: string
      x: number
      y: number
      priority: number
      arrowA: Arrow
      arrowZ: Arrow
      mid: LatLng
    }
    const arrowCandidates: ArrowCandidate[] = []

    for (const l of lines) {
      const dirs = lineDirs(l, live)
      if (!dirs) continue
      const { a, z, mid, midIndex } = l.halves
      const m = px(mid)
      const aPx = px(a[0]!)
      const zPx = px(z.at(-1)!)
      // only consider arrowheads when arc is long enough and midpoint is clear of site markers
      if (showArrows(aPx, zPx, m, siteCircles)) {
        arrowCandidates.push({
          key: l.key,
          x: m.x,
          y: m.y,
          priority: (dirs.a.bps ?? 0) + (dirs.z.bps ?? 0),
          arrowA: { key: `${l.key}>${l.siteZ}`, at: mid, angle: screenAngleDeg(px(a[a.length - 2] ?? a[0]!), m), color: dirs.a.color },
          arrowZ: { key: `${l.key}>${l.siteA}`, at: mid, angle: screenAngleDeg(px(z[1] ?? z[0]!), m), color: dirs.z.color },
          mid,
        })
      }

      // Build sliding labels for each direction
      const text = (bps: number) => formatBps(bps)
      for (const [d, halfFrom, halfTo, site] of [
        [dirs.a, 0, midIndex, l.siteA],
        [dirs.z, midIndex, l.positions.length - 1, l.siteZ],
      ] as const) {
        if (d.bps === null) continue
        const key = `${l.key}@${site}`
        const indices = halfCandidates(halfFrom, halfTo, midIndex)
        const candidates: LabelBox[] = indices.map((i) => {
          const p = px(l.positions[i]!)
          return labelBox(key, text(d.bps!), p.x, p.y, d.bps!)
        })
        if (candidates.length > 0) {
          slidingLabels.push({ key, priority: d.bps, candidates, bps: d.bps, color: d.color, positions: indices.map((i) => l.positions[i]!) })
        }
      }
    }

    // Pass 2: place beads FIRST using only site circles + blocked boxes (beads have priority)
    const placed = placeSlidingLabels(slidingLabels, siteCircles, blocked)
    const beads: Bead[] = []
    const placedBoxes: LabelBox[] = []
    for (const sl of slidingLabels) {
      const idx = placed.get(sl.key)
      if (idx === undefined) continue
      beads.push({ key: sl.key, bps: sl.bps, color: sl.color, at: sl.positions[idx]! })
      placedBoxes.push(sl.candidates[idx]!)
    }

    // Pass 3: thin arrow pairs, then drop any that overlap a placed bead
    const keptArrows = spreadPoints(arrowCandidates, ARROW_SPACING)
    const arrowCircles = arrowCandidates
      .filter((c) => keptArrows.has(c.key))
      .map((c) => ({ key: c.key, x: c.x, y: c.y, r: ARROW_RADIUS }))
    const clearArrowKeys = circlesClearOfBoxes(arrowCircles, [...placedBoxes, ...blocked])
    for (const c of arrowCandidates) {
      if (!clearArrowKeys.has(c.key)) continue
      arrows.push(c.arrowA, c.arrowZ)
    }

    return { arrows, beads }
  }, [tick, lines, live, map, sites, circlesProp, boxesProp])

  return (
    <Pane name="arcLabels" style={{ zIndex: 400 }}>
      {arrows.map((a) => (
        <Marker
          key={a.key}
          position={a.at}
          pane="arcLabels"
          interactive={false}
          icon={divIcon({ className: '', iconSize: [0, 0], html: arrowHtml(a.color, a.angle) })}
        />
      ))}
      {beads.map((b) => {
        const [value, unit] = formatBps(b.bps).split(' ')
        return (
          <Marker
            key={b.key}
            position={b.at}
            pane="arcLabels"
            interactive={false}
            icon={divIcon({
              className: '',
              iconSize: [0, 0],
              html: `<div style="${PILL_STYLE};color:${contrastText(b.color)};background:${b.color}"><span style="font-weight:600">${value}</span><span style="font-weight:400;margin-left:2px">${unit}</span></div>`,
            })}
          />
        )
      })}
    </Pane>
  )
}

/** One tooltip line per direction: `FROM → TO  rate · pct%`. */
function DirLine({ from, to, d }: { from: string; to: string; d: DirGroup }) {
  if (d.bps === null) return null
  return (
    <div style={{ color: theme.text.secondary }}>
      {from} → {to} {formatBps(d.bps)}
      {d.pct !== null && ` · ${formatPct(d.pct)}%`}
    </div>
  )
}

function ArcTooltip({ line: l, live, dirs }: { line: ArcLine; live: Map<string, CircuitLive> | undefined; dirs: { a: DirGroup; z: DirGroup } | null }) {
  // Logical lines (key contains ~) need tooltipPane to render above rate beads (arcLabels pane z400)
  const isLogical = l.key.includes('~')
  return (
    <Tooltip sticky pane={isLogical ? 'tooltipPane' : undefined}>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.5 }}>
        <strong>{l.title}</strong>
        {/* Per-layer rows (logical arcs only) */}
        {l.rows.length > 0 && l.rows.map((row, i) => (
          <div key={`row-${i}`} style={{ color: theme.text.muted }}>{row}</div>
        ))}
        {dirs && <DirLine from={l.siteA} to={l.siteZ} d={dirs.a} />}
        {dirs && <DirLine from={l.siteZ} to={l.siteA} d={dirs.z} />}
        {l.circuits.map((c) => {
          const cl = live?.get(c.cid)
          const ab = cl?.dirs?.[l.siteA]?.bps
          const ba = cl?.dirs?.[l.siteZ]?.bps
          return (
            <div key={c.id} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
              <span>{c.cid}</span>
              <span style={{ color: theme.text.muted }}>
                {c.provider ?? 'unknown'} · {formatCommitRate(c.commitRate)} · {c.status}
                {ab != null && ` · → ${formatBps(ab)}`}
                {ba != null && ` · ← ${formatBps(ba)}`}
              </span>
            </div>
          )
        })}
      </div>
    </Tooltip>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ArcLayer — generic arc renderer
// ─────────────────────────────────────────────────────────────────────────────

interface ArcLayerProps {
  lines: ArcLine[]
  live: Map<string, CircuitLive> | undefined
  circles: { at: LatLng; r: number }[]
  boxes: ObstacleBox[]
}

/**
 * Generic arc layer that draws ArcLine[] with live colouring.
 * Each line's paths.whole is drawn when no live data; paths.a/z with direction colours otherwise.
 * Supports dashed (dashArray) and stale (grey) arcs.
 */
export function ArcLayer({ lines, live, circles, boxes }: ArcLayerProps) {
  // Convert circles to MarkerCircle format for ArcLabels
  const markers: MarkerCircle[] = useMemo(
    () => circles.map((c) => ({ x: 0, y: 0, r: c.r })),
    [circles],
  )

  // Convert boxes to LabelBox format for ArcLabels blocking
  const blocked: LabelBox[] = useMemo(
    () => boxes.map((b, i) => ({ key: `box-${i}`, x: b.dx, y: b.dy, w: b.w, h: b.h, priority: 0 })),
    [boxes],
  )

  // Build circles from the circles prop for ArcLabels site circles
  const sites: Site[] = useMemo(
    () => circles.map((c, i) => ({ name: `site-${i}`, latitude: c.at[0], longitude: c.at[1] } as Site)),
    [circles],
  )

  return (
    <>
      {lines.map((l) => {
        const dirs = live?.size ? lineDirs(l, live) : null

        // Base path options
        const basePathOptions = {
          weight: l.weight,
          opacity: l.opacity,
          ...(l.dashed && { dashArray: '6 5' }),
        }

        // Compute colours
        const colorA = l.stale ? theme.heatmap.noData : (dirs ? dirs.a.color : theme.map.circuit)
        const colorZ = l.stale ? theme.heatmap.noData : (dirs ? dirs.z.color : theme.map.circuit)
        const colorWhole = l.stale ? theme.heatmap.noData : theme.map.circuit

        const tooltip = <ArcTooltip line={l} live={live} dirs={dirs} />
        // Logical lines (key contains ~) get lv-arc class for harness selectors
        const isLogical = l.key.includes('~')
        const className = isLogical ? 'lv-arc' : undefined

        if (!dirs) {
          // Draw paths.whole (may be multiple pieces due to antimeridian split)
          return (
            <Fragment key={l.key}>
              {l.paths.whole.map((piece, i) => (
                <Polyline
                  key={`${l.key}:whole:${i}`}
                  positions={piece}
                  pathOptions={{ ...basePathOptions, color: colorWhole }}
                  className={className}
                >
                  {i === 0 && tooltip}
                </Polyline>
              ))}
            </Fragment>
          )
        }

        // Draw paths.a and paths.z with direction colours
        return (
          <Fragment key={l.key}>
            {l.paths.a.map((piece, i) => (
              <Polyline
                key={`${l.key}:a:${i}`}
                positions={piece}
                pathOptions={{ ...basePathOptions, color: colorA }}
                className={className}
              >
                {i === 0 && tooltip}
              </Polyline>
            ))}
            {l.paths.z.map((piece, i) => (
              <Polyline
                key={`${l.key}:z:${i}`}
                positions={piece}
                pathOptions={{ ...basePathOptions, color: colorZ }}
                className={className}
              >
                {i === 0 && tooltip}
              </Polyline>
            ))}
          </Fragment>
        )
      })}
      {!!live?.size && <ArcLabels lines={lines} live={live} sites={sites} circles={circles} boxes={boxes} />}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CircuitPolylines — physical map wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One geodesic arc per connected site pair; width follows the pair's top capacity. With live
 * telemetry each arc splits at its midpoint: the half leaving a site shows the traffic leaving it.
 * This thin wrapper uses ArcLayer for rendering.
 */
export function CircuitPolylines({
  sites,
  groups,
  live,
}: {
  sites: Site[]
  groups: CircuitGroup[]
  live: Map<string, CircuitLive> | undefined
}) {
  const lines = useMemo(() => circuitLines(sites, groups), [sites, groups])

  // Build circles from geocoded sites
  const circles = useMemo(
    () => sites
      .filter((s) => s.latitude !== null)
      .map((s) => ({ at: [s.latitude!, s.longitude!] as LatLng, r: MARKER_RADIUS })),
    [sites],
  )

  return <ArcLayer lines={lines} live={live} circles={circles} boxes={NO_BOXES} />
}
