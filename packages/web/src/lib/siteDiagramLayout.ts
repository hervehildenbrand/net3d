/**
 * Pure site diagram layout for the 2D SVG view.
 * No three.js, no React — just geometry.
 */
import {
  naturalCompare,
  classifyTier,
  type LogicalGraph,
  type LogicalEdge,
  type Tier,
} from '@net3d/shared'
import type { RackInput } from './siteDiagramFixture'
import type { Box } from './viewBox'

// ─────────────────────────────────────────────────────────────────────────────
// Constants (user units; ~1 px at AMS1 fit)
// ─────────────────────────────────────────────────────────────────────────────

export const PEER_Y = 0
export const CORE_Y = 80
export const SPINE_Y = 160
export const RACKS_Y = 250

export const BAND_PITCH = 100
export const PILL_W = 88
export const PILL_H = 18
export const AGG_GAP = 20

export const COL_W = 52
export const GLYPH_W = 44
export const GLYPH_H = 12
export const GLYPH_PITCH = 16
export const ROW_LABEL_H = 14
export const RACK_LABEL_H = 14
export const CHIP_H = 14
export const ROW_GAP = 28
export const MAX_COLS = 24

export const OVERLAY_ROW_H = 14
export const OVERLAY_NAME_W = 64
export const OVERLAY_LINK_W = 64

export const MARGIN = 16

/** Pseudo-column key for unplaced devices. */
export const OTHER = '\u0000other'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Band = 'peer' | 'core' | 'spine' | 'agg' | 'rack'

export interface Glyph {
  id: string
  x: number
  y: number
  w: number
  h: number
  band: Band
  tier: Tier
  label: string
}

export interface RackColumn {
  key: string
  label: string
  x: number
  y: number
  glyphIds: string[]
  endIds: string[]
  chip: { x: number; y: number } | null
}

export interface RowLabel {
  label: string
  x: number
  y: number
}

export type EdgeKind = 'trunk' | 'uplink' | 'local'

export interface DiagramEdge {
  id: string
  a: string
  b: string
  kind: EdgeKind
  d: string
}

