import { describe, expect, test } from 'vitest'
import { halfCandidates, screenAngleDeg, showArrows, splitArc, spreadPoints } from './arcHalves'

describe('splitArc', () => {
  test('test_splitArc_halves_meet_at_the_middle_point', () => {
    const pts = Array.from({ length: 49 }, (_, i) => i)
    const h = splitArc(pts)
    expect(h.a).toEqual(pts.slice(0, 25))
    expect(h.z).toEqual(pts.slice(24))
    expect(h.mid).toBe(24)
  })

  test('test_splitArc_labels_sit_in_the_middle_of_each_half', () => {
    const h = splitArc(Array.from({ length: 49 }, (_, i) => i))
    expect(h.aLabel).toBe(12)
    expect(h.zLabel).toBe(36)
  })
})

describe('screenAngleDeg', () => {
  test('test_screenAngleDeg_follows_screen_axes', () => {
    expect(screenAngleDeg({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0)
    expect(screenAngleDeg({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(90) // screen y grows downward
    expect(screenAngleDeg({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe(180)
  })
})

describe('showArrows', () => {
  test('test_showArrows_long_arc_clear_of_sites_returns_true', () => {
    const a = { x: 0, y: 0 }
    const z = { x: 100, y: 0 }
    const mid = { x: 50, y: 0 }
    expect(showArrows(a, z, mid, [])).toBe(true)
  })

  test('test_showArrows_short_arc_returns_false', () => {
    const a = { x: 0, y: 0 }
    const z = { x: 50, y: 0 } // 50px, below default 60px threshold
    const mid = { x: 25, y: 0 }
    expect(showArrows(a, z, mid, [])).toBe(false)
  })

  test('test_showArrows_midpoint_inside_site_circle_returns_false', () => {
    const a = { x: 0, y: 0 }
    const z = { x: 100, y: 0 }
    const mid = { x: 50, y: 0 }
    const sites = [{ x: 50, y: 5, r: 10 }] // mid is within 10px of (50,5)
    expect(showArrows(a, z, mid, sites)).toBe(false)
  })

  test('test_showArrows_midpoint_outside_all_site_circles_returns_true', () => {
    const a = { x: 0, y: 0 }
    const z = { x: 100, y: 0 }
    const mid = { x: 50, y: 0 }
    const sites = [{ x: 50, y: 50, r: 10 }] // mid is 50px from site center, outside r=10
    expect(showArrows(a, z, mid, sites)).toBe(true)
  })

  test('test_showArrows_custom_minLenPx', () => {
    const a = { x: 0, y: 0 }
    const z = { x: 40, y: 0 }
    const mid = { x: 20, y: 0 }
    expect(showArrows(a, z, mid, [], 40)).toBe(true) // exactly at threshold
    expect(showArrows(a, z, mid, [], 41)).toBe(false) // below threshold
  })
})

describe('spreadPoints', () => {
  test('test_spreadPoints_keeps_the_busier_of_two_close_points', () => {
    const points = [
      { key: 'low', x: 0, y: 0, priority: 100 },
      { key: 'high', x: 5, y: 0, priority: 200 }, // within 10px of low, but higher priority
    ]
    const kept = spreadPoints(points, 10)
    expect(kept.has('high')).toBe(true)
    expect(kept.has('low')).toBe(false)
  })

  test('test_spreadPoints_keeps_points_farther_apart_than_the_spacing', () => {
    const points = [
      { key: 'a', x: 0, y: 0, priority: 100 },
      { key: 'b', x: 15, y: 0, priority: 50 }, // 15px apart, threshold is 10
    ]
    const kept = spreadPoints(points, 10)
    expect(kept.has('a')).toBe(true)
    expect(kept.has('b')).toBe(true)
  })

  test('test_spreadPoints_ties_keep_the_first_point', () => {
    const points = [
      { key: 'first', x: 0, y: 0, priority: 100 },
      { key: 'second', x: 5, y: 0, priority: 100 }, // same priority, within threshold
    ]
    const kept = spreadPoints(points, 10)
    expect(kept.has('first')).toBe(true)
    expect(kept.has('second')).toBe(false)
  })
})

describe('halfCandidates', () => {
  test('test_halfCandidates_A_half_starts_at_middle_alternates_toward_ends', () => {
    // A half is 0..24 (midAt = to = 24), middle interior is 12
    const result = halfCandidates(0, 24, 24)
    expect(result.slice(0, 6)).toEqual([12, 13, 11, 14, 10, 15])
    // Should contain exactly indices 1..23 (interior points, not endpoints)
    expect(result.sort((a, b) => a - b)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1))
  })

  test('test_halfCandidates_Z_half_prefers_toward_midpoint_on_tie', () => {
    // Z half is 24..48 (midAt = from = 24), middle interior is 36
    const result = halfCandidates(24, 48, 24)
    // First is 36, then alternate but prefer toward 24 (smaller indices)
    expect(result.slice(0, 4)).toEqual([36, 35, 37, 34])
    // Should contain exactly 25..47
    expect(result.sort((a, b) => a - b)).toEqual(Array.from({ length: 23 }, (_, i) => i + 25))
  })

  test('test_halfCandidates_short_half_single_interior', () => {
    // Half is 0..2, only interior point is 1
    expect(halfCandidates(0, 2, 2)).toEqual([1])
  })

  test('test_halfCandidates_too_short_empty', () => {
    // Half is 0..1, no interior points
    expect(halfCandidates(0, 1, 1)).toEqual([])
  })
})
