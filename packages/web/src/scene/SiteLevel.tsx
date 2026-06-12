import { useMemo, useState } from 'react'
import { Instance, Instances, Text } from '@react-three/drei'
import {
  computeBuildingBounds,
  computeRackLayout,
  type LldpCableSegment,
  type RackPlacement,
} from '@net3d/shared'
import type { SiteCable, SiteRack } from '../hooks/useSiteDetail'
import { SiteCables } from './cables'

export function useSiteLayout(racks: SiteRack[] | undefined) {
  return useMemo(() => {
    const placements = computeRackLayout(
      (racks ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        uHeight: r.uHeight,
        location: r.location,
      })),
    )
    return { placements, bounds: computeBuildingBounds(placements) }
  }, [racks])
}

function Racks({
  placements,
  onRackClick,
}: {
  placements: RackPlacement[]
  onRackClick: (rackId: string) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <>
      <Instances limit={placements.length || 1}>
        <boxGeometry args={[1, 1, 1]} />
        {/* white base — per-instance colors multiply against it */}
        <meshStandardMaterial color="#ffffff" roughness={0.5} metalness={0.4} />
        {placements.map((p) => (
          <Instance
            key={p.rackId}
            position={[p.x, p.height / 2, p.z]}
            scale={[p.width, p.height, p.depth]}
            color={hovered === p.rackId ? '#6fa8d8' : '#3a5a78'}
            onClick={(e) => {
              e.stopPropagation()
              onRackClick(p.rackId)
            }}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHovered(p.rackId)
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              setHovered(null)
              document.body.style.cursor = 'auto'
            }}
          />
        ))}
      </Instances>
      {placements.map((p) => (
        <Text
          key={`label-${p.rackId}`}
          position={[p.x, p.height + 0.25, p.z]}
          fontSize={0.16}
          color="#bfe3ff"
          anchorX="center"
          anchorY="bottom"
        >
          {p.name}
        </Text>
      ))}
    </>
  )
}

export function SiteLevel({
  racks,
  cables,
  lldpSegments = [],
  siteName,
  onRackClick,
  visible,
}: {
  racks: SiteRack[]
  cables: SiteCable[]
  lldpSegments?: LldpCableSegment[]
  siteName: string
  onRackClick: (rackId: string) => void
  visible: boolean
}) {
  const { placements, bounds } = useSiteLayout(racks)
  const size = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  }
  const center = {
    x: (bounds.max.x + bounds.min.x) / 2,
    z: (bounds.max.z + bounds.min.z) / 2,
  }

  return (
    <group visible={visible}>
      {/* site-local lights — the global directional is aimed at the globe */}
      <directionalLight position={[center.x + 6, 10, center.z + 8]} intensity={1.3} />
      <directionalLight position={[center.x - 6, 6, center.z - 8]} intensity={0.5} />
      {/* floor */}
      <mesh position={[center.x, -0.01, center.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size.x, size.z]} />
        <meshStandardMaterial color="#101c28" roughness={0.9} />
      </mesh>
      {/* translucent building shell */}
      <mesh position={[center.x, size.y / 2, center.z]}>
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshStandardMaterial color="#1e3c55" transparent opacity={0.12} depthWrite={false} />
      </mesh>
      <Racks placements={placements} onRackClick={onRackClick} />
      <SiteCables placements={placements} cables={cables} lldpSegments={lldpSegments} />
      <Text
        position={[center.x, size.y + 0.6, center.z]}
        fontSize={0.5}
        color="#e8f4ff"
        anchorX="center"
      >
        {siteName}
      </Text>
    </group>
  )
}
