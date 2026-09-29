import { useEffect, useMemo, useRef } from 'react'
import { CircleMarker, MapContainer, Pane, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { computeMapBounds, type CircuitGroup, type CircuitLive, type LogicalGraph, type LogicalLayer } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { useSitePrefetch } from '../hooks/useSitePrefetch'
import { useAppStore } from '../store/useAppStore'
import { CircuitPolylines } from './CircuitPolylines'
import { LogicalArcs, SitePills, sitePills } from './LogicalOverlay'
import { SiteTooltip } from './SiteTooltip'
import { MapLegend } from './MapLegend'
import { markerColorsForRole } from './markerColors'
import { cartoTileUrl } from './tileUrl'

/** Below the enter threshold (14), but close enough that entry is likely. */
const PREFETCH_ZOOM = 11


const TILE_URL = cartoTileUrl(import.meta.env.VITE_CARTO_KEY)
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

/** Feeds zoom/center signals into the navigation machine (map → site threshold). */
function MapNavWatcher({ sites, logical }: { sites: Site[]; logical: boolean }) {
  const handleMapSignals = useAppStore((s) => s.handleMapSignals)
  const prefetchSite = useSitePrefetch()

  // Leaflet zooms toward the cursor, not the center — so the criterion is
  // "a site marker is visible in the (small, high-zoom) viewport",
  // picking the one nearest the center when several are.
  const report = (map: ReturnType<typeof useMap>) => {
    // Logical mode at map level: pan/zoom the backbone graph, never zoom-enter a site.
    // This is the single gatekeeper (not the store) to avoid NAPALM-only dead ends.
    if (logical) return

    const zoom = map.getZoom()
    const viewBounds = map.getBounds()
    const centerPt = map.latLngToContainerPoint(map.getCenter())
    let best: { name: string; lat: number; lng: number } | null = null
    let bestDist = Infinity
    for (const s of sites) {
      if (s.latitude === null || s.longitude === null) continue
      if (!viewBounds.contains([s.latitude, s.longitude])) continue
      const pt = map.latLngToContainerPoint([s.latitude, s.longitude])
      const d = Math.hypot(pt.x - centerPt.x, pt.y - centerPt.y)
      if (d < bestDist) {
        bestDist = d
        best = { name: s.name, lat: s.latitude, lng: s.longitude }
      }
    }
    if (best && zoom >= PREFETCH_ZOOM) prefetchSite(best.name)
    handleMapSignals(zoom, best)
  }

  const map = useMapEvents({
    zoomend: () => report(map),
    moveend: () => report(map),
  })
  return null
}

/** Restores the stored map view when navigation returns to the map. */
function MapViewRestorer() {
  const map = useMap()
  const level = useAppStore((s) => s.level)
  const mapView = useAppStore((s) => s.mapView)
  const prevLevel = useRef(level)

  useEffect(() => {
    if (level === 'map' && prevLevel.current !== 'map' && mapView) {
      map.setView(mapView.center, mapView.zoom, { animate: false })
    }
    prevLevel.current = level
  }, [level, mapView, map])
  return null
}

function FitToSites({ sites }: { sites: Site[] }) {
  const map = useMap()
  useEffect(() => {
    const b = computeMapBounds(sites)
    map.fitBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { animate: false },
    )
  }, [map, sites])
  return null
}

export function MapLayer({
  sites,
  circuitGroups,
  circuitLive,
  onSiteSelect,
  logical,
  graph,
  hidden,
}: {
  sites: Site[]
  circuitGroups: CircuitGroup[]
  circuitLive: Map<string, CircuitLive> | undefined
  onSiteSelect: (name: string) => void
  /** Whether logical mode is active at map level. */
  logical: boolean
  /** Backbone graph for logical mode. */
  graph: LogicalGraph | null
  /** Hidden logical layers. */
  hidden: ReadonlySet<LogicalLayer | 'end'>
}) {
  const setMapView = useAppStore((s) => s.setMapView)
  const prefetchSite = useSitePrefetch()
  const geocoded = sites.filter((s) => s.latitude !== null && s.longitude !== null)

  // In logical mode, compute pills and filter out dotSites
  const pills = useMemo(
    () => (logical ? sitePills(graph, sites) : new Map()),
    [logical, graph, sites],
  )
  const dotSites = useMemo(
    () => geocoded.filter((s) => !pills.has(s.name)),
    [geocoded, pills],
  )
  const showSid = !hidden.has('sr')

  return (
    <>
    <MapContainer
      style={{ width: '100%', height: '100%', background: '#f4f6f8' }}
      center={[30, 0]}
      zoom={3}
      zoomControl={false}
      maxBounds={[[-85, -180], [85, 180]]}
      maxBoundsViscosity={1.0}
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} noWrap />
      <FitToSites sites={sites} />
      <MapNavWatcher sites={sites} logical={logical} />
      <MapViewRestorer />
      {/* Links sit in a lower pane so site markers (upper pane) win the click. */}
      <Pane name="circuits" style={{ zIndex: 399 }}>
        {logical ? (
          <LogicalArcs
            graph={graph}
            sites={sites}
            groups={circuitGroups}
            circuitLive={circuitLive}
            hidden={hidden}
            pills={pills}
            dotSites={dotSites}
          />
        ) : (
          <CircuitPolylines sites={sites} groups={circuitGroups} live={circuitLive} />
        )}
      </Pane>
      {/* Dedicated pane for pill labels - must exist before SitePills renders Tooltips into it.
          Below the sites pane (401), above arcLabels (400 when live) and circuits (399). */}
      {logical && <Pane name="pillLabels" style={{ zIndex: 400 }} />}
      <Pane name="sites" style={{ zIndex: 401 }}>
        {/* In logical mode: render pills and fall back to dots for sites without pills */}
        {/* In physical mode: render all geocoded sites as dots */}
        {(logical ? dotSites : geocoded).map((s) => {
          const mc = markerColorsForRole(s.role)
          return (
          <CircleMarker
            key={s.id}
            // Visual dot only — the transparent hit circle below carries interaction.
            center={[s.latitude!, s.longitude!]}
            radius={7}
            interactive={false}
            pathOptions={{ color: mc.color, weight: 2, fillColor: mc.fill, fillOpacity: 0.85 }}
          />
          )
        })}
        {(logical ? dotSites : geocoded).map((s) => (
          // Enlarged transparent click target: easy to hit, painted above the dot.
          <CircleMarker
            key={`hit-${s.id}`}
            center={[s.latitude!, s.longitude!]}
            radius={16}
            pathOptions={{ stroke: false, fill: true, fillOpacity: 0 }}
            eventHandlers={{
              mouseover: () => prefetchSite(s.name),
              click: () => {
                setMapView({ center: [s.latitude!, s.longitude!], zoom: 13 })
                onSiteSelect(s.name)
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <SiteTooltip site={s} />
            </Tooltip>
          </CircleMarker>
        ))}
        {logical && <SitePills pills={pills} showSid={showSid} onSiteSelect={onSiteSelect} />}
      </Pane>
    </MapContainer>
    <MapLegend live={!!circuitLive?.size} logical={logical} />
    </>
  )
}
