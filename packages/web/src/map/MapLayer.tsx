import { useEffect } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { computeMapBounds, type CircuitGroup } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { CircuitPolylines } from './CircuitPolylines'

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

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
      <CircuitPolylines sites={sites} groups={circuitGroups} />
      {geocoded.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.latitude!, s.longitude!]}
          radius={7}
          pathOptions={{ color: '#0284c7', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.85 }}
          eventHandlers={{ click: () => onSiteSelect(s.name) }}
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
