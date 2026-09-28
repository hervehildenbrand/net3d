import { Fragment, useMemo, useState } from 'react'
import { Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { divIcon } from 'leaflet'
import {
  commitRateToSpeedBucket,
  formatBps,
  formatCommitRate,
  greatCircleLatLngs,
  speedBucketToWidth,
  type CircuitGroup,
  type CircuitLive,
  type SiteCircuit,
} from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { theme } from '../theme'
import { dirLive, formatPct, type DirGroup } from '../lib/liveTelemetry'
import { labelBox, placeLabels, contrastText, type LabelBox, type MarkerCircle } from './arcLabels'
import { screenAngleDeg, showArrows, splitArc, spreadPoints } from './arcHalves'

type LatLng = [number, number]

interface LineData {
  key: string
  siteA: string
  siteZ: string
  positions: LatLng[]
  halves: ReturnType<typeof splitArc<LatLng>>
  weight: number
  opacity: number
  title: string
  circuits: SiteCircuit[]
  cids: string[]
}

/** Both directions of a link, or null when none of its circuits has telemetry (draw it as today). */
function lineDirs(l: LineData, live: Map<string, CircuitLive>): { a: DirGroup; z: DirGroup } | null {
  const a = dirLive(l.cids, live, l.siteA)
  const z = dirLive(l.cids, live, l.siteZ)
  return a && z ? { a, z } : null
}

/** Screen radius kept clear around each site marker (dot is 7 px + 2 px stroke; the rest is breathing room). */
const MARKER_RADIUS = 14
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

type Bead = LabelBox & { bps: number; color: string; at: LatLng }

/** Per-direction arrowheads and rate beads for live links; beads de-overlapped on zoom/move. */
function ArcLabels({ lines, live, sites }: { lines: LineData[]; live: Map<string, CircuitLive>; sites: Site[] }) {
  const map = useMap()
  const [tick, setTick] = useState(0)
  useMapEvents({
    zoomend: () => setTick((t) => t + 1),
    moveend: () => setTick((t) => t + 1),
  })

  const { arrows, beads } = useMemo(() => {
    void tick // recompute screen positions after every zoom/move
    const px = (p: LatLng) => map.latLngToContainerPoint(p)
    const markers: MarkerCircle[] = sites
      .filter((s) => s.latitude !== null)
      .map((s) => {
        const pt = px([s.latitude!, s.longitude!])
        return { x: pt.x, y: pt.y, r: MARKER_RADIUS }
      })

    const arrows: Arrow[] = []
    const boxes: Bead[] = []
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
      const { a, z, mid, aLabel, zLabel } = l.halves
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

      for (const [d, at, from] of [
        [dirs.a, aLabel, l.siteA],
        [dirs.z, zLabel, l.siteZ],
      ] as const) {
        if (d.bps === null) continue
        const p = px(at)
        boxes.push({ ...labelBox(`${l.key}@${from}`, formatBps(d.bps), p.x, p.y, d.bps), bps: d.bps, color: d.color, at })
      }
    }

    // Pass 2: thin out crowded arrow pairs, keeping busier links
    const keptArrows = spreadPoints(arrowCandidates, ARROW_SPACING)
    for (const c of arrowCandidates) {
      if (!keptArrows.has(c.key)) continue
      arrows.push(c.arrowA, c.arrowZ)
      markers.push({ x: c.x, y: c.y, r: ARROW_RADIUS })
    }

    const kept = placeLabels(boxes, markers) // busiest first, clear of sites and arrowheads
    return { arrows, beads: boxes.filter((b) => kept.has(b.key)) }
  }, [tick, lines, live, map, sites])

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

function ArcTooltip({ line: l, live, dirs }: { line: LineData; live: Map<string, CircuitLive> | undefined; dirs: { a: DirGroup; z: DirGroup } | null }) {
  return (
    <Tooltip sticky>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.5 }}>
        <strong>{l.title}</strong>
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

/**
 * One geodesic arc per connected site pair; width follows the pair's top capacity. With live
 * telemetry each arc splits at its midpoint: the half leaving a site shows the traffic leaving it.
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
  const lines = useMemo<LineData[]>(() => {
    const byName = new Map(sites.map((s) => [s.name, s]))
    return groups.flatMap((g) => {
      const a = byName.get(g.siteA)
      const z = byName.get(g.siteZ)
      if (!a || !z || a.latitude === null || z.latitude === null) return []
      const bucket = commitRateToSpeedBucket(g.maxCommitRate ?? null)
      const positions = greatCircleLatLngs(a.latitude, a.longitude!, z.latitude, z.longitude!, 48) as LatLng[]
      return [
        {
          key: `${g.siteA}|${g.siteZ}`,
          siteA: g.siteA,
          siteZ: g.siteZ,
          positions,
          halves: splitArc(positions),
          // Raise the thinnest links off the floor: 10G circuits at weight 1.5
          // were nearly invisible on the light basemap.
          weight: Math.max(speedBucketToWidth(bucket), 2),
          opacity: bucket === '400G' ? 0.9 : bucket === '100G' ? 0.75 : 0.6,
          title: `${g.siteA} ↔ ${g.siteZ} — ${g.count} circuit${g.count > 1 ? 's' : ''}`,
          circuits: g.circuits ?? [],
          cids: (g.circuits ?? []).map((c) => c.cid),
        },
      ]
    })
  }, [sites, groups])

  return (
    <>
      {lines.map((l) => {
        const dirs = live?.size ? lineDirs(l, live) : null
        const tooltip = <ArcTooltip line={l} live={live} dirs={dirs} />
        if (!dirs) {
          return (
            <Polyline key={l.key} positions={l.positions} pathOptions={{ color: theme.map.circuit, weight: l.weight, opacity: l.opacity }}>
              {tooltip}
            </Polyline>
          )
        }
        return (
          <Fragment key={l.key}>
            <Polyline positions={l.halves.a} pathOptions={{ color: dirs.a.color, weight: l.weight, opacity: l.opacity }}>
              {tooltip}
            </Polyline>
            <Polyline positions={l.halves.z} pathOptions={{ color: dirs.z.color, weight: l.weight, opacity: l.opacity }}>
              {tooltip}
            </Polyline>
          </Fragment>
        )
      })}
      {!!live?.size && <ArcLabels lines={lines} live={live} sites={sites} />}
    </>
  )
}
