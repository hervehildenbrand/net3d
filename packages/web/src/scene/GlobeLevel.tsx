import { useMemo } from 'react'
import { Vector3 } from 'three'
import { Instance, Instances } from '@react-three/drei'
import { latLonToVector3 } from '@net3d/shared'
import type { Site } from '../hooks/useSites'

export const GLOBE_RADIUS = 2

function toVector3(lat: number, lon: number, radius: number): Vector3 {
  const v = latLonToVector3(lat, lon, radius)
  return new Vector3(v.x, v.y, v.z)
}

function SiteMarkers({ sites }: { sites: Site[] }) {
  const geocoded = useMemo(
    () => sites.filter((s): s is Site & { latitude: number; longitude: number } =>
      s.latitude !== null && s.longitude !== null,
    ),
    [sites],
  )

  return (
    <Instances limit={geocoded.length || 1}>
      <sphereGeometry args={[0.022, 12, 12]} />
      <meshStandardMaterial emissive="#26d0ff" emissiveIntensity={2} color="#26d0ff" />
      {geocoded.map((s) => (
        <Instance key={s.id} position={toVector3(s.latitude, s.longitude, GLOBE_RADIUS * 1.005)} />
      ))}
    </Instances>
  )
}

export function GlobeLevel({ sites }: { sites: Site[] }) {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <meshStandardMaterial color="#0b1f33" roughness={0.85} metalness={0.1} />
      </mesh>
      {/* subtle atmosphere shell */}
      <mesh scale={1.02}>
        <sphereGeometry args={[GLOBE_RADIUS, 32, 32]} />
        <meshBasicMaterial color="#1c4a6e" transparent opacity={0.08} />
      </mesh>
      <SiteMarkers sites={sites} />
    </group>
  )
}
