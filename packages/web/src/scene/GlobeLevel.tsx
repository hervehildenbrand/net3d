import { useMemo, useState } from 'react'
import { Vector3 } from 'three'
import { Instance, Instances } from '@react-three/drei'
import { latLonToVector3, type CircuitGroup } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { CircuitArcs } from './CircuitArcs'

export const GLOBE_RADIUS = 2

export function toVector3(lat: number, lon: number, radius: number): Vector3 {
  const v = latLonToVector3(lat, lon, radius)
  return new Vector3(v.x, v.y, v.z)
}

export type GeocodedSite = Site & { latitude: number; longitude: number }

export function geocoded(sites: Site[]): GeocodedSite[] {
  return sites.filter((s): s is GeocodedSite => s.latitude !== null && s.longitude !== null)
}

function SiteMarkers({
  sites,
  onSiteClick,
}: {
  sites: Site[]
  onSiteClick: (name: string) => void
}) {
  const points = useMemo(() => geocoded(sites), [sites])
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <Instances limit={points.length || 1}>
      <sphereGeometry args={[0.022, 12, 12]} />
      <meshStandardMaterial emissive="#26d0ff" emissiveIntensity={2} color="#26d0ff" />
      {points.map((s) => (
        <Instance
          key={s.id}
          position={toVector3(s.latitude, s.longitude, GLOBE_RADIUS * 1.005)}
          scale={hovered === s.name ? 1.8 : 1}
          onClick={(e) => {
            e.stopPropagation()
            onSiteClick(s.name)
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHovered(s.name)
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            setHovered(null)
            document.body.style.cursor = 'auto'
          }}
        />
      ))}
    </Instances>
  )
}

export function GlobeLevel({
  sites,
  circuitGroups,
  onSiteClick,
  visible,
}: {
  sites: Site[]
  circuitGroups: CircuitGroup[]
  onSiteClick: (name: string) => void
  visible: boolean
}) {
  return (
    <group visible={visible}>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <meshStandardMaterial color="#0b1f33" roughness={0.85} metalness={0.1} />
      </mesh>
      {/* subtle atmosphere shell */}
      <mesh scale={1.02}>
        <sphereGeometry args={[GLOBE_RADIUS, 32, 32]} />
        <meshBasicMaterial color="#1c4a6e" transparent opacity={0.08} />
      </mesh>
      <SiteMarkers sites={sites} onSiteClick={onSiteClick} />
      <CircuitArcs sites={sites} groups={circuitGroups} />
    </group>
  )
}
