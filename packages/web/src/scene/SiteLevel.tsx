import { useMemo, useState } from 'react'
import { Billboard, Instance, Instances, Text } from '@react-three/drei'
import {
  computeBuildingBounds,
  computeRackLayout,
  computeRoomStats,
  type LldpCableSegment,
  type RackPlacement,
} from '@net3d/shared'
import type { SiteCable, SitePower, SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'
import { useAppStore } from '../store/useAppStore'
import { SiteCables } from './cables'
import { RoomPower } from './power'
import { buildRoleMarkers, racksWithRole, type RoleMarker } from '../lib/roleHighlight'

/** Hide individual rack labels once the camera is farther than span * this. */
const RACK_LABEL_THRESHOLD = 0.9

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
  span,
  highlightActive,
  matchedRackIds,
}: {
  placements: RackPlacement[]
  onRackClick: (rackId: string) => void
  /** Site footprint size, used to scale the label-visibility threshold. */
  span: number
  /** A role highlight is active — dim racks that hold no matching device. */
  highlightActive: boolean
  matchedRackIds: Set<string>
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const siteViewDistance = useAppStore((s) => s.siteViewDistance)
  // Show per-rack names only when zoomed in; far out they overlap into noise,
  // so the room labels carry orientation instead. Null = no signal yet → show.
  const showRackLabels =
    siteViewDistance === null || siteViewDistance < span * RACK_LABEL_THRESHOLD

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
            color={
              hovered === p.rackId
                ? theme.scene.rackHover
                : highlightActive && !matchedRackIds.has(p.rackId)
                  ? theme.scene.rackDimmed
                  : theme.scene.rack
            }
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
      {showRackLabels &&
        placements.map((p) => (
          <Billboard key={`label-${p.rackId}`} position={[p.x, p.height + 0.25, p.z]}>
            <Text fontSize={0.16} color={theme.text.onScene} anchorX="center" anchorY="bottom">
              {p.name}
            </Text>
          </Billboard>
        ))}
    </>
  )
}

/** Per-device role markers — a glowing band on each matching rack's front face. */
function RoleMarkers({ markers }: { markers: RoleMarker[] }) {
  // A shared material can't carry per-instance emissive, so group markers by color
  // and give each role hue its own <Instances>. Raycast is disabled so the markers
  // (which sit just in front of the opaque rack faces) never steal rack click/hover.
  const byColor = useMemo(() => {
    const groups = new Map<string, RoleMarker[]>()
    for (const m of markers) {
      const g = groups.get(m.color)
      if (g) g.push(m)
      else groups.set(m.color, [m])
    }
    return [...groups.entries()]
  }, [markers])

  return (
    <>
      {byColor.map(([color, group]) => (
        <Instances key={color} limit={group.length} raycast={() => null}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} toneMapped={false} />
          {group.map((m, i) => (
            <Instance key={i} position={m.position} scale={m.scale} />
          ))}
        </Instances>
      ))}
    </>
  )
}

/** Floating per-room stats — name, racks, active/total devices — above each rack row group. */
function RoomLabels({ racks, placements }: { racks: SiteRack[]; placements: RackPlacement[] }) {
  const labels = useMemo(() => {
    const stats = new Map(computeRoomStats(racks).map((s) => [s.location, s]))
    const byLocation = new Map<string, RackPlacement[]>()
    for (const p of placements) {
      const key = p.location ?? ''
      const group = byLocation.get(key)
      if (group) group.push(p)
      else byLocation.set(key, [p])
    }
    return [...byLocation.entries()].flatMap(([location, group]) => {
      const s = stats.get(location)
      if (!s || group.length === 0) return []
      const cx = group.reduce((sum, p) => sum + p.x, 0) / group.length
      const cz = group.reduce((sum, p) => sum + p.z, 0) / group.length
      const top = Math.max(...group.map((p) => p.height))
      return [
        {
          location,
          x: cx,
          y: top + 0.9,
          z: cz,
          text: `${location || 'unassigned'} — ${s.rackCount} racks · ${s.activeDeviceCount}/${s.deviceCount} devices active`,
        },
      ]
    })
  }, [racks, placements])

  return (
    <>
      {labels.map((l) => (
        <Billboard key={`room-${l.location}`} position={[l.x, l.y, l.z]}>
          <Text fontSize={0.22} color={theme.text.secondary} anchorX="center" anchorY="bottom">
            {l.text}
          </Text>
        </Billboard>
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
  highlightedRoles,
  powerVisible,
  power,
}: {
  racks: SiteRack[]
  cables: SiteCable[]
  lldpSegments?: LldpCableSegment[]
  siteName: string
  onRackClick: (rackId: string) => void
  visible: boolean
  /** NetBox role names to highlight; empty = no highlight (today's plain view). */
  highlightedRoles: Set<string>
  /** Power overlay on: render per-rack A/B PDU strips + panel nodes. */
  powerVisible: boolean
  power?: SitePower
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

  const highlightActive = highlightedRoles.size > 0
  const matchedRackIds = useMemo(
    () => racksWithRole(racks, highlightedRoles),
    [racks, highlightedRoles],
  )
  const markers = useMemo(
    () => buildRoleMarkers(racks, placements, highlightedRoles),
    [racks, placements, highlightedRoles],
  )

  return (
    <group visible={visible}>
      {/* site-local lights — the global directional is aimed at the globe */}
      <directionalLight position={[center.x + 6, 10, center.z + 8]} intensity={1.3} />
      <directionalLight position={[center.x - 6, 6, center.z - 8]} intensity={0.5} />
      {/* floor */}
      <mesh position={[center.x, -0.01, center.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size.x, size.z]} />
        <meshStandardMaterial color={theme.scene.floor} roughness={0.9} />
      </mesh>
      {/* translucent glass building shell */}
      <mesh position={[center.x, size.y / 2, center.z]}>
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshStandardMaterial
          color={theme.scene.buildingShell}
          transparent
          opacity={theme.scene.buildingShellOpacity}
          depthWrite={false}
        />
      </mesh>
      {/* Only mount the interactive rack instances while this level is shown.
          A hidden <group visible={false}> still leaves its instance meshes
          individually visible, so R3F's pointer raycaster keeps hitting them
          and they occlude the rack-level device meshes behind them. */}
      {visible && (
        <Racks
          placements={placements}
          onRackClick={onRackClick}
          span={Math.max(size.x, size.z, 4)}
          highlightActive={highlightActive}
          matchedRackIds={matchedRackIds}
        />
      )}
      {visible && markers.length > 0 && <RoleMarkers markers={markers} />}
      {visible && powerVisible && <RoomPower racks={racks} placements={placements} power={power} />}
      <RoomLabels racks={racks} placements={placements} />
      <SiteCables placements={placements} cables={cables} lldpSegments={lldpSegments} />
      <Billboard position={[center.x, size.y + 0.6, center.z]}>
        <Text fontSize={0.5} color={theme.text.primary} anchorX="center">
          {siteName}
        </Text>
      </Billboard>
    </group>
  )
}
