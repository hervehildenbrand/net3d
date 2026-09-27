import { describe, expect, it } from 'vitest'
import { labelBox, placeLabels } from './arcLabels'

describe('labelBox', () => {
  it('test_labelBox_width_grows_with_text', () => {
    const short = labelBox('short', '1G', 0, 0)
    const long = labelBox('long', '100.0G', 0, 0)
    expect(long.w).toBeGreaterThan(short.w)
  })
})

describe('placeLabels', () => {
  it('test_placeLabels_disjoint_keeps_all', () => {
    // Three boxes far apart should all be kept
    const boxes = [
      { key: 'a', x: 0, y: 0, w: 10, h: 10, priority: 1 },
      { key: 'b', x: 100, y: 0, w: 10, h: 10, priority: 2 },
      { key: 'c', x: 200, y: 0, w: 10, h: 10, priority: 3 },
    ]
    const kept = placeLabels(boxes)
    expect(kept.size).toBe(3)
    expect(kept.has('a')).toBe(true)
    expect(kept.has('b')).toBe(true)
    expect(kept.has('c')).toBe(true)
  })

  it('test_placeLabels_overlap_keeps_busiest', () => {
    // Two overlapping boxes: higher priority wins
    const boxes = [
      { key: 'low', x: 0, y: 0, w: 50, h: 50, priority: 10 },
      { key: 'high', x: 25, y: 25, w: 50, h: 50, priority: 100 },
    ]
    const kept = placeLabels(boxes)
    expect(kept.size).toBe(1)
    expect(kept.has('high')).toBe(true)
    expect(kept.has('low')).toBe(false)
  })

  it('test_placeLabels_drops_box_overlapping_any_kept', () => {
    // A middle-priority box overlaps the highest, so it's dropped even if it doesn't overlap the lowest
    const boxes = [
      { key: 'high', x: 0, y: 0, w: 30, h: 30, priority: 100 },
      { key: 'mid', x: 20, y: 20, w: 30, h: 30, priority: 50 },    // overlaps high
      { key: 'low', x: 200, y: 0, w: 30, h: 30, priority: 10 },   // far away, no overlap
    ]
    const kept = placeLabels(boxes)
    expect(kept.size).toBe(2)
    expect(kept.has('high')).toBe(true)
    expect(kept.has('low')).toBe(true)
    expect(kept.has('mid')).toBe(false)
  })
})
