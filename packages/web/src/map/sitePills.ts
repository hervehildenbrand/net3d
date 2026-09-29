/**
 * Pure site pill builders for the logical map.
 * No leaflet/DOM imports — vitest env is node.
 */
import { naturalCompare, type LogicalGraph, type LogicalNode } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { markerColorsForRole } from './markerColors'
import type { ObstacleBox } from './arcLabels'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Segment pitch: 7 px bar + 1 px white gap. */
export const SEG_PX = 8
/** Pill width. */
export const PILL_W = 10
/** Hit box size (same as physical r16 hit circle). */
export const HIT_PX = 32
/** Zoom level at which labels become permanent. */
export const LABEL_ZOOM = 5

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SitePill {
  site: Site
  routers: LogicalNode[]
}

// ─────────────────────────────────────────────────────────────────────────────
// sitePills
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build site pills from the logical graph.
 * Geocoded sites only; routers = nodes with device && siteName === site.name, sorted by naturalCompare.
 * site: and ext: nodes are excluded.
 * When graph is null or empty, creates plain pills (no router segments) for all geocoded sites.
 *
 * ponytail: every device with an inter-site edge becomes a segment; filter by role if non-router devices appear in production
 */
export function sitePills(graph: LogicalGraph | null, sites: Site[]): Map<string, SitePill> {
  const result = new Map<string, SitePill>()

  // Index geocoded sites by name
  const siteByName = new Map(sites.filter((s) => s.latitude !== null).map((s) => [s.name, s]))

  // No graph: create plain pills for all geocoded sites (logical mode with backbone error)
  if (!graph || graph.nodes.length === 0) {
    for (const site of siteByName.values()) {
      result.set(site.name, { site, routers: [] })
    }
    return result
  }

  // Group routers by site
  const routersBySite = new Map<string, LogicalNode[]>()
  for (const node of graph.nodes) {
    // Exclude site: and ext: nodes
    if (node.id.startsWith('site:') || node.id.startsWith('ext:')) continue
    // Must have device (so it's a real router)
    if (!node.device) continue
    // Must have a site name
    if (!node.siteName) continue
    // Site must be geocoded
    if (!siteByName.has(node.siteName)) continue

    const routers = routersBySite.get(node.siteName) ?? []
    routers.push(node)
    routersBySite.set(node.siteName, routers)
  }

  // Build pills for sites with routers
  for (const [siteName, routers] of routersBySite) {
    const site = siteByName.get(siteName)!
    // Sort by name using naturalCompare
    routers.sort((a, b) => naturalCompare(a.name, b.name))
    result.set(siteName, { site, routers })
  }

  // Add plain pills for geocoded sites without routers in graph
  for (const site of siteByName.values()) {
    if (!result.has(site.name)) {
      result.set(site.name, { site, routers: [] })
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// offsetLatLngPx
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Offset a lat/lng point by dyPx pixels in the y direction at the given zoom level.
 * Uses exact Leaflet EPSG3857 projection.
 * W = 256 * 2^zoom; y = W * (0.5 - ln(tan(π/4 + φ/2)) / 2π) + dy; inverted.
 */
export function offsetLatLngPx(lat: number, lng: number, dyPx: number, zoom: number): [number, number] {
  const W = 256 * Math.pow(2, zoom)
  const phi = lat * (Math.PI / 180)

  // Mercator y coordinate
  const y = W * (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI))

  // Offset
  const newY = y + dyPx

  // Invert: 2 * atan(exp(2π * (0.5 - y/W))) - π/2
  const newPhi = 2 * Math.atan(Math.exp(2 * Math.PI * (0.5 - newY / W))) - Math.PI / 2
  const newLat = newPhi * (180 / Math.PI)

  return [newLat, lng]
}

// ─────────────────────────────────────────────────────────────────────────────
// nodeAnchors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build anchor positions for all router and site: nodes.
 * Router i of n gets offsetLatLngPx(lat, lng, (i - (n-1)/2) * SEG_PX, zoom).
 * site: nodes are anchored at their site centre.
 */
export function nodeAnchors(
  pills: Map<string, SitePill>,
  sites: Site[],
  zoom: number,
): Map<string, [number, number]> {
  const result = new Map<string, [number, number]>()
  const siteByName = new Map(sites.filter((s) => s.latitude !== null).map((s) => [s.name, s]))

  // Add router anchors from pills
  for (const [siteName, pill] of pills) {
    const site = pill.site
    const n = pill.routers.length
    for (let i = 0; i < n; i++) {
      const router = pill.routers[i]!
      const dyPx = (i - (n - 1) / 2) * SEG_PX
      const anchor = offsetLatLngPx(site.latitude!, site.longitude!, dyPx, zoom)
      result.set(router.id, anchor)
    }
  }

  // Add site: node anchors (at site centre)
  for (const [siteName, site] of siteByName) {
    result.set(`site:${siteName}`, [site.latitude!, site.longitude!])
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// shortName
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip the site prefix case-insensitively and the domain from a device name.
 * Returns the host part before the first '.'; strips a `${site}-` prefix.
 */
export function shortName(name: string, site: string): string {
  // Get host part (before first dot)
  const host = name.split('.')[0]!.toLowerCase()

  // Try to strip site prefix case-insensitively
  const sitePrefix = `${site.toLowerCase()}-`
  if (host.startsWith(sitePrefix)) {
    return host.slice(sitePrefix.length)
  }

  return host
}

// ─────────────────────────────────────────────────────────────────────────────
// pillLabelRows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build pill label rows: `core-01 · 16001` style (SID only when SR visible and known).
 */
export function pillLabelRows(pill: SitePill, showSid: boolean): string[] {
  return pill.routers.map((router) => {
    const short = shortName(router.name, pill.site.name)
    if (showSid && router.sid !== null) {
      return `${short} · ${router.sid}`
    }
    return short
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// pillHtml
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build HTML for a site pill: HIT_PX-wide centring box around a flex column of n segments.
 * Includes data-site on the pill and class="lv-seg" data-router on each segment for harness selectors.
 * Includes role="button", tabindex="0", and aria-label for accessibility.
 * Plain pills (no routers) render as a single role-coloured dot.
 */
export function pillHtml(pill: SitePill): string {
  const n = pill.routers.length
  const colors = markerColorsForRole(pill.site.role)

  // Plain pill (no routers): render as a single dot
  if (n === 0) {
    return `<div role="button" tabindex="0" aria-label="${pill.site.name}" data-site="${pill.site.name}" style="width:${HIT_PX}px;height:${HIT_PX}px;display:flex;align-items:center;justify-content:center"><div class="lv-seg" style="width:14px;height:14px;background:${colors.fill};border:2px solid ${colors.color};border-radius:50%"></div></div>`
  }

  const pillHeight = n * SEG_PX
  const containerHeight = Math.max(HIT_PX, pillHeight + 8)

  // Build accessible name: "AMS1 — core-01, core-02"
  const routerShortNames = pill.routers.map((r) => shortName(r.name, pill.site.name))
  const ariaLabel = `${pill.site.name} — ${routerShortNames.join(', ')}`

  const segments = pill.routers.map((router) => {
    return `<div class="lv-seg" data-router="${router.name}" style="width:${PILL_W - 2}px;height:${SEG_PX - 1}px;background:${colors.fill};border:1px solid ${colors.color};border-radius:3px"></div>`
  }).join('')

  return `<div role="button" tabindex="0" aria-label="${ariaLabel}" data-site="${pill.site.name}" style="width:${HIT_PX}px;height:${containerHeight}px;display:flex;align-items:center;justify-content:center"><div style="display:flex;flex-direction:column;gap:0;background:#fff;border-radius:5px;padding:1px;border:1.5px solid #fff">${segments}</div></div>`
}

// ─────────────────────────────────────────────────────────────────────────────
// pillObstacles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build obstacle boxes for pills.
 * Always includes the pill box (PILL_W+4 × n*SEG_PX+4, centred).
 * From zoom LABEL_ZOOM, also includes the label block to the right.
 */
export function pillObstacles(
  pills: Map<string, SitePill>,
  zoom: number,
  showSid: boolean,
): ObstacleBox[] {
  const obstacles: ObstacleBox[] = []

  for (const [siteName, pill] of pills) {
    const site = pill.site
    const n = pill.routers.length
    const at: [number, number] = [site.latitude!, site.longitude!]

    // Pill box (centred)
    const pillW = PILL_W + 4
    const pillH = n * SEG_PX + 4
    obstacles.push({
      at,
      dx: -pillW / 2,
      dy: -pillH / 2,
      w: pillW,
      h: pillH,
    })

    // Label block (from zoom LABEL_ZOOM)
    if (zoom >= LABEL_ZOOM) {
      const rows = pillLabelRows(pill, showSid)
      const maxChars = Math.max(...rows.map((r) => r.length), siteName.length)
      const labelW = 14 + 7 * maxChars
      const labelH = 14 + 13 * (rows.length + 1)
      // Tooltip offset: PILL_W/2 + 2 + 6 (padding)
      const labelDx = PILL_W / 2 + 2 + 6
      obstacles.push({
        at,
        dx: labelDx,
        dy: -labelH / 2,
        w: labelW,
        h: labelH,
      })
    }
  }

  return obstacles
}
