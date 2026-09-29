import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { divIcon, type DivIcon, type Marker as LMarker } from 'leaflet'
import type { CircuitGroup, CircuitLive, LogicalGraph, LogicalLayer } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { useSitePrefetch } from '../hooks/useSitePrefetch'
import { useAppStore } from '../store/useAppStore'
import { logicalLines } from './arcLines'
import { ArcLayer } from './CircuitPolylines'
import {
  sitePills as buildSitePills,
  nodeAnchors,
  pillHtml,
  pillLabelRows,
  pillObstacles,
  LABEL_ZOOM,
  PILL_W,
  SEG_PX,
  HIT_PX,
  type SitePill,
} from './sitePills'
import type { ObstacleBox } from './arcLabels'
import { MARKER_RADIUS } from './arcLabels'
import type { LatLng } from './arcLines'

// ─────────────────────────────────────────────────────────────────────────────
// useZoom
// ─────────────────────────────────────────────────────────────────────────────

/** Hook that returns the current map zoom level and updates on zoomend. */
export function useZoom(): number {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  })
  return zoom
}

// ─────────────────────────────────────────────────────────────────────────────
// SitePills
// ─────────────────────────────────────────────────────────────────────────────

interface SitePillsProps {
  pills: Map<string, SitePill>
  showSid: boolean
  onSiteSelect: (name: string) => void
}

interface PillRenderData {
  siteName: string
  pill: SitePill
  position: LatLng
  icon: DivIcon
  rows: string[]
}

/**
 * Render site pills as Leaflet Markers with hover/permanent labels.
 * Icons and positions are memoised per pill set to avoid setIcon/setLatLng churn on poll.
 */
export function SitePills({ pills, showSid, onSiteSelect }: SitePillsProps) {
  const zoom = useZoom()
  const setMapView = useAppStore((s) => s.setMapView)
  const prefetchSite = useSitePrefetch()

  // Tooltip permanent from LABEL_ZOOM
  const labelZoom = zoom >= LABEL_ZOOM

  // Memoize pill render data: icons, positions, and label rows per pill set.
  // Recomputes only when pills or showSid changes — NOT on poll or zoom.
  const pillData = useMemo((): PillRenderData[] => {
    const result: PillRenderData[] = []
    for (const [siteName, pill] of pills) {
      const site = pill.site
      const position: LatLng = [site.latitude!, site.longitude!]
      const n = pill.routers.length
      const pillHeight = n * SEG_PX
      const containerHeight = Math.max(HIT_PX, pillHeight + 8)
      const icon = divIcon({
        className: 'lv-pill',
        iconSize: [HIT_PX, containerHeight],
        iconAnchor: [HIT_PX / 2, containerHeight / 2],
        html: pillHtml(pill),
      })
      const rows = pillLabelRows(pill, showSid)
      result.push({ siteName, pill, position, icon, rows })
    }
    return result
  }, [pills, showSid])

  return (
    <>
      {pillData.map((pd) => (
        <PillMarker
          key={labelZoom ? `${pd.siteName}:p` : `${pd.siteName}:h`}
          data={pd}
          labelZoom={labelZoom}
          setMapView={setMapView}
          onSiteSelect={onSiteSelect}
          prefetchSite={prefetchSite}
        />
      ))}
    </>
  )
}

interface PillMarkerProps {
  data: PillRenderData
  labelZoom: boolean
  setMapView: (view: { center: [number, number]; zoom: number }) => void
  onSiteSelect: (name: string) => void
  prefetchSite: (name: string) => void
}

/**
 * Individual pill marker with keyboard support (Enter/Space triggers click).
 */
function PillMarker({ data, labelZoom, setMapView, onSiteSelect, prefetchSite }: PillMarkerProps) {
  const markerRef = useRef<LMarker | null>(null)

  const handleClick = useCallback(() => {
    const lat = data.pill.site.latitude!
    const lng = data.pill.site.longitude!
    setMapView({ center: [lat, lng], zoom: 13 })
    onSiteSelect(data.siteName)
  }, [data, setMapView, onSiteSelect])

  // Add keyboard handler to marker's DOM element
  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    const el = marker.getElement()
    if (!el) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleClick()
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [handleClick])

  const labelContent = (
    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.4 }}>
      <strong>{data.siteName}</strong>
      {data.rows.map((row, i) => (
        <div key={i} style={{ color: '#64748b' }}>{row}</div>
      ))}
    </div>
  )

  return (
    <Marker
      ref={markerRef}
      position={data.position}
      pane="sites"
      icon={data.icon}
      eventHandlers={{
        mouseover: () => prefetchSite(data.siteName),
        click: handleClick,
      }}
    >
      <Tooltip
        permanent={labelZoom}
        direction="right"
        offset={[PILL_W / 2 + 2, 0]}
        pane="pillLabels"
        className="lv-label"
      >
        {labelContent}
      </Tooltip>
    </Marker>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LogicalArcs
// ─────────────────────────────────────────────────────────────────────────────

interface LogicalArcsProps {
  graph: LogicalGraph | null
  sites: Site[]
  groups: CircuitGroup[]
  circuitLive: Map<string, CircuitLive> | undefined
  hidden: ReadonlySet<LogicalLayer | 'end'>
  pills: Map<string, SitePill>
  dotSites: Site[]
}

/**
 * Render logical arcs on the map using ArcLayer.
 */
export function LogicalArcs({
  graph,
  sites,
  groups,
  circuitLive,
  hidden,
  pills,
  dotSites,
}: LogicalArcsProps) {
  const zoom = useZoom()
  const showSid = !hidden.has('sr')

  // Compute anchors from pills and sites (memoised on zoom/pills/sites)
  const anchors = useMemo(
    () => nodeAnchors(pills, sites, zoom),
    [pills, sites, zoom],
  )

  // Compute lines (memoised on graph/anchors/sites/groups/hidden)
  const lines = useMemo(
    () => logicalLines(graph, anchors, sites, groups, hidden),
    [graph, anchors, sites, groups, hidden],
  )

  // Circles for site markers (dotSites - the sites without pills)
  const circles = useMemo(
    () => dotSites.map((s) => ({ at: [s.latitude!, s.longitude!] as LatLng, r: MARKER_RADIUS })),
    [dotSites],
  )

  // Boxes for pill obstacles (memoised on pills/zoom/showSid)
  const boxes = useMemo(
    () => pillObstacles(pills, zoom, showSid),
    [pills, zoom, showSid],
  )

  return <ArcLayer lines={lines} live={circuitLive} circles={circles} boxes={boxes} />
}

// Re-export sitePills for convenience
export { buildSitePills as sitePills }
