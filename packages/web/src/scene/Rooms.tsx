import { Billboard, Text } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { LayoutRoom } from '@net3d/shared'

const DEFAULT_ROOM_COLOR = '#0891b2'

/**
 * Translucent floor rectangles for user-drawn rooms/zones, with a centered label.
 * Interactive only in edit mode (and not while drawing a new room) so clicking a
 * zone selects it; otherwise the planes never steal pointer events.
 */
export function Rooms({
  rooms,
  interactive = false,
  selectedId = null,
  onSelect,
}: {
  rooms: LayoutRoom[]
  interactive?: boolean
  selectedId?: string | null
  onSelect?: (id: string) => void
}) {
  return (
    <>
      {rooms.map((r) => {
        const color = r.color ?? DEFAULT_ROOM_COLOR
        const selected = r.id === selectedId
        return (
          <group key={r.id}>
            <mesh
              position={[r.bounds.x, 0.02, r.bounds.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              raycast={interactive ? undefined : () => null}
              onClick={
                interactive
                  ? (e: ThreeEvent<MouseEvent>) => {
                      e.stopPropagation()
                      onSelect?.(r.id)
                    }
                  : undefined
              }
            >
              <planeGeometry args={[r.bounds.width, r.bounds.depth]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={selected ? 0.45 : 0.2}
                depthWrite={false}
              />
            </mesh>
            <Billboard position={[r.bounds.x, 0.55, r.bounds.z]}>
              <Text fontSize={0.3} color={color} anchorX="center" anchorY="middle">
                {r.name}
              </Text>
            </Billboard>
          </group>
        )
      })}
    </>
  )
}
