import { Billboard, Line, Text } from '@react-three/drei'
import { bearingToGroundOffset, speedBucketToWidth, type SpeedBucket } from '@net3d/shared'
import { theme } from '../theme'

export interface DcLink {
  /** Name of the peer site at the far end of the circuit group. */
  peerName: string
  /** Number of circuits in the group. */
  count: number
  /** Top capacity bucket of the group — drives line width. */
  bucket: SpeedBucket
  /** Compass bearing (deg, from north) this site → peer; null when coords are missing. */
  bearingDeg: number | null
}

/**
 * Site-view inter-DC links: a labelled line per peer site radiating from the
 * building roof toward that peer's geographic bearing. Mirrors the global-map
 * circuit lines so links are legible without zooming back out. Non-interactive.
 */
export function SiteDcLinks({
  links,
  center,
  topY,
  radius,
}: {
  links: DcLink[]
  center: { x: number; z: number }
  topY: number
  radius: number
}) {
  const start: [number, number, number] = [center.x, topY, center.z]
  return (
    <>
      {links.map((l, i) => {
        // Fall back to an even fan when a coordinate is missing, so the link is
        // still shown (just not geographically placed).
        const bearing = l.bearingDeg ?? (links.length ? (i / links.length) * 360 : 0)
        const off = bearingToGroundOffset(bearing, radius)
        const end: [number, number, number] = [center.x + off.x, topY, center.z + off.z]
        return (
          <group key={l.peerName}>
            <Line
              points={[start, end]}
              color={theme.map.circuit}
              lineWidth={Math.max(speedBucketToWidth(l.bucket), 2)}
              transparent
              opacity={0.85}
              raycast={() => null}
            />
            <mesh position={end} raycast={() => null}>
              <sphereGeometry args={[0.15, 12, 12]} />
              <meshBasicMaterial color={theme.map.circuit} toneMapped={false} />
            </mesh>
            <Billboard position={[end[0], end[1] + 0.35, end[2]]}>
              <Text fontSize={0.32} color={theme.text.secondary} anchorX="center" anchorY="bottom">
                {`→ ${l.peerName} (${l.count})`}
              </Text>
            </Billboard>
          </group>
        )
      })}
    </>
  )
}
