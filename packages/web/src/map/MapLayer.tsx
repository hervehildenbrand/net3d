import { useEffect, useRef } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { computeMapBounds, type CircuitGroup } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { useAppStore } from '../store/useAppStore'
import { CircuitPolylines } from './CircuitPolylines'


const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

/** Feeds zoom/center signals into the navigation machine (map → site threshold). */
function MapNavWatcher({ sites }: { sites: Site[] }) {
  const handleMapSignals = useAppStore((s) => s.handleMapSignals)

  // Leaflet zooms toward the cursor, not the center — so the criterion is
  // "a site marker is visible in the (small, high-zoom) viewport",
  // picking the one nearest the center when several are.
  const report = (map: ReturnType<typeof useMap>) => {
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
  onSiteSelect,
}: {
  sites: Site[]
  circuitGroups: CircuitGroup[]
  onSiteSelect: (name: string) => void
}) {
  const setMapView = useAppStore((s) => s.setMapView)
  const geocoded = sites.filter((s) => s.latitude !== null && s.longitude !== null)

  return (
    <MapContainer
      style={{ width: '100%', height: '100%', background: '#f4f6f8' }}
      center={[30, 0]}
      zoom={3}
      zoomControl={false}
      worldCopyJump
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      <FitToSites sites={sites} />
      <MapNavWatcher sites={sites} />
      <MapViewRestorer />
      <CircuitPolylines sites={sites} groups={circuitGroups} />
      {geocoded.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.latitude!, s.longitude!]}
          radius={7}
          pathOptions={{ color: '#0284c7', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.85 }}
          eventHandlers={{
            click: () => {
              setMapView({ center: [s.latitude!, s.longitude!], zoom: 13 })
              onSiteSelect(s.name)
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <strong>{s.name}</strong>
            {s.region ? ` — ${s.region}` : ''}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
