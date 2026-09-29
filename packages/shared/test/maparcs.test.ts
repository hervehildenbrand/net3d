import { describe, expect, test } from 'vitest'
import { computeMapBounds, greatCircleLatLngs, wrapLng, splitAtAntimeridian } from '../src/maparcs'

describe('computeMapBounds', () => {
  test('no geocoded sites falls back to world bounds', () => {
    const b = computeMapBounds([{ latitude: null, longitude: null }])
    expect(b).toEqual({ south: -60, west: -170, north: 75, east: 170 })
  })

  test('single site gets a padded box around it', () => {
    const b = computeMapBounds([{ latitude: 52.3, longitude: 4.9 }])
    expect(b.south).toBeLessThan(52.3)
    expect(b.north).toBeGreaterThan(52.3)
    expect(b.west).toBeLessThan(4.9)
    expect(b.east).toBeGreaterThan(4.9)
  })

  test('multiple sites are all inside the bounds', () => {
    const sites = [
      { latitude: 52.3, longitude: 4.9 },
      { latitude: 48.8, longitude: 2.3 },
      { latitude: null, longitude: null },
      { latitude: 40.7, longitude: -74.0 },
    ]
    const b = computeMapBounds(sites)
    for (const s of sites) {
      if (s.latitude === null) continue
      expect(s.latitude).toBeGreaterThan(b.south)
      expect(s.latitude).toBeLessThan(b.north)
      expect(s.longitude!).toBeGreaterThan(b.west)
      expect(s.longitude!).toBeLessThan(b.east)
    }
  })
})

describe('greatCircleLatLngs', () => {
  test('returns segments+1 points starting and ending at the inputs', () => {
    const pts = greatCircleLatLngs(52.3, 4.9, 48.8, 2.3, 16)
    expect(pts).toHaveLength(17)
    expect(pts[0]![0]).toBeCloseTo(52.3, 4)
    expect(pts[0]![1]).toBeCloseTo(4.9, 4)
    expect(pts[16]![0]).toBeCloseTo(48.8, 4)
    expect(pts[16]![1]).toBeCloseTo(2.3, 4)
  })

  test('long east-west hop bows toward the pole (great-circle, not straight)', () => {
    // Paris -> New York: the great circle passes well north of the rhumb line
    const pts = greatCircleLatLngs(48.8, 2.3, 40.7, -74.0, 32)
    const maxLat = Math.max(...pts.map((p) => p[0]))
    expect(maxLat).toBeGreaterThan(50)
  })

  test('keeps longitudes continuous across the antimeridian', () => {
    // Tokyo -> San Francisco crosses 180°; Leaflet needs monotonic lngs, not a ±360 jump
    const pts = greatCircleLatLngs(35.7, 139.7, 37.8, -122.4, 32)
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i]![1] - pts[i - 1]![1])).toBeLessThan(30)
    }
  })

  test('coincident points produce a constant line without NaN', () => {
    const pts = greatCircleLatLngs(50, 4, 50, 4, 8)
    for (const p of pts) {
      expect(Number.isFinite(p[0])).toBe(true)
      expect(Number.isFinite(p[1])).toBe(true)
    }
  })
})

describe('wrapLng', () => {
  test('test_wrapLng_outsideRange_wrapsIntoMinus180To180', () => {
    // Positive wrapping
    expect(wrapLng(200)).toBeCloseTo(-160, 9)
    expect(wrapLng(360)).toBeCloseTo(0, 9)
    expect(wrapLng(540)).toBeCloseTo(-180, 9) // maps into [-180, 180), so 180 becomes -180
    // Negative wrapping
    expect(wrapLng(-200)).toBeCloseTo(160, 9)
    expect(wrapLng(-360)).toBeCloseTo(0, 9)
    expect(wrapLng(-540)).toBeCloseTo(-180, 9)
    // Already in range
    expect(wrapLng(0)).toBeCloseTo(0, 9)
    expect(wrapLng(90)).toBeCloseTo(90, 9)
    expect(wrapLng(-90)).toBeCloseTo(-90, 9)
    expect(wrapLng(179)).toBeCloseTo(179, 9)
    expect(wrapLng(-179)).toBeCloseTo(-179, 9)
  })
})

