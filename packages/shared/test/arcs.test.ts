import { describe, expect, test } from 'vitest'
import { greatCircleArc, latLonToVector3 } from '../src/geo'
import { groupCircuitsBySitePair } from '../src/circuits'

const mag = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z)

describe('greatCircleArc', () => {
  const A = { lat: 52.3, lon: 4.9 } // ams
  const B = { lat: 48.8, lon: 2.3 } // paris

  test('returns segments+1 points', () => {
    const pts = greatCircleArc(A.lat, A.lon, B.lat, B.lon, { radius: 1, segments: 32, lift: 0.1 })
    expect(pts).toHaveLength(33)
  })

  test('endpoints sit on the sphere surface', () => {
    const pts = greatCircleArc(A.lat, A.lon, B.lat, B.lon, { radius: 2, segments: 16, lift: 0.2 })
    expect(mag(pts[0]!)).toBeCloseTo(2, 5)
    expect(mag(pts[16]!)).toBeCloseTo(2, 5)
  })

  test('endpoints match latLonToVector3 of each site', () => {
    const pts = greatCircleArc(A.lat, A.lon, B.lat, B.lon, { radius: 2, segments: 16, lift: 0.2 })
    const a = latLonToVector3(A.lat, A.lon, 2)
    expect(pts[0]!.x).toBeCloseTo(a.x, 5)
    expect(pts[0]!.y).toBeCloseTo(a.y, 5)
    expect(pts[0]!.z).toBeCloseTo(a.z, 5)
  })

  test('midpoint is lifted above the sphere', () => {
    const pts = greatCircleArc(A.lat, A.lon, B.lat, B.lon, { radius: 2, segments: 16, lift: 0.2 })
    expect(mag(pts[8]!)).toBeGreaterThan(2.05)
  })

  test('all points stay between radius and radius*(1+lift)', () => {
    const pts = greatCircleArc(A.lat, A.lon, B.lat, B.lon, { radius: 2, segments: 32, lift: 0.15 })
    for (const p of pts) {
      expect(mag(p)).toBeGreaterThanOrEqual(2 - 1e-6)
      expect(mag(p)).toBeLessThanOrEqual(2 * 1.15 + 1e-6)
    }
  })

  test('antipodal-safe: works for nearly identical points', () => {
    const pts = greatCircleArc(50, 4, 50.0001, 4.0001, { radius: 1, segments: 8, lift: 0.1 })
    expect(pts).toHaveLength(9)
    for (const p of pts) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
  })
})

describe('groupCircuitsBySitePair', () => {
  const detail = { commitRate: null, status: 'active', description: null }
  const circuits = [
    { id: '1', cid: 'c1', provider: 'apo', siteA: 'pa3', siteZ: 'par1', ...detail },
    { id: '2', cid: 'c2', provider: 'apo', siteA: 'par1', siteZ: 'pa3', ...detail }, // reversed = same pair
    { id: '3', cid: 'c3', provider: 'x', siteA: 'ams', siteZ: 'als', ...detail },
    { id: '4', cid: 'c4', provider: 'x', siteA: 'lon', siteZ: 'lon', ...detail }, // same-site: dropped
  ]

  test('groups regardless of A/Z direction', () => {
    const groups = groupCircuitsBySitePair(circuits)
    const pa = groups.find((g) => g.siteA === 'pa3' && g.siteZ === 'par1')
    expect(pa?.count).toBe(2)
    expect(pa?.circuitIds).toEqual(['1', '2'])
  })

  test('drops same-site circuits and keeps distinct pairs separate', () => {
    const groups = groupCircuitsBySitePair(circuits)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => `${g.siteA}|${g.siteZ}`)).toContain('als|ams')
  })

  test('pair key is sorted alphabetically for stability', () => {
    const groups = groupCircuitsBySitePair(circuits)
    for (const g of groups) expect(g.siteA < g.siteZ).toBe(true)
  })
})
