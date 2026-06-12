import type { Vec3 } from './types'

const DEG = Math.PI / 180

/**
 * Project geographic coordinates onto a Y-up sphere.
 * North pole → +Y; longitudes rotate around Y.
 */
export function latLonToVector3(lat: number, lon: number, radius = 1): Vec3 {
  const phi = (90 - lat) * DEG
  const theta = (lon + 180) * DEG
  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  }
}

export interface ArcOptions {
  radius: number
  segments: number
  /** Peak height of the arc above the sphere, as a fraction of radius. */
  lift: number
}

/**
 * Great-circle arc between two geographic points, lifted off the sphere
 * with a sine profile so endpoints touch the surface and the midpoint peaks.
 */
export function greatCircleArc(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
  { radius, segments, lift }: ArcOptions,
): Vec3[] {
  const a = latLonToVector3(latA, lonA, 1)
  const b = latLonToVector3(latB, lonB, 1)

  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z))
  const omega = Math.acos(dot)
  const sinOmega = Math.sin(omega)

  const points: Vec3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    // slerp; fall back to lerp when the points are (nearly) coincident
    let wa: number, wb: number
    if (sinOmega < 1e-6) {
      wa = 1 - t
      wb = t
    } else {
      wa = Math.sin((1 - t) * omega) / sinOmega
      wb = Math.sin(t * omega) / sinOmega
    }
    const x = wa * a.x + wb * b.x
    const y = wa * a.y + wb * b.y
    const z = wa * a.z + wb * b.z
    const m = Math.hypot(x, y, z) || 1
    const r = radius * (1 + lift * Math.sin(t * Math.PI))
    points.push({ x: (x / m) * r, y: (y / m) * r, z: (z / m) * r })
  }
  return points
}
