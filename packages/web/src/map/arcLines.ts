/**
 * Pure arc line builders for the map.
 * No leaflet/DOM imports — vitest env is node.
 */
import {
  commitRateToSpeedBucket,
  greatCircleLatLngs,
  speedBucketToWidth,
  splitAtAntimeridian,
  wrapLng,
  type CircuitGroup,
  type LogicalGraph,
  type LogicalLayer,
  type SiteCircuit,
} from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { isEdgeHidden, visibleLayers, LAYER_NAMES } from '../lib/logicalView'
import { splitArc } from './arcHalves'

export type LatLng = [number, number]

export interface ArcLine {
  key: string
  siteA: string
  siteZ: string
  title: string
  positions: LatLng[]
  halves: ReturnType<typeof splitArc<LatLng>>
  paths: { whole: LatLng[][]; a: LatLng[][]; z: LatLng[][] }
  weight: number
  opacity: number
  circuits: SiteCircuit[]
  cids: string[]
  dashed: boolean
  stale: boolean
  rows: string[]
}

/** Canonical layer order for tooltip display. */
const LAYER_ORDER: LogicalLayer[] = ['physical', 'isis', 'ospf', 'sr']

/**
 * Compute weight and opacity from commit rate in kbps.
 * Shared by both circuitLines (physical) and logicalLines (backbone).
 */
function arcWeight(maxCommitKbps: number | null): { weight: number; opacity: number } {
  const bucket = commitRateToSpeedBucket(maxCommitKbps)
  // Raise the thinnest links off the floor: 10G circuits at weight 1.5
  // were nearly invisible on the light basemap.
  const weight = Math.max(speedBucketToWidth(bucket), 2)
  const opacity = bucket === '400G' ? 0.9 : bucket === '100G' ? 0.75 : 0.6
  return { weight, opacity }
}

/**
 * Wrap an arc's positions and paths through splitAtAntimeridian.
 * Returns a new ArcLine with normalised positions and split paths.
 */
function wrapLine(line: ArcLine): ArcLine {
  const wrapPositions = (pts: LatLng[]): LatLng[] => pts.map(([lat, lng]) => [lat, wrapLng(lng)])
  const splitPositions = (pts: LatLng[]): LatLng[][] => splitAtAntimeridian(pts)

  const wrappedPositions = wrapPositions(line.positions)
  const wrappedHalves = splitArc(wrappedPositions)

  return {
    ...line,
    positions: wrappedPositions,
    halves: wrappedHalves,
    paths: {
      whole: splitPositions(line.positions),
      a: splitPositions(line.halves.a),
      z: splitPositions(line.halves.z),
    },
  }
}

/**
 * Build physical map arcs from circuit groups.
 * Each connected site pair with geocoded sites gets one arc.
 */
export function circuitLines(sites: Site[], groups: CircuitGroup[]): ArcLine[] {
  const byName = new Map(sites.map((s) => [s.name, s]))

  return groups.flatMap((g) => {
    const a = byName.get(g.siteA)
    const z = byName.get(g.siteZ)
    if (!a || !z || a.latitude === null || z.latitude === null) return []

    const { weight, opacity } = arcWeight(g.maxCommitRate ?? null)
    const positions = greatCircleLatLngs(a.latitude, a.longitude!, z.latitude, z.longitude!, 48) as LatLng[]
    const halves = splitArc(positions)

    const line: ArcLine = {
      key: `${g.siteA}|${g.siteZ}`,
      siteA: g.siteA,
      siteZ: g.siteZ,
      positions,
      halves,
      paths: { whole: [positions], a: [halves.a], z: [halves.z] },
      weight,
      opacity,
      title: `${g.siteA} ↔ ${g.siteZ} — ${g.count} circuit${g.count > 1 ? 's' : ''}`,
      circuits: g.circuits ?? [],
      cids: (g.circuits ?? []).map((c) => c.cid),
      dashed: false,
      stale: false,
      rows: [],
    }

    // Physical map: keep arcs unwrapped (as on main) so they draw as great circles
    return [line]
  })
}

/**
 * Compute orphan groups: circuits not covered by any router edge.
 */
function orphanGroups(groups: CircuitGroup[], covered: Set<string>): CircuitGroup[] {
  return groups
    .map((g) => {
      const uncoveredCircuits = (g.circuits ?? []).filter((c) => !covered.has(c.cid))
      if (uncoveredCircuits.length === 0) return null
      return {
        ...g,
        count: uncoveredCircuits.length,
        circuits: uncoveredCircuits,
        circuitIds: uncoveredCircuits.map((c) => c.id),
        maxCommitRate: uncoveredCircuits.reduce((max, c) => Math.max(max, c.commitRate ?? 0), 0) || null,
      }
    })
    .filter((g): g is CircuitGroup => g !== null)
}

/**
 * Build logical map arcs from the backbone graph.
 * One arc per router edge, plus fallback site arcs for uncovered circuits.
 */
