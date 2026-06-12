import { describe, expect, test } from 'vitest'
import { computeMapBounds, greatCircleLatLngs } from '../src/maparcs'

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
