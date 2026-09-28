/**
 * Layout functions for the logical topology view.
 * Pure, hand-written, three-free.
 * Positions depend on SoT-stable inputs only (naturalCompare ordering).
 */
import { naturalCompare, type CircuitGroup, type LogicalGraph, type LogicalEdge, type LogicalNode, type Tier } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import type { Bounds } from './logicalView'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Y position per tier - increased gaps for visual separation at scale. */
const TIER_Y: Record<Tier, number> = {
  remote: 24,
  core: 18,
  spine: 12,
  leaf: 6,
  end: 0,
}

/** Horizontal pitch between nodes in leaf tier. */
const PITCH_X = 2

/** Horizontal pitch for upper tiers (remote, core, spine) - sized for readable labels. */
const UPPER_PITCH_X = 12

/** Depth pitch for row wrapping - increased for curtain clearance. */
const PITCH_Z = 10

/** Number of nodes per row before wrapping to next z. */
const NODES_PER_ROW = 40

/** Number of end-device columns per leaf slot. */
const COLS_PER_LEAF = 4

/** Y offset per row of end devices under a leaf. */
const END_ROW_Y = -1

/** Number of rows to wrap end devices at (limits vertical extent). */
const END_ROWS_PER_COL = 6

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SiteLayoutResult {
  positions: Map<string, [number, number, number]>
  bounds: Bounds
}

// ─────────────────────────────────────────────────────────────────────────────
// layoutSite
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lay out a site's logical graph in a tiered arrangement.
 * y per tier: remote=8, core=6, spine=4, leaf=2, end=0 and below.
 * Each tier ordered by naturalCompare of names (never by neighbours).
 */
