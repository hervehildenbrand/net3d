/**
 * Pure viewBox reducer for SVG pan/zoom.
 * No DOM, no React — just geometry.
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Size {
  w: number
  h: number
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Fit content inside a viewport minus insets, maintaining viewport aspect.
 * Zero-size content is treated as 1×1.
 */
export function fitView(content: Box, viewport: Size, insets: Insets): Box {
  const availW = viewport.w - insets.left - insets.right
  const availH = viewport.h - insets.top - insets.bottom
  const contentW = content.w || 1
  const contentH = content.h || 1

  // Viewport aspect ratio
  const viewportAspect = viewport.w / viewport.h

  // Fit content into available area
  const scaleX = availW / contentW
  const scaleY = availH / contentH
  const fitScale = Math.min(scaleX, scaleY)

  // viewBox dimensions maintain viewport aspect
  const viewW = viewport.w / fitScale
  const viewH = viewW / viewportAspect

  // Centre on content (accounting for insets offset)
  const contentCenterX = content.x + contentW / 2
  const contentCenterY = content.y + contentH / 2

  // Inset offset in view units
  const insetOffsetX = ((insets.left - insets.right) / 2) / fitScale
  const insetOffsetY = ((insets.top - insets.bottom) / 2) / fitScale

  return {
    x: contentCenterX - viewW / 2 - insetOffsetX,
    y: contentCenterY - viewH / 2 - insetOffsetY,
    w: viewW,
    h: viewH,
  }
}

/**
 * Get the scale factor (px per view unit).
 */
export function scaleOf(view: Box, viewport: Size): number {
  return viewport.w / view.w
}

/**
 * Zoom at a viewport point, keeping that point fixed.
 * factor > 1 zooms in, < 1 zooms out.
 * Scale is clamped to [minScale, maxScale].
 */
export function zoomAt(
  view: Box,
  viewport: Size,
  factor: number,
  px: number,
  py: number,
  minScale: number,
  maxScale: number,
): Box {
  const currentScale = scaleOf(view, viewport)
  let newScale = currentScale * factor

  // Clamp scale
  if (newScale < minScale) newScale = minScale
  if (newScale > maxScale) newScale = maxScale

  const newW = viewport.w / newScale
  const newH = viewport.h / newScale

  // Point under cursor in old view coordinates
  const viewX = view.x + (px / viewport.w) * view.w
  const viewY = view.y + (py / viewport.h) * view.h

  // New view origin: keep (viewX, viewY) at (px, py)
  const newX = viewX - (px / viewport.w) * newW
  const newY = viewY - (py / viewport.h) * newH

  return { x: newX, y: newY, w: newW, h: newH }
}

/**
 * Pan by a viewport drag delta.
 * Dragging right/down moves the view left/up.
 */
export function panBy(view: Box, viewport: Size, dx: number, dy: number): Box {
  const scale = scaleOf(view, viewport)
  return {
    x: view.x - dx / scale,
    y: view.y - dy / scale,
    w: view.w,
    h: view.h,
  }
}

/**
 * Pan minimally so the target box is visible inside viewport minus insets.
 * If target is larger than the available area, align top-left.
 */
export function revealBox(view: Box, viewport: Size, target: Box, insets: Insets): Box {
  const scale = scaleOf(view, viewport)

  // Visible area in view coordinates
  const visibleX = view.x + insets.left / scale
  const visibleY = view.y + insets.top / scale
  const visibleW = (viewport.w - insets.left - insets.right) / scale
  const visibleH = (viewport.h - insets.top - insets.bottom) / scale

  let dx = 0
  let dy = 0

  // Horizontal: pan if target is outside visible area
  if (target.x < visibleX) {
    dx = target.x - visibleX
  } else if (target.x + target.w > visibleX + visibleW) {
    dx = target.x + target.w - (visibleX + visibleW)
    // If target is wider than visible, align left
    if (target.w > visibleW) {
      dx = target.x - visibleX
    }
  }

  // Vertical: pan if target is outside visible area
  if (target.y < visibleY) {
    dy = target.y - visibleY
  } else if (target.y + target.h > visibleY + visibleH) {
    dy = target.y + target.h - (visibleY + visibleH)
    // If target is taller than visible, align top
    if (target.h > visibleH) {
      dy = target.y - visibleY
    }
  }

  return {
    x: view.x + dx,
    y: view.y + dy,
    w: view.w,
    h: view.h,
  }
}

/**
 * Compute zoom factor from wheel event.
 * exp(-deltaY * k), with ×16 for deltaMode 1 (line mode).
 */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const k = 0.002
  const multiplier = deltaMode === 1 ? 16 : 1
  return Math.exp(-deltaY * k * multiplier)
}

/**
 * Whether glyph labels should be visible at the given scale.
 * Labels appear when zoomed in enough to read them.
 */
export function glyphLabelsVisible(scale: number): boolean {
  return scale >= 0.9
}
