import { useMemo } from 'react'
import { Billboard, Instance, Instances, Line, Text } from '@react-three/drei'
import type { RackPlacement } from '@net3d/shared'
import type { SiteCable, SitePower, SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'
import {
  buildPduRails,
  buildPowerCords,
  buildRoomPduStrips,
  panelNodes,
  pduDevices,
  type RoomPduStrip,
} from '../lib/powerOverlay'

const EMPTY_POWER: SitePower = { panels: [], feeds: [] }

/**
 * Rack view: the two vertical PDU rails (rear corners, A left / B right) and one
 * A/B-colored power cord per device PSU. Cords dim unless their device is focused.
 */
export function RackPower({
  rack,
  placement,
  cables,
  highlightDeviceName = null,
}: {
  rack: SiteRack
  placement: RackPlacement
  cables: SiteCable[]
  highlightDeviceName?: string | null
}) {
  const rails = useMemo(() => buildPduRails(placement, pduDevices(rack)), [rack, placement])
  const cords = useMemo(() => buildPowerCords(rack, placement, cables), [rack, placement, cables])

  return (
    <>
      {rails.map((r, i) => (
        <mesh key={`rail-${i}`} position={r.position} raycast={() => null}>
          <boxGeometry args={r.scale} />
          <meshStandardMaterial color={r.color} emissive={r.color} emissiveIntensity={0.45} toneMapped={false} />
        </mesh>
      ))}
      {cords.map((c) => {
        const emphasis = highlightDeviceName
          ? c.device === highlightDeviceName
            ? 'hi'
            : 'lo'
          : 'none'
        return (
          <Line
            key={c.id}
            points={c.points}
            color={c.color}
            lineWidth={emphasis === 'hi' ? 3 : 1.6}
            transparent
            opacity={emphasis === 'lo' ? 0.12 : emphasis === 'hi' ? 1 : 0.8}
          />
        )
      })}
    </>
  )
}

/**
 * Room view: a thin A/B strip down each dual-fed rack (so the redundancy reads
 * across the whole hall) plus two labelled power-panel nodes at the room edges.
 */
export function RoomPower({
  racks,
  placements,
  power,
  onPanelClick,
  selectedPanel = null,
}: {
  racks: SiteRack[]
  placements: RackPlacement[]
  power?: SitePower
  /** Click a panel node to trace/clear the power chain it roots. */
  onPanelClick?: (name: string) => void
  /** Name of the panel whose chain is active; others dim. */
  selectedPanel?: string | null
}) {
  const strips = useMemo(() => buildRoomPduStrips(racks, placements), [racks, placements])
  const nodes = useMemo(() => panelNodes(placements, power ?? EMPTY_POWER), [placements, power])

  // A shared material can't carry per-instance emissive, so group strips by color.
  const byColor = useMemo(() => {
    const groups = new Map<string, RoomPduStrip[]>()
    for (const s of strips) {
      const g = groups.get(s.color)
      if (g) g.push(s)
      else groups.set(s.color, [s])
    }
    return [...groups.entries()]
  }, [strips])

  return (
    <>
      {byColor.map(([color, group]) => (
        <Instances key={color} limit={group.length} raycast={() => null}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} toneMapped={false} />
          {group.map((s, i) => (
            <Instance key={i} position={s.position} scale={s.scale} />
          ))}
        </Instances>
      ))}
      {nodes.map((n, i) => {
        const selected = selectedPanel === n.name
        const dim = selectedPanel != null && !selected
        return (
          <group key={`panel-${i}`}>
            <mesh
              position={n.position}
              onClick={(e) => {
                e.stopPropagation()
                onPanelClick?.(n.name)
              }}
              onPointerOver={(e) => {
                e.stopPropagation()
                document.body.style.cursor = 'pointer'
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'auto'
              }}
            >
              <boxGeometry args={[0.5, 1, 0.5]} />
              <meshStandardMaterial
                color={n.color}
                emissive={n.color}
                emissiveIntensity={selected ? 1 : 0.5}
                toneMapped={false}
                transparent
                opacity={dim ? 0.3 : 1}
              />
            </mesh>
            <Billboard position={[n.position[0], n.position[1] + 0.8, n.position[2]]}>
              <Text
                fontSize={0.4}
                color={selected ? theme.text.primary : theme.text.secondary}
                anchorX="center"
                anchorY="bottom"
                fillOpacity={dim ? 0.4 : 1}
              >
                {n.name}
              </Text>
            </Billboard>
          </group>
        )
      })}
    </>
  )
}
