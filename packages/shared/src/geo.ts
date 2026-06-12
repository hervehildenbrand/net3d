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