export function layoutSite(graph: LogicalGraph): SiteLayoutResult {
  const positions = new Map<string, [number, number, number]>()

  // Group nodes by tier, sorted by name for stability
  const byTier = new Map<Tier, LogicalNode[]>()
  for (const tier of ['remote', 'core', 'spine', 'leaf', 'end'] as Tier[]) {
    byTier.set(tier, [])
  }
  for (const node of graph.nodes) {
    byTier.get(node.tier)!.push(node)
  }
  for (const nodes of byTier.values()) {
    nodes.sort((a, b) => naturalCompare(a.name, b.name))
  }

  // Build leaf slot assignment: each leaf owns a slot, order by name
  const leaves = byTier.get('leaf')!
  const leafSlot = new Map<string, number>()
  for (let i = 0; i < leaves.length; i++) {
    leafSlot.set(leaves[i]!.id, i)
  }

  // Build end device anchoring: find first non-end neighbour
  // Per brief line 106: prefer documented edges (members.length > 0), fallback to all
  const endAnchor = new Map<string, string>()
  const endByAnchor = new Map<string, LogicalNode[]>()

  // Build adjacency from documented edges (those with members)
  const documentedAdj = new Map<string, Set<string>>()
  // Build adjacency from all edges (fallback)
  const allAdj = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    // All edges
    if (!allAdj.has(edge.a)) allAdj.set(edge.a, new Set())
    if (!allAdj.has(edge.b)) allAdj.set(edge.b, new Set())
    allAdj.get(edge.a)!.add(edge.b)
    allAdj.get(edge.b)!.add(edge.a)
    // Documented edges only
    if (edge.members.length > 0) {
      if (!documentedAdj.has(edge.a)) documentedAdj.set(edge.a, new Set())
      if (!documentedAdj.has(edge.b)) documentedAdj.set(edge.b, new Set())
      documentedAdj.get(edge.a)!.add(edge.b)
      documentedAdj.get(edge.b)!.add(edge.a)
    }
  }

  // Find node tier helper
  const nodeTier = new Map<string, Tier>()
  for (const node of graph.nodes) {
    nodeTier.set(node.id, node.tier)
  }

  for (const endNode of byTier.get('end')!) {
    // Prefer documented neighbours, fallback to all neighbours
    const docNeighbours = documentedAdj.get(endNode.id)
    const allNeighbours = allAdj.get(endNode.id)

    // Find anchor: ONLY leaf-tier neighbors are valid anchors.
    // End devices hang under leaves (where the curtain layout works).
    // If no leaf neighbor exists, the end device is unanchored (extra slot).
    const findLeafAnchor = (neighbours: Set<string> | undefined): string | null => {
      if (!neighbours || neighbours.size === 0) return null
      const leafNeighbours = [...neighbours]
        .filter((n) => nodeTier.get(n) === 'leaf')
        .sort(naturalCompare)
      return leafNeighbours.length > 0 ? leafNeighbours[0]! : null
    }

    const anchor = findLeafAnchor(docNeighbours) ?? findLeafAnchor(allNeighbours)
    if (anchor) {
      endAnchor.set(endNode.id, anchor)
      if (!endByAnchor.has(anchor)) endByAnchor.set(anchor, [])
      endByAnchor.get(anchor)!.push(endNode)
    }
  }

  // Sort end devices under each anchor
  for (const ends of endByAnchor.values()) {
    ends.sort((a, b) => naturalCompare(a.name, b.name))
  }

  // Find unanchored end devices
  const unanchored: LogicalNode[] = []
  for (const endNode of byTier.get('end')!) {
    if (!endAnchor.has(endNode.id)) {
      unanchored.push(endNode)
    }
  }

  // Lay out fabric tiers (remote, core, spine, leaf) along x
  const fabricTiers: Tier[] = ['remote', 'core', 'spine', 'leaf']
  const upperTiers = new Set<Tier>(['remote', 'core', 'spine'])
  let fabricMinX = Infinity
  let fabricMaxX = -Infinity
  let fabricMinY = Infinity
  let fabricMaxY = -Infinity
  let fabricMinZ = 0
  let fabricMaxZ = 0

  for (const tier of fabricTiers) {
    const nodes = byTier.get(tier)!
    const y = TIER_Y[tier]
    const count = nodes.length
    if (count === 0) continue

    // Upper tiers use larger pitch for readable labels
    const pitchX = upperTiers.has(tier) ? UPPER_PITCH_X : PITCH_X

    // Left-aligned layout starting at x=0: new nodes appended by name order
    // go to the right without shifting existing positions (brief line 34)
    for (let i = 0; i < count; i++) {
      const node = nodes[i]!
      const row = Math.floor(i / NODES_PER_ROW)
      const col = i % NODES_PER_ROW

      const x = col * pitchX
      const z = row * PITCH_Z

      positions.set(node.id, [x, y, z])

      fabricMinX = Math.min(fabricMinX, x)
      fabricMaxX = Math.max(fabricMaxX, x)
      fabricMinY = Math.min(fabricMinY, y)
      fabricMaxY = Math.max(fabricMaxY, y)
      fabricMaxZ = Math.max(fabricMaxZ, z)
    }
  }

  // Lay out end devices directly under their anchor leaf
  // End devices form a curtain hanging below the leaf's actual position
  // Curtain spans (cols-1) * pitch = 3 * pitch, must fit within PITCH_X
  const endPitchX = PITCH_X / 4 // 0.5 units - curtain spans 1.5 units, fits in PITCH_X=2

  for (const leaf of leaves) {
    const leafPos = positions.get(leaf.id)
    if (!leafPos) continue
    const [leafX, , leafZ] = leafPos
    const ends = endByAnchor.get(leaf.id) ?? []

    for (let i = 0; i < ends.length; i++) {
      const endNode = ends[i]!
      // Fill in a 4-column curtain directly under the leaf
      const col = i % COLS_PER_LEAF
      const row = Math.floor(i / COLS_PER_LEAF)
      // Wrap rows vertically, expanding z when exceeding END_ROWS_PER_COL
      const zLevel = Math.floor(row / END_ROWS_PER_COL)
      const yRow = row % END_ROWS_PER_COL

      // Center the curtain columns under the leaf: offset by (col - 1.5) * pitch
      const x = leafX + (col - 1.5) * endPitchX
      const y = END_ROW_Y * (yRow + 1) // Start below y=0
      const z = leafZ + zLevel * PITCH_Z

      positions.set(endNode.id, [x, y, z])
    }
  }

  // Lay out unanchored end devices in an extra slot after the last leaf
  if (unanchored.length > 0 && leaves.length > 0) {
    // Position the extra slot after the last leaf in row order
    const lastLeaf = leaves[leaves.length - 1]!
    const lastLeafPos = positions.get(lastLeaf.id)
    if (lastLeafPos) {
      const [lastX, , lastZ] = lastLeafPos
      const extraSlotX = lastX + PITCH_X // One slot after the last leaf

      for (let i = 0; i < unanchored.length; i++) {
        const endNode = unanchored[i]!
        const col = i % COLS_PER_LEAF
        const row = Math.floor(i / COLS_PER_LEAF)
        const zLevel = Math.floor(row / END_ROWS_PER_COL)
        const yRow = row % END_ROWS_PER_COL

        const x = extraSlotX + (col - 1.5) * endPitchX
        const y = END_ROW_Y * (yRow + 1)
        const z = lastZ + zLevel * PITCH_Z

        positions.set(endNode.id, [x, y, z])
      }
    }
  } else if (unanchored.length > 0) {
    // No leaves: place unanchored end devices at origin
    for (let i = 0; i < unanchored.length; i++) {
      const endNode = unanchored[i]!
      const col = i % COLS_PER_LEAF
      const row = Math.floor(i / COLS_PER_LEAF)
      const yRow = row % END_ROWS_PER_COL

      const x = (col - 1.5) * endPitchX
      const y = END_ROW_Y * (yRow + 1)
      const z = 0

      positions.set(endNode.id, [x, y, z])
    }
  }

  // If no fabric nodes, set default bounds
  if (fabricMinX === Infinity) {
    fabricMinX = -2
    fabricMaxX = 2
    fabricMinY = 0
    fabricMaxY = 4
  }

  return {
    positions,
    bounds: {
      min: { x: fabricMinX - 1, y: fabricMinY - 1, z: fabricMinZ - 1 },
      max: { x: fabricMaxX + 1, y: fabricMaxY + 1, z: fabricMaxZ + 1 },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// layoutBackbone
// ─────────────────────────────────────────────────────────────────────────────

/** Base radius for the ring. */
const RING_BASE_RADIUS = 8

/** Radius increment per site. */
const RING_RADIUS_PER_SITE = 0.3

/** Max rows in a cluster before wrapping. */
const CLUSTER_MAX_ROWS = 6

/**
 * Lay out the backbone graph as a ring of site clusters.
 * Sites ordered by longitude, then name. Null coordinates placed last.
 * ponytail: ring legible to about 40 sites; upgrade to projected lat/lon
 */
export function layoutBackbone(
  graph: LogicalGraph,
  sites: Site[],
): Map<string, [number, number, number]> {
  const positions = new Map<string, [number, number, number]>()

  // Sort sites: by longitude (ascending), null last, then by name
  const sortedSites = [...sites].sort((a, b) => {
    const aHasLon = a.longitude !== null
    const bHasLon = b.longitude !== null
    if (aHasLon && !bHasLon) return -1
    if (!aHasLon && bHasLon) return 1
    if (aHasLon && bHasLon) {
      if (a.longitude !== b.longitude) return a.longitude! - b.longitude!
    }
    return naturalCompare(a.name, b.name)
  })

  const siteCount = sortedSites.length
  if (siteCount === 0) return positions

  // Compute ring radius based on site count
  const radius = RING_BASE_RADIUS + siteCount * RING_RADIUS_PER_SITE

  // Group nodes by siteName
  const nodesBySite = new Map<string, LogicalNode[]>()
  for (const node of graph.nodes) {
    if (node.siteName) {
      if (!nodesBySite.has(node.siteName)) nodesBySite.set(node.siteName, [])
      nodesBySite.get(node.siteName)!.push(node)
    }
  }

  // Position each site cluster on the ring
  for (let i = 0; i < siteCount; i++) {
    const site = sortedSites[i]!
    const angle = (2 * Math.PI * i) / siteCount - Math.PI / 2 // Start at top

    // Cluster center position on the ring
    const cx = radius * Math.cos(angle)
    const cz = radius * Math.sin(angle)

    // Position the site: node at cluster center
    const siteNodeId = `site:${site.name}`
    positions.set(siteNodeId, [cx, 0, cz])

    // Position device nodes in the cluster (if any)
    const nodes = nodesBySite.get(site.name) ?? []
    // Sort for stability
    nodes.sort((a, b) => naturalCompare(a.name, b.name))

    // Layout cluster nodes in a grid around the site center
    const clusterPitch = 1
    for (let j = 0; j < nodes.length; j++) {
      const node = nodes[j]!
      // Skip the site: node itself if present
      if (node.id === siteNodeId) continue

      const col = j % CLUSTER_MAX_ROWS
      const row = Math.floor(j / CLUSTER_MAX_ROWS)

      // Offset from cluster center along the tangent direction
      const tangentX = -Math.sin(angle)
      const tangentZ = Math.cos(angle)

      // Offset perpendicular to ring (radial direction)
      const radialX = Math.cos(angle)
      const radialZ = Math.sin(angle)

      const x = cx + col * clusterPitch * tangentX + row * clusterPitch * radialX
      const z = cz + col * clusterPitch * tangentZ + row * clusterPitch * radialZ

      positions.set(node.id, [x, 0, z])
    }
  }

  return positions
}

// ─────────────────────────────────────────────────────────────────────────────
// sitePairEdges
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build site-pair edges from circuit groups.
 * Omits groups that already have a device-level edge in the graph.
 */
export function sitePairEdges(
  graph: LogicalGraph,
  circuitGroups: CircuitGroup[],
): LogicalEdge[] {
  const result: LogicalEdge[] = []

  // Build set of site pairs that have device-level edges
  const sitePairsWithDeviceEdges = new Set<string>()

  // Build a map of device -> siteName
  const deviceSite = new Map<string, string>()
  for (const node of graph.nodes) {
    if (node.device && node.siteName) {
      deviceSite.set(node.id, node.siteName)
    }
  }

  // Check each edge for device-to-device connections across sites
  for (const edge of graph.edges) {
    const siteA = deviceSite.get(edge.a)
    const siteB = deviceSite.get(edge.b)

    if (siteA && siteB && siteA !== siteB) {
      // Normalize site pair
      const [s1, s2] = siteA < siteB ? [siteA, siteB] : [siteB, siteA]
      sitePairsWithDeviceEdges.add(`${s1}|${s2}`)
    }
  }

  // Create edges for circuit groups that don't have device edges
  for (const group of circuitGroups) {
    const [s1, s2] = group.siteA < group.siteZ ? [group.siteA, group.siteZ] : [group.siteZ, group.siteA]
    const pairKey = `${s1}|${s2}`

    if (sitePairsWithDeviceEdges.has(pairKey)) continue

    // Create site-pair edge
    const a = `site:${s1}`
    const b = `site:${s2}`
    const id = `${a}~${b}`

    result.push({
      id,
      a,
      b,
      layers: {},
      members: [],
    })
  }

  return result
}
