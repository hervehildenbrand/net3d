import { describe, expect, test } from 'vitest'
import {
  fitView,
  scaleOf,
  zoomAt,
  panBy,
  revealBox,
  wheelFactor,
  glyphLabelsVisible,
  type Box,
  type Size,
  type Insets,
} from './viewBox'

// ─────────────────────────────────────────────────────────────────────────────
// fitView
// ─────────────────────────────────────────────────────────────────────────────

describe('fitView', () => {
  test('test_fitView_wideContent_fitsWidthCentredInInsets', () => {
    // Wide content (1200 × 400) in a 1000 × 800 viewport with insets
    const content: Box = { x: 0, y: 0, w: 1200, h: 400 }
    const viewport: Size = { w: 1000, h: 800 }
    const insets: Insets = { top: 100, right: 100, bottom: 100, left: 100 }
    // Available area: 800 × 600
    // Content aspect: 3:1, available aspect: 4:3
    // Fit by width: scale = 800/1200 = 0.666..., viewW = 1200, viewH = 1200 * 600/800 = 900
    const view = fitView(content, viewport, insets)

    // The view should be centred on the content
    const contentCenterX = content.x + content.w / 2
    const contentCenterY = content.y + content.h / 2
    const viewCenterX = view.x + view.w / 2
    const viewCenterY = view.y + view.h / 2

    expect(viewCenterX).toBeCloseTo(contentCenterX, 5)
    expect(viewCenterY).toBeCloseTo(contentCenterY, 5)

    // Scale should be viewport.w / view.w = 1000 / view.w
    // Check the content fits
    expect(view.w).toBeGreaterThanOrEqual(content.w)
  })

  test('test_fitView_tallContent_fitsHeight', () => {
    // Tall content (400 × 1200) in a 1000 × 800 viewport, no insets
    const content: Box = { x: 0, y: 0, w: 400, h: 1200 }
    const viewport: Size = { w: 1000, h: 800 }
    const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
    const view = fitView(content, viewport, insets)

    // viewBox maintains viewport aspect (1000:800 = 5:4)
    expect(view.w / view.h).toBeCloseTo(viewport.w / viewport.h, 5)
    // Fit by height: viewH should equal content.h, content is centred
    expect(view.h).toBeCloseTo(content.h, 5)
  })

  test('test_fitView_emptyContent_finiteView', () => {
    // Zero-size content should give a finite view (treated as 1×1)
    const content: Box = { x: 50, y: 50, w: 0, h: 0 }
    const viewport: Size = { w: 800, h: 600 }
    const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
    const view = fitView(content, viewport, insets)

    expect(Number.isFinite(view.x)).toBe(true)
    expect(Number.isFinite(view.y)).toBe(true)
    expect(Number.isFinite(view.w)).toBe(true)
    expect(Number.isFinite(view.h)).toBe(true)
    expect(view.w).toBeGreaterThan(0)
    expect(view.h).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// scaleOf
// ─────────────────────────────────────────────────────────────────────────────

describe('scaleOf', () => {
  test('test_scaleOf_fittedView_equalsFitScale', () => {
    const content: Box = { x: 0, y: 0, w: 800, h: 600 }
    const viewport: Size = { w: 1600, h: 1200 }
    const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
    const view = fitView(content, viewport, insets)
    const scale = scaleOf(view, viewport)

    // scale = viewport.w / view.w
    expect(scale).toBeCloseTo(viewport.w / view.w, 5)
    // For 2:1 viewport-to-content, scale should be 2
    expect(scale).toBeCloseTo(2, 5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// zoomAt
// ─────────────────────────────────────────────────────────────────────────────

describe('zoomAt', () => {
  test('test_zoomAt_cursorPoint_staysUnderCursor', () => {
    // View 0,0,100,100 in 200×200 viewport → scale 2
    // Cursor at viewport (100, 100) = view center (50, 50)
    // Zoom in by 2x should keep that point under cursor
    const view: Box = { x: 0, y: 0, w: 100, h: 100 }
    const viewport: Size = { w: 200, h: 200 }
    const factor = 2
    const px = 100
    const py = 100 // viewport center
    const zoomed = zoomAt(view, viewport, factor, px, py, 0.1, 20)

    // The view should shrink by factor 2 (zoom in)
    expect(zoomed.w).toBeCloseTo(50, 5)
    expect(zoomed.h).toBeCloseTo(50, 5)

    // The cursor point in the new view should be at the same spot
    // Old: viewX + (px/viewport.w)*view.w = 0 + 0.5*100 = 50
    // New: zoomedX + (px/viewport.w)*zoomed.w should equal 50
    const oldViewX = view.x + (px / viewport.w) * view.w
    const newViewX = zoomed.x + (px / viewport.w) * zoomed.w
    expect(newViewX).toBeCloseTo(oldViewX, 5)

    const oldViewY = view.y + (py / viewport.h) * view.h
    const newViewY = zoomed.y + (py / viewport.h) * zoomed.h
    expect(newViewY).toBeCloseTo(oldViewY, 5)
  })

  test('test_zoomAt_beyondMax_clampedToMax', () => {
    const view: Box = { x: 0, y: 0, w: 100, h: 100 }
    const viewport: Size = { w: 1000, h: 1000 }
    // Current scale = 10, maxScale = 12, try to zoom by factor 2
    const zoomed = zoomAt(view, viewport, 2, 500, 500, 0.1, 12)
    const scale = scaleOf(zoomed, viewport)
    expect(scale).toBeLessThanOrEqual(12)
  })

  test('test_zoomAt_belowMin_clampedToMin', () => {
    const view: Box = { x: 0, y: 0, w: 10, h: 10 }
    const viewport: Size = { w: 100, h: 100 }
    // Current scale = 10, minScale = 5, try to zoom out by 0.1
    const zoomed = zoomAt(view, viewport, 0.1, 50, 50, 5, 100)
    const scale = scaleOf(zoomed, viewport)
    expect(scale).toBeGreaterThanOrEqual(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// panBy
// ─────────────────────────────────────────────────────────────────────────────

describe('panBy', () => {
  test('test_panBy_dragRightDown_viewMovesLeftUp', () => {
    // When dragging right/down in viewport, the view should move left/up
    const view: Box = { x: 0, y: 0, w: 100, h: 100 }
    const viewport: Size = { w: 200, h: 200 }
    // scale = 2: 1 viewport px = 0.5 view units
    // Drag right 20px, down 10px
    const panned = panBy(view, viewport, 20, 10)

    // View should move left/up: x decreases, y decreases
    expect(panned.x).toBeLessThan(view.x)
    expect(panned.y).toBeLessThan(view.y)
    // By how much? dx/scale = 20/2 = 10, dy/scale = 10/2 = 5
    expect(panned.x).toBeCloseTo(-10, 5)
    expect(panned.y).toBeCloseTo(-5, 5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// revealBox
// ─────────────────────────────────────────────────────────────────────────────

describe('revealBox', () => {
  test('test_revealBox_targetBelowViewport_pansJustEnough', () => {
    // View shows 0-100 units, viewport 0-200px (scale 2)
    // Target box is below the visible area
    const view: Box = { x: 0, y: 0, w: 100, h: 100 }
    const viewport: Size = { w: 200, h: 200 }
    const target: Box = { x: 20, y: 110, w: 20, h: 20 } // Below visible
    const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

    const revealed = revealBox(view, viewport, target, insets)

    // The revealed view should include the target
    expect(revealed.y).toBeLessThanOrEqual(target.y)
    expect(revealed.y + revealed.h).toBeGreaterThanOrEqual(target.y + target.h)
    // Scale/size unchanged
    expect(revealed.w).toBeCloseTo(view.w, 5)
    expect(revealed.h).toBeCloseTo(view.h, 5)
  })

  test('test_revealBox_targetVisible_viewUnchanged', () => {
    const view: Box = { x: 0, y: 0, w: 100, h: 100 }
    const viewport: Size = { w: 200, h: 200 }
    const target: Box = { x: 20, y: 20, w: 20, h: 20 } // Already visible
    const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

    const revealed = revealBox(view, viewport, target, insets)

    expect(revealed.x).toBeCloseTo(view.x, 5)
    expect(revealed.y).toBeCloseTo(view.y, 5)
    expect(revealed.w).toBeCloseTo(view.w, 5)
    expect(revealed.h).toBeCloseTo(view.h, 5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// wheelFactor
// ─────────────────────────────────────────────────────────────────────────────

describe('wheelFactor', () => {
  test('test_wheelFactor_scrollDown_zoomsOut', () => {
    // Positive deltaY = scroll down = zoom out (factor < 1)
    const factor = wheelFactor(100, 0)
    expect(factor).toBeLessThan(1)
  })

  test('test_wheelFactor_scrollUp_zoomsIn', () => {
    // Negative deltaY = scroll up = zoom in (factor > 1)
    const factor = wheelFactor(-100, 0)
    expect(factor).toBeGreaterThan(1)
  })

  test('test_wheelFactor_lineMode_scaledBy16', () => {
    // deltaMode 1 (line) should scale deltaY by 16
    const pixelFactor = wheelFactor(10, 0)
    const lineFactor = wheelFactor(10, 1)
    // lineFactor should zoom out more (smaller)
    expect(lineFactor).toBeLessThan(pixelFactor)
    // exp(-dy*k*16) vs exp(-dy*k): log ratio = 16
    expect(Math.log(lineFactor) / Math.log(pixelFactor)).toBeCloseTo(16, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// glyphLabelsVisible
// ─────────────────────────────────────────────────────────────────────────────

describe('glyphLabelsVisible', () => {
  test('test_glyphLabelsVisible_atFit_false', () => {
    // At fit scale (~0.96 for AMS1), labels should not be visible
    expect(glyphLabelsVisible(0.8)).toBe(false)
    expect(glyphLabelsVisible(0.89)).toBe(false)
  })

  test('test_glyphLabelsVisible_scaleOver0_9_true', () => {
    expect(glyphLabelsVisible(0.9)).toBe(true)
    expect(glyphLabelsVisible(1.0)).toBe(true)
    expect(glyphLabelsVisible(2.0)).toBe(true)
  })
})
