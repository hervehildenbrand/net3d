import { useMemo, useState } from 'react'
import { Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { divIcon } from 'leaflet'
import {
  commitRateToSpeedBucket,
  formatBps,
  formatCommitRate,
  greatCircleLatLngs,
  speedBucketToWidth,
  type CableLive,
  type CircuitGroup,
  type SiteCircuit,
} from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { theme } from '../theme'
import { formatPct, groupLive } from '../lib/liveTelemetry'
import { labelBox, placeLabels, contrastText, type LabelBox, type MarkerCircle } from './arcLabels'

interface LineData {
  key: string
  positions: [number, number][]
  weight: number
  opacity: number
  title: string
  circuits: SiteCircuit[]
  cids: string[]
  mid: [number, number]
}

/** Screen radius kept clear around each site marker (dot is 7 px + 2 px stroke; the rest is breathing room). */
const MARKER_RADIUS = 14

/** Rate pill; background and text colour are appended per label. */
const PILL_STYLE =
  "display:inline-flex;width:max-content;transform:translate(-50%,-50%);font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:11px;font-variant-numeric:tabular-nums;padding:2px 6px;border-radius:9px;border:2px solid rgba(255,255,255,0.95);box-shadow:0 0 0 1px rgba(0,0,0,0.08);white-space:nowrap;line-height:1.2"

/** Arc labels showing Gbps on live links; de-overlapped on zoom/move. */
function ArcLabels({
  lines,
  live,
  sites,
}: {
  lines: LineData[]
  live: Map<string, CableLive> | undefined
  sites: Site[]
}) {
  const map = useMap()
  const [tick, setTick] = useState(0)
  useMapEvents({
    zoomend: () => setTick((t) => t + 1),
    moveend: () => setTick((t) => t + 1),
  })

  const visible = useMemo(() => {
    // Reference tick to trigger recompute
    void tick

    // Build marker circles to avoid
    const markers: MarkerCircle[] = sites
      .filter((s) => s.latitude !== null)
      .map((s) => {
        const pt = map.latLngToContainerPoint([s.latitude!, s.longitude!])
        return { x: pt.x, y: pt.y, r: MARKER_RADIUS }
      })

    // Build boxes for all live arcs
    const boxes: (LabelBox & { bps: number; color: string; mid: [number, number] })[] = []
    for (const l of lines) {
      const gl = live && groupLive(l.cids, live)
      if (!gl || gl.bps === null) continue

      const pt = map.latLngToContainerPoint(l.mid)
      const text = formatBps(gl.bps)
      const box = labelBox(l.key, text, pt.x, pt.y, gl.bps)
      boxes.push({ ...box, bps: gl.bps, color: gl.color, mid: l.mid })
    }

    // De-overlap: keep busiest first, avoid markers
    const kept = placeLabels(boxes, markers)
    return boxes.filter((b) => kept.has(b.key))
  }, [tick, lines, live, map, sites])

  return (
    <Pane name="arcLabels" style={{ zIndex: 400 }}>
      {visible.map((v) => {
        const text = formatBps(v.bps)
        const [value, unit] = text.split(' ')
        const textColor = contrastText(v.color)
        return (
          <Marker
            key={v.key}
            position={v.mid}
            pane="arcLabels"
            interactive={false}
            icon={divIcon({
              className: '',
              iconSize: [0, 0],
              html: `<div style="${PILL_STYLE};color:${textColor};background:${v.color}"><span style="font-weight:600">${value}</span><span style="font-weight:400;margin-left:2px">${unit}</span></div>`,
            })}
          />
        )
      })}
    </Pane>
  )
}

/** One geodesic polyline per connected site pair; width follows the pair's top capacity. */
export function CircuitPolylines({
  sites,
  groups,
  live,
}: {
  sites: Site[]
  groups: CircuitGroup[]
  live: Map<string, CableLive> | undefined
}) {
  const lines = useMemo(() => {
    const byName = new Map(sites.map((s) => [s.name, s]))
    return groups.flatMap((g) => {
      const a = byName.get(g.siteA)
      const z = byName.get(g.siteZ)
      if (!a || !z || a.latitude === null || z.latitude === null) return []
      const bucket = commitRateToSpeedBucket(g.maxCommitRate ?? null)
      const positions = greatCircleLatLngs(a.latitude, a.longitude!, z.latitude, z.longitude!, 48)
      return [
        {
          key: `${g.siteA}|${g.siteZ}`,
          positions,
          // Raise the thinnest links off the floor: 10G circuits at weight 1.5
          // were nearly invisible on the light basemap.
          weight: Math.max(speedBucketToWidth(bucket), 2),
          opacity: bucket === '400G' ? 0.9 : bucket === '100G' ? 0.75 : 0.6,
          title: `${g.siteA} ↔ ${g.siteZ} — ${g.count} circuit${g.count > 1 ? 's' : ''}`,
          circuits: g.circuits ?? [],
          cids: (g.circuits ?? []).map((c) => c.cid),
          mid: positions[Math.floor(positions.length / 2)]!,
        },
      ]
    })
  }, [sites, groups])

  return (
    <>
      {lines.map((l) => {
        const gl = live && groupLive(l.cids, live)
        return (
          <Polyline
            key={l.key}
            positions={l.positions as [number, number][]}
            pathOptions={{ color: gl?.color ?? theme.map.circuit, weight: l.weight, opacity: l.opacity }}
          >
            <Tooltip sticky>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.5 }}>
                <strong>{l.title}</strong>
                {l.circuits.map((c) => {
                  const cl = live?.get(c.cid)
                  return (
                    <div key={c.id} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                      <span>{c.cid}</span>
                      <span style={{ color: theme.text.muted }}>
                        {c.provider ?? 'unknown'} · {formatCommitRate(c.commitRate)} · {c.status}
                        {cl?.bps != null && ` · ${formatBps(cl.bps)}`}
                        {cl?.pct != null && ` · ${formatPct(cl.pct)}%`}
                      </span>
                    </div>
                  )
                })}
                {gl?.bps != null && (
                  <div style={{ marginTop: 4, color: theme.text.secondary }}>
                    live total: {formatBps(gl.bps)}
                  </div>
                )}
              </div>
            </Tooltip>
          </Polyline>
        )
      })}
      {!!live?.size && <ArcLabels lines={lines} live={live} sites={sites} />}
    </>
  )
}
