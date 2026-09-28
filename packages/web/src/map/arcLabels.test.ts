import { describe, expect, it } from 'vitest'
import { labelBox, placeSlidingLabels, contrastText, wcagContrast, circlesClearOfBoxes, type SlidingLabel, type LabelBox } from './arcLabels'
import { specsColor } from '../lib/specsHeatmap'
import { theme } from '../theme'

describe('labelBox', () => {
  it('test_labelBox_width_grows_with_text', () => {
    const short = labelBox('short', '1G', 0, 0)
    const long = labelBox('long', '100.0G', 0, 0)
    expect(long.w).toBeGreaterThan(short.w)
  })

  it('test_labelBox_covers_the_painted_pill_plus_margin', () => {
    // Painted in Chrome at 11 px (600-weight value, 400-weight unit): "13.6 Gbps" is 80 px wide, "2 Gbps" 60.3 px.
    expect(labelBox('k', '13.6 Gbps', 0, 0).w).toBeGreaterThanOrEqual(80 + 4)
    expect(labelBox('k', '2 Gbps', 0, 0).w).toBeGreaterThanOrEqual(60.3 + 4)
    // …without wasting space: no more than 6 px slack beyond pill + margin
    expect(labelBox('k', '13.6 Gbps', 0, 0).w).toBeLessThanOrEqual(80 + 4 + 6)
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

describe('placeSlidingLabels', () => {
  const box = (key: string, x: number, y: number, priority: number) =>
    ({ key, x, y, w: 30, h: 20, priority })

  it('test_placeSlidingLabels_first_candidate_free_index_0', () => {
    const labels: SlidingLabel[] = [
      { key: 'a', priority: 10, candidates: [box('a', 0, 0, 10), box('a', 100, 0, 10)] },
    ]
    const result = placeSlidingLabels(labels)
    expect(result.get('a')).toBe(0)
  })

  it('test_placeSlidingLabels_first_on_marker_second_free_index_1', () => {
    const labels: SlidingLabel[] = [
      { key: 'a', priority: 10, candidates: [box('a', 0, 0, 10), box('a', 100, 0, 10)] },
    ]
    const markers = [{ x: 10, y: 10, r: 15 }] // overlaps first candidate
    const result = placeSlidingLabels(labels, markers)
    expect(result.get('a')).toBe(1)
  })

  it('test_placeSlidingLabels_busier_label_claims_spot_other_slides', () => {
    // Both labels want (0,0) as first choice; busy wins that spot, light slides to its second
    const labels: SlidingLabel[] = [
      { key: 'busy', priority: 100, candidates: [box('busy', 0, 0, 100), box('busy', 200, 0, 100)] },
      { key: 'light', priority: 10, candidates: [box('light', 0, 0, 10), box('light', 100, 0, 10)] },
    ]
    const result = placeSlidingLabels(labels)
    expect(result.get('busy')).toBe(0)
    expect(result.get('light')).toBe(1)
  })

  it('test_placeSlidingLabels_no_free_candidate_key_absent', () => {
    const labels: SlidingLabel[] = [
      { key: 'blocked', priority: 10, candidates: [box('blocked', 0, 0, 10)] },
    ]
    const markers = [{ x: 10, y: 10, r: 20 }]
    const result = placeSlidingLabels(labels, markers)
    expect(result.has('blocked')).toBe(false)
  })

  it('test_placeSlidingLabels_ties_keep_input_order', () => {
    // Same priority: first in input order gets placed first
    const labels: SlidingLabel[] = [
      { key: 'first', priority: 50, candidates: [box('first', 0, 0, 50)] },
      { key: 'second', priority: 50, candidates: [box('second', 10, 0, 50)] }, // overlaps first
    ]
    const result = placeSlidingLabels(labels)
    expect(result.get('first')).toBe(0)
    expect(result.has('second')).toBe(false) // all candidates blocked by 'first'
  })
})

describe('circlesClearOfBoxes', () => {
  const mkBox = (x: number, y: number, w = 40, h = 20): LabelBox => ({ key: 'b', x, y, w, h, priority: 0 })
  const mkCircle = (key: string, x: number, y: number, r = 10) => ({ key, x, y, r })

  it('test_circlesClearOfBoxes_inside_box_dropped', () => {
    // Circle center inside the box => dropped
    const boxes = [mkBox(0, 0, 40, 20)]
    const circles = [mkCircle('c1', 20, 10, 5)]
    expect(circlesClearOfBoxes(circles, boxes).has('c1')).toBe(false)
  })

  it('test_circlesClearOfBoxes_touching_edge_within_r_dropped', () => {
    // Box [0,0 -> 40,20]; circle at (45, 10) with r=10 touches right edge within r
    const boxes = [mkBox(0, 0, 40, 20)]
    const circles = [mkCircle('c1', 45, 10, 10)] // dist to box edge = 5, r=10
    expect(circlesClearOfBoxes(circles, boxes).has('c1')).toBe(false)
  })

  it('test_circlesClearOfBoxes_clear_of_all_kept', () => {
    // Box [0,0 -> 40,20]; circle far away at (100, 100) r=5
    const boxes = [mkBox(0, 0, 40, 20)]
    const circles = [mkCircle('c1', 100, 100, 5)]
    expect(circlesClearOfBoxes(circles, boxes).has('c1')).toBe(true)
  })

  it('test_circlesClearOfBoxes_no_boxes_all_kept', () => {
    const circles = [mkCircle('c1', 0, 0, 10), mkCircle('c2', 50, 50, 10)]
    expect(circlesClearOfBoxes(circles, []).size).toBe(2)
  })
})