export function logicalLines(
  graph: LogicalGraph | null,
  anchors: Map<string, LatLng>,
  sites: Site[],
  groups: CircuitGroup[],
  hidden: ReadonlySet<LogicalLayer | 'end'>,
): ArcLine[] {
  if (!graph) {
    // Empty graph: fallback to site arcs if physical is visible
    if (hidden.has('physical')) return []
    return circuitLines(sites, groups)
  }

  // Build cid -> SiteCircuit map from groups
  const byCid = new Map<string, SiteCircuit>()
  for (const g of groups) {
    for (const c of g.circuits ?? []) {
      byCid.set(c.cid, c)
    }
  }

  // Build site map for fallback
  const siteByName = new Map(sites.map((s) => [s.name, s]))

  // Build tier map from nodes
  const tierOf = new Map<string, string>()
  const siteOf = new Map<string, string>()
  for (const n of graph.nodes) {
    tierOf.set(n.id, n.tier)
    if (n.siteName) {
      siteOf.set(n.id, n.siteName)
    }
  }

  const lines: ArcLine[] = []
  const covered = new Set<string>()

  for (const edge of graph.edges) {
    const pa = anchors.get(edge.a)
    const pz = anchors.get(edge.b)

    // Get site names from node data
    const sa = siteOf.get(edge.a)
    const sz = siteOf.get(edge.b)

    // Skip if anchor missing (will be handled as fallback)
    if (!pa || !pz) continue

    // Skip same-site edges
    if (sa && sa === sz) continue

    // Mark all member cids as covered
    for (const m of edge.members) {
      covered.add(m.id)
    }

    // Check if edge is hidden
    if (isEdgeHidden(edge, tierOf, hidden)) continue

    // Build the arc
    const positions = greatCircleLatLngs(pa[0], pa[1], pz[0], pz[1], 48) as LatLng[]
    const halves = splitArc(positions)

    // Get visible layers
    const visible = visibleLayers(edge, hidden)

    // Check if physical is hidden - if so, no cids, no circuits, neutral weight
    const physicalHidden = hidden.has('physical')

    // Filter member ids: only actual circuit cids (not igp: prefixed)
    const memberCids = physicalHidden ? [] : edge.members.map((m) => m.id).filter((id) => !id.startsWith('igp:'))

    // Get circuits for these cids
    const circuits = physicalHidden ? [] : memberCids.map((cid) => byCid.get(cid)).filter((c): c is SiteCircuit => c !== undefined)

    // Weight: from max commit rate if visible, else neutral
    const maxCommit = physicalHidden ? null : circuits.reduce((max, c) => Math.max(max, c.commitRate ?? 0), 0) || null
    const { weight, opacity } = arcWeight(maxCommit)

    // Dashed: if any VISIBLE IS-IS, OSPF or SR layer has up < total
    let dashed = false
    const isisLayer = edge.layers.isis
    const ospfLayer = edge.layers.ospf
    const srLayer = edge.layers.sr
    if (isisLayer && !hidden.has('isis') && isisLayer.up < isisLayer.total) dashed = true
    if (ospfLayer && !hidden.has('ospf') && ospfLayer.up < ospfLayer.total) dashed = true
    if (srLayer && !hidden.has('sr') && srLayer.up < srLayer.total) dashed = true

    // Plan default: grey = circuit telemetry stale only (not adjacency-derived).
    // Stale adjacency is indicated by dashed + 'stale' in the tooltip row only.
    const stale = false

    // Build tooltip rows from visible layers
    const rows: string[] = []
    for (const layer of LAYER_ORDER) {
      if (!visible.includes(layer)) continue
      const state = edge.layers[layer]
      if (!state) continue
      const name = LAYER_NAMES[layer]
      let row = `${name} ${state.up}/${state.total}`
      if (state.label) {
        row += ` · ${state.label}`
      }
      rows.push(row)
    }

    const nameA = edge.a.replace(/^site:/, '')
    const nameZ = edge.b.replace(/^site:/, '')
    const title = `${nameA} ↔ ${nameZ}`

    const line: ArcLine = {
      key: edge.id, // Router arc key is edge.id
      siteA: sa ?? edge.a.replace(/^site:/, ''),
      siteZ: sz ?? edge.b.replace(/^site:/, ''),
      title,
      positions,
      halves,
      paths: { whole: [positions], a: [halves.a], z: [halves.z] },
      weight,
      opacity,
      circuits,
      cids: memberCids,
      dashed,
      stale,
      rows,
    }

    lines.push(wrapLine(line))
  }

  // Append fallback site arcs for uncovered circuits (unless physical hidden)
  if (!hidden.has('physical')) {
    const orphans = orphanGroups(groups, covered)
    const fallbackLines = circuitLines(sites, orphans)
    lines.push(...fallbackLines)
  }

  return lines
}
