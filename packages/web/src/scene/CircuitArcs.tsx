import { useMemo } from 'react'
import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import { greatCircleArc, type CircuitGroup } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { GLOBE_RADIUS } from './GlobeLevel'

const SEGMENTS = 48

/** All inter-DC circuit groups as one batched line-segment geometry. */
export function CircuitArcs({ sites, groups }: { sites: Site[]; groups: CircuitGroup[] }) {
  const geometry = useMemo(() => {
    const byName = new Map(sites.map((s) => [s.name, s]))
    const maxCount = Math.max(1, ...groups.map((g) => g.count))
    const positions: number[] = []
    const colors: number[] = []
    const dim = new Color('#155a78')
    const hot = new Color('#3fd6ff')

    for (const g of groups) {
      const a = byName.get(g.siteA)
      const z = byName.get(g.siteZ)
      if (!a || !z || a.latitude === null || z.latitude === null) continue
      const pts = greatCircleArc(a.latitude, a.longitude!, z.latitude, z.longitude!, {
        radius: GLOBE_RADIUS,
        segments: SEGMENTS,
        lift: 0.06 + 0.05 * (g.count / maxCount),
      })
      const c = dim.clone().lerp(hot, g.count / maxCount)
      for (let i = 0; i < pts.length - 1; i++) {
        positions.push(pts[i]!.x, pts[i]!.y, pts[i]!.z, pts[i + 1]!.x, pts[i + 1]!.y, pts[i + 1]!.z)
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
      }
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return geo
  }, [sites, groups])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.75} />
    </lineSegments>
  )
}
