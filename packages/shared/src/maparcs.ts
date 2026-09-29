const DEG = Math.PI / 180
const RAD = 180 / Math.PI

export interface GeoBounds {
  south: number
  west: number
  north: number
  east: number
}

interface GeoPoint {
  latitude: number | null
  longitude: number | null
}

const WORLD: GeoBounds = { south: -60, west: -170, north: 75, east: 170 }
const PAD_DEG = 1.5

/** Fit bounds around every geocoded site; world view when nothing is geocoded. */
export function computeMapBounds(sites: GeoPoint[]): GeoBounds {
  const pts = sites.filter((s) => s.latitude !== null && s.longitude !== null)
  if (pts.length === 0) return WORLD
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const p of pts) {
    south = Math.min(south, p.latitude!)
    north = Math.max(north, p.latitude!)
    west = Math.min(west, p.longitude!)
    east = Math.max(east, p.longitude!)
  }
  return { south: south - PAD_DEG, north: north + PAD_DEG, west: west - PAD_DEG, east: east + PAD_DEG }
}

/**
 * Great-circle path as [lat, lng] pairs for a Leaflet polyline.
 * Longitudes are unwrapped (may exceed ±180) so the line never jumps
 * across the antimeridian.
 */
export function greatCircleLatLngs(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
  segments: number,
): [number, number][] {
  const toVec = (lat: number, lon: number) => {
    const phi = lat * DEG
    const lam = lon * DEG
    return [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)] as const
  }
  const a = toVec(latA, lonA)
  const b = toVec(latB, lonB)
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const omega = Math.acos(dot)
  const sinOmega = Math.sin(omega)

  const points: [number, number][] = []
  let prevLng: number | null = null
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    let wa: number, wb: number
    if (sinOmega < 1e-9) {
      wa = 1 - t
      wb = t
    } else {
      wa = Math.sin((1 - t) * omega) / sinOmega
      wb = Math.sin(t * omega) / sinOmega
    }
    const x = wa * a[0] + wb * b[0]
    const y = wa * a[1] + wb * b[1]
    const z = wa * a[2] + wb * b[2]
    const lat = Math.atan2(z, Math.hypot(x, y)) * RAD
    let lng = Math.atan2(y, x) * RAD
    if (prevLng !== null) {
      // unwrap: pick the representation closest to the previous point
      while (lng - prevLng > 180) lng -= 360
      while (lng - prevLng < -180) lng += 360
    }
    prevLng = lng
    points.push([lat, lng])
  }
  return points
}

/**
 * Wrap a longitude into the range [-180, 180).
 * ((lng+180) % 360 + 360) % 360 - 180
 */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

/**
 * Split an unwrapped great-circle path at the antimeridian (±180°).
 * Returns an array of pieces, each with all longitudes in [-180, 180].
 * Consecutive pieces share their latitude at the cut.
 */
export function splitAtAntimeridian(points: [number, number][]): [number, number][][] {
  if (points.length === 0) return []

  const pieces: [number, number][][] = []
  let currentPiece: [number, number][] = []

  // Compute the 360-offset k for each point: k = floor((lng + 180) / 360)
  const offsetK = (lng: number) => Math.floor((lng + 180) / 360)

  let prevK: number | null = null

  for (let i = 0; i < points.length; i++) {
    const [lat, lng] = points[i]!
    const k = offsetK(lng)

    if (prevK !== null && k !== prevK) {
      // Antimeridian crossing between points[i-1] and points[i]
      const [lat0, lng0] = points[i - 1]!
      const k0 = prevK
      const k1 = k

      // Boundary longitude: 180 + 360 * min(k0, k1)
      const boundary = 180 + 360 * Math.min(k0, k1)
      // Interpolate: t = (boundary - lng0) / (lng - lng0)
      const t = (boundary - lng0) / (lng - lng0)
      const latAtCut = lat0 + t * (lat - lat0)

      // Close current piece: +180 when going east (lng > lng0), -180 when going west
      const closeLng = lng > lng0 ? 180 : -180
      currentPiece.push([latAtCut, closeLng])
      pieces.push(currentPiece)

      // Start new piece at the opposite edge
      const openLng = -closeLng
      currentPiece = [[latAtCut, openLng]]
    }

    // Add point normalised by its k
    currentPiece.push([lat, lng - 360 * k])
    prevK = k
  }

  if (currentPiece.length > 0) {
    pieces.push(currentPiece)
  }

  return pieces
}
