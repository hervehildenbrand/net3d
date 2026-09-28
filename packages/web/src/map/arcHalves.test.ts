import { describe, expect, test } from 'vitest'
import { screenAngleDeg, splitArc } from './arcHalves'

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
