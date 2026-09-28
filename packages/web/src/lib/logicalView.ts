/**
 * Pure logic for the logical topology view.
 * No three.js, no React, no store — just functions that take data and return data.
 * App.tsx reads viewFlags and calls these helpers.
 */
import {
  baseInterface,
  circuitLinks,
  formatBps,
  mapTelemetryToCables,
  type CableLive,
  type CircuitGroup,
  type CircuitLive,
  type CollectorTopology,
  type LogicalEdge,
  type LogicalGraph,
  type LogicalLayer,
  type LogicalNode,
  type SiteTelemetry,
  type TopologyCable,
} from '@net3d/shared'
import type { SiteRack, SiteDevice, SiteCable } from '../hooks/useSiteDetail'
import type { Capabilities } from '../hooks/useCapabilities'
import type { ViewLevel, ViewMode, CableColorMode, ColorMode } from '../store/useAppStore'
import { theme } from '../theme'
import { utilColor } from './liveTelemetry'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ViewFlagsState {
  viewMode: ViewMode
  level: ViewLevel
  siteDetail: { racks: SiteRack[] } | null
  selectedDevice: { id: string } | null
  editModeActive: boolean
  cableColorMode: CableColorMode
  dcLinksVisible: boolean
  colorMode: ColorMode
}

export interface ViewFlags {
  /** Whether the logical view is currently active. */
  logical: boolean
  /** Whether the 3D scene should be mounted (site/rack level). */
  inScene: boolean
  /** Whether to show the view mode switch (physical/logical). */
  viewSwitch: boolean
  /** Whether to show the logical layers panel. */
  logicalLayers: boolean
  /** Whether to show the site search (map level). */
  siteSearch: boolean
  /** Whether to show the layers panel (site/rack physical). */
  layersPanel: boolean
  /** Whether to show the power legend (site level, power visible). */
  powerLegend: boolean
  /** Whether to show the edit toolbar (site level). */
  editToolbar: boolean
  /** Polling gates. */
  poll: {
    circuits: boolean
    siteTelemetry: boolean
    siteTopology: boolean
    backboneTopology: boolean
  }
}

export interface EdgeLive {
  pct: number | null
  bps: number | null
  stale: boolean
}

export interface EdgeStyle {
  color: string
  width: number
  dashed: boolean
}

export interface EdgeGeometry {
  /** Individual hoverable edges (capped at 600). */
  lines: { id: string; points: [number, number, number][] }[]
  /** Batch for remaining edges. */
  batch: { points: number[]; edgeIds: string[] }
}