describe('splitAtAntimeridian', () => {
  test('test_splitAtAntimeridian_noCrossing_returnsOnePieceUnchanged', () => {
    // Paris to Berlin: no antimeridian crossing
    const pts = greatCircleLatLngs(48.8, 2.3, 52.5, 13.4, 16)
    const pieces = splitAtAntimeridian(pts)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toHaveLength(pts.length)
    // All lngs in range
    for (const p of pieces[0]!) {
      expect(p[1]).toBeGreaterThanOrEqual(-180)
      expect(p[1]).toBeLessThanOrEqual(180)
    }
  })

  test('test_splitAtAntimeridian_eastwardCrossing_piecesMeetAtPlus180ThenMinus180', () => {
    // Tokyo to Los Angeles: crosses antimeridian going east
    const pts = greatCircleLatLngs(35.7, 139.7, 34.0, -118.2, 32)
    const pieces = splitAtAntimeridian(pts)
    expect(pieces.length).toBeGreaterThan(1)
    // First piece ends at +180
    const firstPiece = pieces[0]!
    expect(firstPiece.at(-1)![1]).toBeCloseTo(180, 6)
    // Second piece starts at -180
    const secondPiece = pieces[1]!
    expect(secondPiece[0]![1]).toBeCloseTo(-180, 6)
    // Pieces share latitude at the cut
    expect(firstPiece.at(-1)![0]).toBeCloseTo(secondPiece[0]![0], 9)
  })

  test('test_splitAtAntimeridian_westwardCrossing_piecesMeetAtMinus180ThenPlus180', () => {
    // Los Angeles to Tokyo: crosses antimeridian going west
    const pts = greatCircleLatLngs(34.0, -118.2, 35.7, 139.7, 32)
    const pieces = splitAtAntimeridian(pts)
    expect(pieces.length).toBeGreaterThan(1)
    // First piece ends at -180
    const firstPiece = pieces[0]!
    expect(firstPiece.at(-1)![1]).toBeCloseTo(-180, 6)
    // Second piece starts at +180
    const secondPiece = pieces[1]!
    expect(secondPiece[0]![1]).toBeCloseTo(180, 6)
    // Pieces share latitude at the cut
    expect(firstPiece.at(-1)![0]).toBeCloseTo(secondPiece[0]![0], 9)
  })

  test('test_splitAtAntimeridian_mel1ToMia1GreatCircle_firstPieceStartsAtMel1LastEndsAtMia1', () => {
    // MEL1 (-37.8136, 144.9631) to MIA1 (25.7617, -80.1918) from live /api/sites
    const pts = greatCircleLatLngs(-37.8136, 144.9631, 25.7617, -80.1918, 48)
    const pieces = splitAtAntimeridian(pts)
    // Should split (the unwrapped lng reaches ~280)
    expect(pieces.length).toBeGreaterThan(1)
    // First piece starts at MEL1
    expect(pieces[0]![0]![0]).toBeCloseTo(-37.8136, 9)
    expect(pieces[0]![0]![1]).toBeCloseTo(144.9631, 9)
    // Last piece ends at MIA1
    const lastPiece = pieces.at(-1)!
    expect(lastPiece.at(-1)![0]).toBeCloseTo(25.7617, 9)
    expect(lastPiece.at(-1)![1]).toBeCloseTo(-80.1918, 9)
    // All lngs in range
    for (const piece of pieces) {
      for (const p of piece) {
        expect(p[1]).toBeGreaterThanOrEqual(-180)
        expect(p[1]).toBeLessThanOrEqual(180)
      }
    }
  })
})