export interface SiteDiagramLayout {
  bounds: Box
  glyphs: Map<string, Glyph>
  columns: RackColumn[]
  rows: RowLabel[]
  edges: DiagramEdge[]
  links: Map<string, { edgeId: string; peer: string }[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Layout a site diagram with bands: peer → core → spine (+ agg) → rack rows.
 */
export function layoutSiteDiagram(
  graph: LogicalGraph,
  racks: RackInput[],
  site: string,
): SiteDiagramLayout {
  const glyphs = new Map<string, Glyph>()
  const columns: RackColumn[] = []
  const rows: RowLabel[] = []
  const links = new Map<string, { edgeId: string; peer: string }[]>()

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1: Build device → rack map
  // ─────────────────────────────────────────────────────────────────────────
  const deviceToRack = new Map<string, RackInput>()
  const rackByName = new Map<string, RackInput>()
  for (const rack of racks) {
    rackByName.set(rack.name, rack)
    for (const d of rack.devices) {
      deviceToRack.set(d.id, rack)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2: Classify racks as network vs column
  // ─────────────────────────────────────────────────────────────────────────
  const networkRacks = new Set<string>()
  for (const rack of racks) {
    for (const d of rack.devices) {
      const tier = classifyTier(d.roleName, false)
      if (tier === 'core' || tier === 'spine') {
        networkRacks.add(rack.name)
        break
      }
    }
  }

  // Column racks: have >=1 device and are not network racks
  const columnRacks = racks
    .filter(r => r.devices.length > 0 && !networkRacks.has(r.name))
    .sort((a, b) => {
      // Sort by location (natural order, null last), then by name
      const locA = a.location ?? '￿'
      const locB = b.location ?? '￿'
      const locCmp = naturalCompare(locA, locB)
      if (locCmp !== 0) return locCmp
      return naturalCompare(a.name, b.name)
    })

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3: Build node tier map and categorize nodes
  // ─────────────────────────────────────────────────────────────────────────
  const nodeTier = new Map<string, Tier>()
  const peers: string[] = []
  const cores: string[] = []
  const spines: string[] = []
  const aggs: string[] = []
  const columnGlyphs: string[] = []
  const endNodes: string[] = []
  const unrackedLeaf: string[] = []

  for (const node of graph.nodes) {
    nodeTier.set(node.id, node.tier)

    if (node.tier === 'remote') {
      peers.push(node.id)
    } else if (node.tier === 'core') {
      cores.push(node.id)
    } else if (node.tier === 'spine') {
      spines.push(node.id)
    } else if (node.tier === 'leaf') {
      // Check if this leaf is in a network rack → agg
      const rack = node.device ? deviceToRack.get(node.device.id) : null
      if (rack && networkRacks.has(rack.name)) {
        aggs.push(node.id)
      } else if (rack) {
        columnGlyphs.push(node.id)
      } else {
        // Unracked leaf
        unrackedLeaf.push(node.id)
      }
    } else if (node.tier === 'end') {
      endNodes.push(node.id)
    }
  }

  // Sort all
  peers.sort(naturalCompare)
  cores.sort(naturalCompare)
  spines.sort(naturalCompare)
  aggs.sort(naturalCompare)
  columnGlyphs.sort(naturalCompare)
  endNodes.sort(naturalCompare)
  unrackedLeaf.sort(naturalCompare)

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 4: Build adjacency map for peer ordering
  // ─────────────────────────────────────────────────────────────────────────
  const adjacency = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, new Set())
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, new Set())
    adjacency.get(edge.a)!.add(edge.b)
    adjacency.get(edge.b)!.add(edge.a)
  }

  // Order peers by their local core neighbour index, then by name
  const coreIndex = new Map(cores.map((c, i) => [c, i]))
  const peerOrder = [...peers].sort((a, b) => {
    const aNeighbours = adjacency.get(a) ?? new Set()
    const bNeighbours = adjacency.get(b) ?? new Set()
    const aCore = [...aNeighbours].find(n => coreIndex.has(n))
    const bCore = [...bNeighbours].find(n => coreIndex.has(n))
    const aIdx = aCore ? coreIndex.get(aCore)! : 999
    const bIdx = bCore ? coreIndex.get(bCore)! : 999
    if (aIdx !== bIdx) return aIdx - bIdx
    return naturalCompare(a, b)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 5: Compute rack area width and center
  // ─────────────────────────────────────────────────────────────────────────
  // Group column racks by location
  const byLocation = new Map<string, RackInput[]>()
  for (const rack of columnRacks) {
    const loc = rack.location ?? '￿'
    if (!byLocation.has(loc)) byLocation.set(loc, [])
    byLocation.get(loc)!.push(rack)
  }

  // Find max columns in any line (accounting for wrap)
  let maxColsInAnyLine = 0
  for (const locRacks of byLocation.values()) {
    const lines = Math.ceil(locRacks.length / MAX_COLS)
    for (let line = 0; line < lines; line++) {
      const start = line * MAX_COLS
      const end = Math.min(start + MAX_COLS, locRacks.length)
      maxColsInAnyLine = Math.max(maxColsInAnyLine, end - start)
    }
  }
  if (maxColsInAnyLine === 0) maxColsInAnyLine = 1

  const rackAreaW = maxColsInAnyLine * COL_W
  const cx = rackAreaW / 2

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 6: Position upper bands (centred on rack area)
  // ─────────────────────────────────────────────────────────────────────────
  // Peers
  const peerCount = peerOrder.length
  const peerTotalW = peerCount * PILL_W + (peerCount - 1) * 8
  let peerX = cx - peerTotalW / 2

  for (const id of peerOrder) {
    const node = graph.nodes.find(n => n.id === id)!
    glyphs.set(id, {
      id,
      x: peerX,
      y: PEER_Y,
      w: PILL_W,
      h: PILL_H,
      band: 'peer',
      tier: 'remote',
      label: node.name,
    })
    peerX += PILL_W + 8
  }

  // Cores
  const coreCount = cores.length
  const coreTotalW = coreCount * PILL_W + (coreCount - 1) * 8
  let coreX = cx - coreTotalW / 2

  for (const id of cores) {
    const node = graph.nodes.find(n => n.id === id)!
    glyphs.set(id, {
      id,
      x: coreX,
      y: CORE_Y,
      w: PILL_W,
      h: PILL_H,
      band: 'core',
      tier: 'core',
      label: node.name,
    })
    coreX += PILL_W + 8
  }

  // Spines + Aggs (aggs to the right with AGG_GAP)
  const spineCount = spines.length
  const aggCount = aggs.length
  const spineGroupW = spineCount * GLYPH_W + (spineCount - 1) * 8
  const aggGroupW = aggCount * GLYPH_W + (aggCount - 1) * 8
  const totalSpineAggW = spineGroupW + (aggCount > 0 ? AGG_GAP + aggGroupW : 0)
  let spineX = cx - totalSpineAggW / 2

  for (const id of spines) {
    const node = graph.nodes.find(n => n.id === id)!
    glyphs.set(id, {
      id,
      x: spineX,
      y: SPINE_Y,
      w: GLYPH_W,
      h: GLYPH_H,
      band: 'spine',
      tier: 'spine',
      label: node.name,
    })
    spineX += GLYPH_W + 8
  }

  let aggX = spineX + AGG_GAP - 8
  for (const id of aggs) {
    const node = graph.nodes.find(n => n.id === id)!
    glyphs.set(id, {
      id,
      x: aggX,
      y: SPINE_Y,
      w: GLYPH_W,
      h: GLYPH_H,
      band: 'agg',
      tier: 'leaf',
      label: node.name,
    })
    aggX += GLYPH_W + 8
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 7: Position rack columns in rows
  // ─────────────────────────────────────────────────────────────────────────
  const columnGlyphsByRack = new Map<string, string[]>()
  for (const nodeId of columnGlyphs) {
    const node = graph.nodes.find(n => n.id === nodeId)!
    const rack = node.device ? deviceToRack.get(node.device.id) : null
    if (rack) {
      if (!columnGlyphsByRack.has(rack.name)) columnGlyphsByRack.set(rack.name, [])
      columnGlyphsByRack.get(rack.name)!.push(nodeId)
    }
  }

  // Sort glyphs within each rack by name
  for (const [, glyphIds] of columnGlyphsByRack) {
    glyphIds.sort((a, b) => {
      const nodeA = graph.nodes.find(n => n.id === a)!
      const nodeB = graph.nodes.find(n => n.id === b)!
      return naturalCompare(nodeA.name, nodeB.name)
    })
  }

  // Find max glyph count per rack for row height
  let maxGlyphsPerRack = 0
  for (const [, glyphIds] of columnGlyphsByRack) {
    maxGlyphsPerRack = Math.max(maxGlyphsPerRack, glyphIds.length)
  }
  if (maxGlyphsPerRack === 0) maxGlyphsPerRack = 1

  // Layout rows
  const locations = [...byLocation.keys()].sort((a, b) => naturalCompare(a, b))
  let currentY = RACKS_Y

  for (const loc of locations) {
    const locRacks = byLocation.get(loc)!
    const lines = Math.ceil(locRacks.length / MAX_COLS)

    for (let line = 0; line < lines; line++) {
      const start = line * MAX_COLS
      const end = Math.min(start + MAX_COLS, locRacks.length)
      const lineRacks = locRacks.slice(start, end)

      // Row label (only for first line of location)
      if (line === 0) {
        const labelText = loc === '￿' ? 'no location' : loc
        rows.push({ label: labelText, x: 0, y: currentY + ROW_LABEL_H })
      }

      // Columns
      for (let i = 0; i < lineRacks.length; i++) {
        const rack = lineRacks[i]!
        const colX = i * COL_W + (COL_W - GLYPH_W) / 2
        const colGlyphIds = columnGlyphsByRack.get(rack.name) ?? []

        // Place glyphs
        const glyphY = currentY + ROW_LABEL_H + RACK_LABEL_H
        for (let g = 0; g < colGlyphIds.length; g++) {
          const nodeId = colGlyphIds[g]!
          const node = graph.nodes.find(n => n.id === nodeId)!
          glyphs.set(nodeId, {
            id: nodeId,
            x: colX,
            y: glyphY + g * GLYPH_PITCH,
            w: GLYPH_W,
            h: GLYPH_H,
            band: 'rack',
            tier: 'leaf',
            label: node.name,
          })
        }

        // Collect end devices for this rack
        const endIdsForRack: string[] = []

        columns.push({
          key: rack.name,
          label: rack.name,
          x: colX,
          y: currentY,
          glyphIds: [...colGlyphIds],
          endIds: endIdsForRack,
          chip: colGlyphIds.length > 0 ? {
            x: colX,
            y: glyphY + maxGlyphsPerRack * GLYPH_PITCH + 4,
          } : null,
        })
      }

      // Row height
      currentY += ROW_LABEL_H + RACK_LABEL_H + maxGlyphsPerRack * GLYPH_PITCH + 4 + CHIP_H + ROW_GAP
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 8: Assign end devices to columns
  // ─────────────────────────────────────────────────────────────────────────
  const columnByKey = new Map(columns.map(c => [c.key, c]))
  const otherEnds: string[] = []

  for (const endId of endNodes) {
    const node = graph.nodes.find(n => n.id === endId)!
    let assigned = false

    // Try own rack
    if (node.device) {
      const rack = deviceToRack.get(node.device.id)
      if (rack && columnByKey.has(rack.name)) {
        columnByKey.get(rack.name)!.endIds.push(endId)
        assigned = true
      }
    }

    // Try first neighbour's rack
    if (!assigned) {
      const neighbours = adjacency.get(endId) ?? new Set()
      const sortedNeighbours = [...neighbours].sort(naturalCompare)
      for (const neighbourId of sortedNeighbours) {
        const neighbourNode = graph.nodes.find(n => n.id === neighbourId)
        if (neighbourNode?.device) {
          const rack = deviceToRack.get(neighbourNode.device.id)
          if (rack && columnByKey.has(rack.name)) {
            columnByKey.get(rack.name)!.endIds.push(endId)
            assigned = true
            break
          }
        }
      }
    }

    if (!assigned) {
      otherEnds.push(endId)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 9: OTHER column (if needed)
  // ─────────────────────────────────────────────────────────────────────────
  if (unrackedLeaf.length > 0 || otherEnds.length > 0) {
    const otherX = 0
    const otherY = currentY

    rows.push({ label: 'other', x: 0, y: otherY + ROW_LABEL_H })

    // Place unracked leaf glyphs
    const glyphY = otherY + ROW_LABEL_H + RACK_LABEL_H
    for (let g = 0; g < unrackedLeaf.length; g++) {
      const nodeId = unrackedLeaf[g]!
      const node = graph.nodes.find(n => n.id === nodeId)!
      glyphs.set(nodeId, {
        id: nodeId,
        x: otherX,
        y: glyphY + g * GLYPH_PITCH,
        w: GLYPH_W,
        h: GLYPH_H,
        band: 'rack',
        tier: 'leaf',
        label: node.name,
      })
    }

    columns.push({
      key: OTHER,
      label: 'other',
      x: otherX,
      y: otherY,
      glyphIds: [...unrackedLeaf],
      endIds: [...otherEnds],
      chip: unrackedLeaf.length > 0 || otherEnds.length > 0 ? {
        x: otherX,
        y: glyphY + Math.max(1, unrackedLeaf.length) * GLYPH_PITCH + 4,
      } : null,
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 10: Build edges and links
  // ─────────────────────────────────────────────────────────────────────────
  const diagramEdges: DiagramEdge[] = []
  const glyphIds = new Set(glyphs.keys())

  const aggSet = new Set(aggs)

  for (const edge of graph.edges) {
    const tierA = nodeTier.get(edge.a)
    const tierB = nodeTier.get(edge.b)

    // Skip edges with end nodes (they go to links)
    if (tierA === 'end' || tierB === 'end') {
      // Add to links map
      const endNode = tierA === 'end' ? edge.a : edge.b
      const otherNode = tierA === 'end' ? edge.b : edge.a
      if (!links.has(endNode)) links.set(endNode, [])
      links.get(endNode)!.push({ edgeId: edge.id, peer: otherNode })
      continue
    }

    // Only edges between glyphs
    if (!glyphIds.has(edge.a) || !glyphIds.has(edge.b)) continue

    const glyphA = glyphs.get(edge.a)!
    const glyphB = glyphs.get(edge.b)!

    // Classify edge kind by tier pair (aggs count as upper tier for trunk classification)
    const isAggA = aggSet.has(edge.a)
    const isAggB = aggSet.has(edge.b)
    const kind = classifyEdgeKind(tierA!, tierB!, isAggA, isAggB)

    diagramEdges.push({
      id: edge.id,
      a: edge.a,
      b: edge.b,
      kind,
      d: edgePath(glyphA, glyphB),
    })
  }

  // Sort for determinism
  diagramEdges.sort((a, b) => naturalCompare(a.id, b.id))

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 11: Compute bounds
  // ─────────────────────────────────────────────────────────────────────────
  let minX = 0
  let maxX = rackAreaW
  let minY = PEER_Y
  let maxY = currentY

  for (const glyph of glyphs.values()) {
    minX = Math.min(minX, glyph.x)
    maxX = Math.max(maxX, glyph.x + glyph.w)
    minY = Math.min(minY, glyph.y)
    maxY = Math.max(maxY, glyph.y + glyph.h)
  }

  for (const col of columns) {
    if (col.chip) {
      maxY = Math.max(maxY, col.chip.y + CHIP_H)
    }
  }

  const bounds: Box = {
    x: minX - MARGIN,
    y: minY - MARGIN,
    w: maxX - minX + 2 * MARGIN,
    h: maxY - minY + 2 * MARGIN,
  }

  return { bounds, glyphs, columns, rows, edges: diagramEdges, links }
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge kind classification
// ─────────────────────────────────────────────────────────────────────────────

function classifyEdgeKind(tierA: Tier, tierB: Tier, isAggA: boolean, isAggB: boolean): EdgeKind {
  // trunk = peer–core, core–spine, core–agg, core–core
  // uplink = spine↔leaf-tier (incl. spine↔agg) and agg↔rack-leaf
  // local = both in columns (leaf-leaf, neither is agg)

  const upperTiers: Tier[] = ['remote', 'core', 'spine']

  // Both upper tiers (remote/core/spine): trunk
  if (upperTiers.includes(tierA) && upperTiers.includes(tierB)) {
    return 'trunk'
  }

  // Core to agg (leaf in network rack): trunk
  if ((tierA === 'core' && isAggB) || (tierB === 'core' && isAggA)) {
    return 'trunk'
  }

  // Spine to any leaf (including agg): uplink
  if ((tierA === 'spine' && tierB === 'leaf') || (tierB === 'spine' && tierA === 'leaf')) {
    return 'uplink'
  }

  // Agg to any leaf: uplink
  if ((isAggA && tierB === 'leaf') || (isAggB && tierA === 'leaf')) {
    return 'uplink'
  }

  // Both leaf, neither is agg: local
  if (tierA === 'leaf' && tierB === 'leaf' && !isAggA && !isAggB) {
    return 'local'
  }

  // Default to uplink for other combinations
  return 'uplink'
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge path generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate SVG path for an edge between two glyphs.
 */
export function edgePath(a: Glyph, b: Glyph): string {
  const [upper, lower] = a.y < b.y ? [a, b] : [b, a]

  // Same column: right-side cubic bracket
  if (Math.abs(a.x - b.x) < 1) {
    const gap = Math.abs(a.y - b.y)
    const offset = Math.min(gap / 4, 20)
    const x1 = a.x + a.w
    const x2 = x1 + offset
    const y1 = upper.y + upper.h / 2
    const y2 = lower.y + lower.h / 2
    return `M ${x1} ${y1} C ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2}`
  }

  // Same y (same band): quadratic arc above
  if (Math.abs(a.y - b.y) < 1) {
    const left = a.x < b.x ? a : b
    const right = a.x < b.x ? b : a
    const x1 = left.x + left.w / 2
    const x2 = right.x + right.w / 2
    const y = left.y
    // Control point: above the band, capped below core band
    const dx = Math.abs(x2 - x1)
    // ponytail: cap arc height at min(dx/4, 36) to stay below core band
    const arcHeight = Math.min(dx / 4, 36)
    const cy = Math.max(y - arcHeight, CORE_Y + PILL_H + 4)
    return `M ${x1} ${y} Q ${(x1 + x2) / 2} ${cy}, ${x2} ${y}`
  }

  // Different bands: straight line from bottom-centre of upper to top-centre of lower
  const x1 = upper.x + upper.w / 2
  const y1 = upper.y + upper.h
  const x2 = lower.x + lower.w / 2
  const y2 = lower.y
  return `M ${x1} ${y1} L ${x2} ${y2}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay and focus helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute overlay box position for a rack column.
 */
export function overlayBox(layout: SiteDiagramLayout, column: RackColumn): Box {
  if (!column.chip) {
    return { x: column.x, y: column.y, w: OVERLAY_NAME_W, h: OVERLAY_ROW_H }
  }

  const endCount = column.endIds.length
  const maxLinks = 3 // Assumption: max 3 links per server
  const w = OVERLAY_NAME_W + maxLinks * OVERLAY_LINK_W
  const h = endCount * OVERLAY_ROW_H + 8

  let x = column.chip.x
  const y = column.chip.y + CHIP_H + 4

  // Clamp to bounds
  if (x + w > layout.bounds.x + layout.bounds.w) {
    x = layout.bounds.x + layout.bounds.w - w
  }

  return { x, y, w, h }
}

/**
 * Compute focus set for a node.
 * Returns nodes and edges that should be highlighted.
 */
export function focusOf(
  layout: SiteDiagramLayout,
  id: string | null,
): { nodes: Set<string>; edges: Set<string> } | null {
  if (!id) return null

  const nodes = new Set<string>([id])
  const edges = new Set<string>()

  // Add connected nodes and edges
  for (const edge of layout.edges) {
    if (edge.a === id || edge.b === id) {
      edges.add(edge.id)
      nodes.add(edge.a)
      nodes.add(edge.b)
    }
  }

  // Add links for end nodes
  const nodeLinks = layout.links.get(id)
  if (nodeLinks) {
    for (const link of nodeLinks) {
      edges.add(link.edgeId)
      nodes.add(link.peer)
    }
  }

  return { nodes, edges }
}

// ─────────────────────────────────────────────────────────────────────────────
// Label helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip site prefix and domain from a hostname.
 */
export function shortLabel(name: string, prefix: string): string {
  let result = name.split('.')[0] ?? name
  if (result.startsWith(`${prefix}-`)) {
    result = result.slice(prefix.length + 1)
  }
  return result
}

/**
 * Truncate a label with middle ellipsis, keeping the distinguishing tail.
 */
export function fitLabel(text: string, max: number): string {
  if (text.length <= max) return text
  const keep = Math.floor((max - 3) / 2)
  return text.slice(0, keep) + '...' + text.slice(-keep)
}