export interface Bounds {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

export interface CameraFrame {
  position: [number, number, number]
  target: [number, number, number]
  maxDistance: number
}

export type NodeClickAction =
  | { kind: 'select'; id: string }
  | { kind: 'site'; name: string }
  | null

// ─────────────────────────────────────────────────────────────────────────────
// isLogicalActive
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether the logical view is available and active.
 * Site: either capability suffices.
 * Map: telemetryAvailable only (NAPALM is never queried at map level).
 * Rack: always physical.
 */
export function isLogicalActive(viewMode: ViewMode, level: ViewLevel, caps: Capabilities): boolean {
  if (viewMode !== 'logical') return false
  if (level === 'rack') return false
  if (level === 'map') return caps.telemetryAvailable
  // site: either capability
  return caps.napalmAvailable || caps.telemetryAvailable
}

// ─────────────────────────────────────────────────────────────────────────────
// viewFlags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute all visibility and polling decisions for App.tsx.
 * With viewMode === 'physical' or with the feature unavailable,
 * output matches today's behavior exactly.
 */
export function viewFlags(state: ViewFlagsState, caps: Capabilities): ViewFlags {
  const { viewMode, level, siteDetail, selectedDevice, editModeActive, cableColorMode, dcLinksVisible } = state

  const logical = isLogicalActive(viewMode, level, caps)
  const inScene = level !== 'map'
  const featureAvailable = level === 'map' ? caps.telemetryAvailable : caps.napalmAvailable || caps.telemetryAvailable

  // View switch: shown when feature is available, not at rack level, not in edit mode
  const viewSwitch = featureAvailable && level !== 'rack' && !editModeActive

  // Logical layers panel: shown when logical view is active
  const logicalLayers = logical

  // Site search: shown at map level (regardless of view mode)
  const siteSearch = level === 'map'

  // Layers panel: shown at site/rack level, not in logical mode, not with selected device, not in edit mode, with racks
  const layersPanel = inScene && !logical && !selectedDevice && !editModeActive && !!siteDetail?.racks?.length

  // Power legend: shown at site level, power visible (handled by caller), not in edit mode, with racks
  // The power visibility itself is not part of this module, caller checks it
  const powerLegend = level === 'site' && !editModeActive && !!siteDetail?.racks?.length

  // Edit toolbar: shown at site level with loaded site detail
  const editToolbar = level === 'site' && !!siteDetail

  // ─────────────────────────────────────────────────────────────────────────
  // Polling gates
  // ─────────────────────────────────────────────────────────────────────────

  // Physical mode gates (legacy behavior)
  const physicalCircuits =
    caps.telemetryAvailable && (level === 'map' || (level === 'site' && cableColorMode === 'live' && dcLinksVisible))
  const physicalSiteTelemetry =
    caps.telemetryAvailable && !!siteDetail && (cableColorMode === 'live' || !!selectedDevice)

  // Logical mode poll gates
  let pollCircuits: boolean
  let pollSiteTelemetry: boolean
  let pollSiteTopology: boolean
  let pollBackboneTopology: boolean

  if (logical) {
    // Logical mode
    if (level === 'map') {
      pollCircuits = caps.telemetryAvailable
      pollSiteTelemetry = false
      pollSiteTopology = false
      pollBackboneTopology = caps.telemetryAvailable
    } else {
      // site level
      pollCircuits = false
      // "gate widened": in logical mode at site level, site telemetry poll is on whenever
      // telemetryAvailable and the site detail is loaded
      pollSiteTelemetry = caps.telemetryAvailable && !!siteDetail
      pollSiteTopology = caps.telemetryAvailable && !!siteDetail
      pollBackboneTopology = false
    }
  } else {
    // Physical mode or feature unavailable
    pollCircuits = physicalCircuits
    pollSiteTelemetry = physicalSiteTelemetry
    pollSiteTopology = false
    pollBackboneTopology = false
  }

  return {
    logical,
    inScene,
    viewSwitch,
    logicalLayers,
    siteSearch,
    layersPanel,
    powerLegend,
    editToolbar,
    poll: {
      circuits: pollCircuits,
      siteTelemetry: pollSiteTelemetry,
      siteTopology: pollSiteTopology,
      backboneTopology: pollBackboneTopology,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// findDevice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find a device by ID in the racks.
 * In physical mode, only searches the selected rack.
 * In logical mode, searches all racks so DevicePanel keeps its power rows.
 */
export function findDevice(
  racks: SiteRack[],
  selectedRackId: string | null,
  deviceId: string,
  logical: boolean,
): { device: SiteDevice; rack: SiteRack } | undefined {
  if (!logical) {
    // Physical mode: only look in the selected rack
    if (!selectedRackId) return undefined
    const rack = racks.find((r) => r.id === selectedRackId)
    if (!rack) return undefined
    const device = rack.devices.find((d) => d.id === deviceId)
    if (!device) return undefined
    return { device, rack }
  }

  // Logical mode: search all racks
  for (const rack of racks) {
    const device = rack.devices.find((d) => d.id === deviceId)
    if (device) return { device, rack }
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// graphInput
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the circuit-related fields of GraphInput for buildLogicalGraph.
 * Without collector topology, circuit stubs come from circuitLinks(cables)
 * plus the circuit groups (site pair per cid).
 *
 * Returns only { circuits, circuitSites } - the caller (integration layer)
 * assembles the full GraphInput by adding devices, links, lldp and topology
 * from their respective hooks/sources.
 */
export function graphInput(
  level: ViewLevel,
  site: string | null,
  cables: SiteCable[],
  circuitGroups: CircuitGroup[],
  topology?: CollectorTopology,
): { circuits: TopologyCable[]; circuitSites: Record<string, [string, string]> } {
  // Build circuit site pairs from circuit groups, keyed by CID (not numeric id)
  const circuitSites: Record<string, [string, string]> = {}
  for (const g of circuitGroups) {
    for (const c of g.circuits ?? []) {
      circuitSites[c.cid] = [g.siteA, g.siteZ]
    }
  }

  // Circuits: from topology if available, else from circuitLinks(cables)
  let circuits: TopologyCable[]
  if (topology?.circuits) {
    circuits = topology.circuits
  } else {
    // Convert SiteCable to the shape circuitLinks expects
    circuits = circuitLinks(cables as Parameters<typeof circuitLinks>[0])
  }

  return { circuits, circuitSites }
}

// ─────────────────────────────────────────────────────────────────────────────
// siteEdgeLive
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute live telemetry for an edge at site level.
 * Member interface looked up by exact name, then baseInterface.
 */
export function siteEdgeLive(edge: LogicalEdge, telemetry: SiteTelemetry): EdgeLive | null {
  const members = edge.members
  if (members.length === 0) return null

  // Build CableLike array for mapTelemetryToCables
  const cables = members.map((m) => ({
    id: m.id,
    a: m.a ? { deviceName: m.a.deviceName, name: m.a.name } : null,
    b: m.b ? { deviceName: m.b.deviceName, name: m.b.name } : null,
  }))

  // Try exact name first
  let liveMap = mapTelemetryToCables(telemetry, cables)

  // If no hits, try with base interfaces
  if (liveMap.size === 0) {
    const baseCables = cables.map((c) => ({
      id: c.id,
      a: c.a ? { deviceName: c.a.deviceName, name: baseInterface(c.a.name) } : null,
      b: c.b ? { deviceName: c.b.deviceName, name: baseInterface(c.b.name) } : null,
    }))
    liveMap = mapTelemetryToCables(telemetry, baseCables)
  }

  // Aggregate: max pct, sum bps, any stale
  const lives = [...liveMap.values()]
  if (lives.length === 0) return null

  const stale = lives.some((l) => l.stale)
  const fresh = lives.filter((l) => !l.stale)
  if (fresh.length === 0 && stale) {
    return { pct: null, bps: null, stale: true }
  }

  const pcts = fresh.map((l) => l.pct).filter((p): p is number => p !== null)
  const bpss = fresh.map((l) => l.bps).filter((b): b is number => b !== null)

  return {
    pct: pcts.length > 0 ? Math.max(...pcts) : null,
    bps: bpss.length > 0 ? bpss.reduce((a, b) => a + b, 0) : null,
    stale,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// mapEdgeLive
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute live telemetry for an edge at map level.
 * Uses circuit IDs from members to look up in circuitLive.
 */
export function mapEdgeLive(edge: LogicalEdge, circuitLive: Map<string, CircuitLive>): EdgeLive | null {
  const memberIds = edge.members.map((m) => m.id)
  if (memberIds.length === 0) return null

  const lives = memberIds
    .map((id) => circuitLive.get(id))
    .filter((l): l is CircuitLive => !!l)

  if (lives.length === 0) return null

  const stale = lives.some((l) => l.stale)
  const fresh = lives.filter((l) => !l.stale)
  if (fresh.length === 0 && stale) {
    return { pct: null, bps: null, stale: true }
  }

  const pcts = fresh.map((l) => l.pct).filter((p): p is number => p !== null)
  const bpss = fresh.map((l) => l.bps).filter((b): b is number => b !== null)

  return {
    pct: pcts.length > 0 ? Math.max(...pcts) : null,
    bps: bpss.length > 0 ? bpss.reduce((a, b) => a + b, 0) : null,
    stale,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// edgeGeometry
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum individual hoverable edges. */
const LINE_CAP = 600

type HiddenSet = Set<LogicalLayer | 'end'>

/** Check if an edge should be hidden based on its layers and hidden set. */
function isEdgeHidden(edge: LogicalEdge, graph: LogicalGraph, hidden: HiddenSet): boolean {
  // Check if either endpoint is 'end' tier and 'end' is hidden
  if (hidden.has('end')) {
    const nodeA = graph.nodes.find((n) => n.id === edge.a)
    const nodeB = graph.nodes.find((n) => n.id === edge.b)
    if (nodeA?.tier === 'end' || nodeB?.tier === 'end') {
      return true
    }
  }

  // Check if all edge layers are hidden
  const layers = Object.keys(edge.layers) as LogicalLayer[]
  if (layers.length === 0) {
    // Edge has no layers - check if it has a physical layer implied
    // Edges without explicit layers are physical-only
    return hidden.has('physical')
  }

  // Edge is hidden if ALL its layers are hidden
  return layers.every((layer) => hidden.has(layer))
}

/** Check if edge has an IGP layer (isis or ospf). */
function hasIgpLayer(edge: LogicalEdge): boolean {
  return 'isis' in edge.layers || 'ospf' in edge.layers
}

/** Check if edge touches an end-tier node. */
function isEndTierEdge(edge: LogicalEdge, graph: LogicalGraph): boolean {
  const nodeA = graph.nodes.find((n) => n.id === edge.a)
  const nodeB = graph.nodes.find((n) => n.id === edge.b)
  return nodeA?.tier === 'end' || nodeB?.tier === 'end'
}

/**
 * Compute edge geometry: individual hoverable edges and batched remainder.
 * Design: IGP and core edges first (up to 600 cap), all end-tier edges batched.
 * ponytail: 600 / 200 caps from the design; raise if graphs regularly exceed
 */
export function edgeGeometry(
  graph: LogicalGraph,
  positions: Map<string, [number, number, number]>,
  hidden: HiddenSet,
): EdgeGeometry {
  const lines: { id: string; points: [number, number, number][] }[] = []
  const batchPoints: number[] = []
  const batchIds: string[] = []

  // Sort edges: IGP first, then core edges
  const sortedEdges = [...graph.edges].sort((a, b) => {
    const aIgp = hasIgpLayer(a) ? 0 : 1
    const bIgp = hasIgpLayer(b) ? 0 : 1
    return aIgp - bIgp
  })

  for (const edge of sortedEdges) {
    if (isEdgeHidden(edge, graph, hidden)) continue

    const posA = positions.get(edge.a)
    const posB = positions.get(edge.b)
    if (!posA || !posB) continue

    // End-tier edges always go to batch (not individually hoverable)
    if (isEndTierEdge(edge, graph)) {
      batchPoints.push(...posA, ...posB)
      batchIds.push(edge.id)
      continue
    }

    if (lines.length < LINE_CAP) {
      lines.push({ id: edge.id, points: [posA, posB] })
    } else {
      // Batch the rest
      batchPoints.push(...posA, ...posB)
      batchIds.push(edge.id)
    }
  }

  return {
    lines,
    batch: { points: batchPoints, edgeIds: batchIds },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// edgeStyle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute edge style: color from utilisation, grey when stale,
 * width 2 with an IGP layer, dashed when an IGP layer has up < total.
 */
export function edgeStyle(edge: LogicalEdge, live: EdgeLive | null): EdgeStyle {
  // Color
  let color: string
  if (live?.stale) {
    color = theme.heatmap.noData
  } else if (live && live.pct !== null) {
    color = utilColor(live.pct)
  } else {
    color = theme.cable.up
  }

  // Width: 2 if has IGP layer, 1 otherwise
  const width = hasIgpLayer(edge) ? 2 : 1

  // Dashed: if any IGP layer has up < total
  let dashed = false
  const isisLayer = edge.layers.isis
  const ospfLayer = edge.layers.ospf
  if (isisLayer && isisLayer.up < isisLayer.total) dashed = true
  if (ospfLayer && ospfLayer.up < ospfLayer.total) dashed = true

  return { color, width, dashed }
}

// ─────────────────────────────────────────────────────────────────────────────
// edgeTooltip
// ─────────────────────────────────────────────────────────────────────────────

/** Layer display names. */
const LAYER_NAMES: Record<LogicalLayer, string> = {
  physical: 'Physical',
  isis: 'IS-IS',
  ospf: 'OSPF',
  sr: 'SR',
}

/**
 * Build tooltip content for an edge.
 * Lists layers with n/m up, and total bps.
 */
export function edgeTooltip(edge: LogicalEdge, live: EdgeLive | null): string {
  const parts: string[] = []

  // Layers
  const layers = Object.entries(edge.layers) as [LogicalLayer, { up: number; total: number; label: string }][]
  for (const [layer, state] of layers) {
    const name = LAYER_NAMES[layer] ?? layer
    parts.push(`${name}: ${state.up}/${state.total}`)
  }

  // Rate
  if (live && live.bps !== null) {
    parts.push(formatBps(live.bps))
  }

  return parts.join(' | ')
}

// ─────────────────────────────────────────────────────────────────────────────
// nodeClickAction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine what happens when a node is clicked.
 * - site: nodes at map level zoom to that site
 * - device nodes at site level select the device
 * - ext: nodes do nothing
 */
export function nodeClickAction(node: LogicalNode, level: ViewLevel): NodeClickAction {
  // ext: nodes do nothing
  if (node.id.startsWith('ext:')) return null

  // site: nodes at map level zoom to that site
  if (node.id.startsWith('site:') && level === 'map') {
    return { kind: 'site', name: node.name }
  }

  // Device nodes at site level select the device
  if (node.device && level === 'site') {
    return { kind: 'select', id: node.device.id }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// cameraFrame
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute camera position, target, and maxDistance for the logical view.
 * Span floored at 4 as in CameraRig.tsx:74.
 * Frames from elevated front-oblique to show tier bands and end-device curtains.
 */
export function cameraFrame(bounds: Bounds): CameraFrame {
  const cx = (bounds.max.x + bounds.min.x) / 2
  const cy = (bounds.max.y + bounds.min.y) / 2
  const cz = (bounds.max.z + bounds.min.z) / 2

  const spanX = bounds.max.x - bounds.min.x
  const spanY = bounds.max.y - bounds.min.y
  const spanZ = bounds.max.z - bounds.min.z
  // Floor span at 4
  const span = Math.max(spanX, spanY, spanZ, 4)

  // Position: elevated front-oblique, looking down at fabric from the front
  // Higher elevation angle so tiers read as distinct horizontal bands
  const dist = span * 1.2
  const position: [number, number, number] = [
    cx,                    // Centered horizontally
    cy + dist * 0.9,       // High above center
    cz + dist * 0.6,       // In front (positive z)
  ]

  // Target: slightly below center to show end-device curtains
  const target: [number, number, number] = [cx, cy - spanY * 0.1, cz]

  // maxDistance: allow zooming out to see the whole scene
  const maxDistance = span * 4

  return { position, target, maxDistance }
}
