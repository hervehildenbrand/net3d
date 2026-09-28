import { describe, expect, it } from 'vitest'
import { labelBox, placeLabels, contrastText, wcagContrast } from './arcLabels'
import { specsColor } from '../lib/specsHeatmap'
import { theme } from '../theme'

describe('labelBox', () => {
  it('test_labelBox_width_grows_with_text', () => {
    const short = labelBox('short', '1G', 0, 0)
    const long = labelBox('long', '100.0G', 0, 0)
    expect(long.w).toBeGreaterThan(short.w)
  })

  it('test_labelBox_is_center_anchored', () => {
    // Box at (100, 50) should have x/y offset so the center is at 100,50
    const box = labelBox('k', '10G', 100, 50)
    // Center of box: x + w/2, y + h/2 should equal the input coords
    expect(box.x + box.w / 2).toBeCloseTo(100, 1)
    expect(box.y + box.h / 2).toBeCloseTo(50, 1)
  })
})

describe('contrastText', () => {
  it('test_contrastText_dark_on_yellow', () => {
    // Yellow is bright, needs dark (black) text
    expect(contrastText('#facc15')).toBe('#000000')
  })

  it('test_contrastText_white_on_blue', () => {
    // Blue is dark, needs white text
    expect(contrastText('#2563eb')).toBe('#ffffff')
  })

  it('test_contrastText_white_on_red', () => {
    // Red is dark, needs white text
    expect(contrastText('#dc2626')).toBe('#ffffff')
  })

  it('test_contrastText_white_on_grey', () => {
    // Grey (stale) is dark, needs white text
    expect(contrastText('#475569')).toBe('#ffffff')
  })

  it('test_contrastText_meets_wcag_aa_across_entire_ramp', () => {
    // Sample utilColor ramp from 0% to 100% plus stale grey and cable.up
    let worstRatio = Infinity

    // Iterate integers to guarantee t=1 is hit (float accumulation skips it)
    for (let i = 0; i <= 100; i++) {
      const t = i / 100
      const bg = specsColor(t, 0, 1)
      const text = contrastText(bg)
      const ratio = wcagContrast(bg, text)
      if (ratio < worstRatio) worstRatio = ratio
      expect(ratio, `t=${t} bg=${bg} text=${text}`).toBeGreaterThanOrEqual(4.5)
    }

    // Special cases: stale grey and up green
    for (const bg of [theme.heatmap.noData, theme.cable.up]) {
      const text = contrastText(bg)
      const ratio = wcagContrast(bg, text)
      if (ratio < worstRatio) worstRatio = ratio
      expect(ratio, `special bg=${bg} text=${text}`).toBeGreaterThanOrEqual(4.5)
    }

    // Worst ratio across entire ramp still meets AA
    expect(worstRatio).toBeGreaterThanOrEqual(4.5)
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

  it('test_placeLabels_avoids_markers', () => {
    // A box over a marker is dropped
    const boxes = [
      { key: 'a', x: 0, y: 0, w: 30, h: 30, priority: 100 },   // over marker
      { key: 'b', x: 200, y: 0, w: 30, h: 30, priority: 50 },  // clear
    ]
    const markers = [{ x: 10, y: 10, r: 12 }] // marker at (10,10) radius 12
    const kept = placeLabels(boxes, markers)
    expect(kept.has('a')).toBe(false) // dropped, over marker
    expect(kept.has('b')).toBe(true)
  })
})
