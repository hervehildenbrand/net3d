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
  /** Logical mode at map level: draw backbone on Leaflet. */
  logicalMap: boolean
  /** Logical mode at site level: mount the SVG diagram. */
  siteDiagram: boolean
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

  // Logical mode seams: map draws backbone on Leaflet, site mounts SVG diagram
  const logicalMap = logical && level === 'map'
  const siteDiagram = logical && level === 'site'

  // View switch: shown when feature is available, not at rack level, not in edit mode
  const viewSwitch = featureAvailable && level !== 'rack' && !editModeActive

  // Logical layers panel: shown when logical view is active
  const logicalLayers = logical

  // Site search: shown at map level (regardless of view mode)
  const siteSearch = level === 'map'

  // Layers panel: shown at site/rack level, not in logical mode, not with selected device, not in edit mode, with racks
  const layersPanel = inScene && !logical && !selectedDevice && !editModeActive && !!siteDetail?.racks?.length

  // Power legend: shown at site level, power visible (handled by caller), not in edit mode, with racks
  // Hidden in logical mode - fixes v1 defect
  const powerLegend = level === 'site' && !logical && !editModeActive && !!siteDetail?.racks?.length

  // Edit toolbar: shown at site level with loaded site detail, hidden in logical mode
  const editToolbar = level === 'site' && !logical && !!siteDetail

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
    logicalMap,
    siteDiagram,
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
// visibleLayers / isEdgeHidden
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical layer order for tooltip display. */
const LAYER_ORDER: LogicalLayer[] = ['physical', 'isis', 'ospf', 'sr']

/**
 * Return the edge's layers that are not hidden, in the canonical order.
 * Used for tooltip generation and dash logic.
 */
export function visibleLayers(
  edge: LogicalEdge,
  hidden: ReadonlySet<LogicalLayer | 'end'>,
): LogicalLayer[] {
  const edgeLayers = Object.keys(edge.layers) as LogicalLayer[]
  return LAYER_ORDER.filter((l) => edgeLayers.includes(l) && !hidden.has(l))
}

/**
 * Check if an edge should be hidden based on its layers and hidden set.
 * An edge is hidden when:
 * - ALL its layers are hidden, OR
 * - 'end' is hidden and either endpoint is an end-tier node
 */
export function isEdgeHidden(
  edge: LogicalEdge,
  tierOf: ReadonlyMap<string, string>,
  hidden: ReadonlySet<LogicalLayer | 'end'>,
): boolean {
  // Check if either endpoint is 'end' tier and 'end' is hidden
  if (hidden.has('end')) {
    const tierA = tierOf.get(edge.a)
    const tierB = tierOf.get(edge.b)
    if (tierA === 'end' || tierB === 'end') {
      return true
    }
  }

  // Check if all edge layers are hidden
  const layers = Object.keys(edge.layers) as LogicalLayer[]
  if (layers.length === 0) {
    // Edge has no layers - physical-only implied
    return hidden.has('physical')
  }

  // Edge is hidden if ALL its layers are hidden
  return layers.every((layer) => hidden.has(layer))
}

// ─────────────────────────────────────────────────────────────────────────────
// edgeStyle
// ─────────────────────────────────────────────────────────────────────────────

/** Check if edge has an IGP layer (isis or ospf). */
function hasIgpLayer(edge: LogicalEdge): boolean {
  return 'isis' in edge.layers || 'ospf' in edge.layers
}

/**
 * Compute edge style: color from utilisation, grey when stale,
 * width 2 with an IGP layer, dashed when a VISIBLE IS-IS, OSPF or SR layer has up < total.
 */
export function edgeStyle(
  edge: LogicalEdge,
  live: EdgeLive | null,
  hidden: ReadonlySet<LogicalLayer | 'end'> = new Set(),
): EdgeStyle {
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

  // Dashed: if any VISIBLE IS-IS, OSPF or SR layer has up < total
  let dashed = false
  const isisLayer = edge.layers.isis
  const ospfLayer = edge.layers.ospf
  const srLayer = edge.layers.sr
  if (isisLayer && !hidden.has('isis') && isisLayer.up < isisLayer.total) dashed = true
  if (ospfLayer && !hidden.has('ospf') && ospfLayer.up < ospfLayer.total) dashed = true
  if (srLayer && !hidden.has('sr') && srLayer.up < srLayer.total) dashed = true

  return { color, width, dashed }
}

// ─────────────────────────────────────────────────────────────────────────────
// edgeTooltip
// ─────────────────────────────────────────────────────────────────────────────

/** Layer display names. */
export const LAYER_NAMES: Record<LogicalLayer, string> = {
  physical: 'Physical',
  isis: 'IS-IS',
  ospf: 'OSPF',
  sr: 'SR',
}

/**
 * Build tooltip content for an edge.
 * Lists layers with n/m up and label when non-empty, and total bps.
 * Format: 'IS-IS: 2/2 · L2 UP | SR: 1/1 · adj-SID 24712/24572 | 3 Gbps'
 */
export function edgeTooltip(edge: LogicalEdge, live: EdgeLive | null): string {
  const parts: string[] = []

  // Layers in canonical order
  for (const layer of LAYER_ORDER) {
    const state = edge.layers[layer]
    if (!state) continue
    const name = LAYER_NAMES[layer] ?? layer
    let segment = `${name}: ${state.up}/${state.total}`
    // Append label when non-empty
    if (state.label) {
      segment += ` · ${state.label}`
    }
    parts.push(segment)
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
 * - ext: nodes do nothing
 * - site: nodes (at any level) enter that site
 * - tier 'remote' nodes with a siteName enter that site (e.g. FRA1-core-01 at AMS1 -> FRA1)
 * - device nodes at site level select the device
 */
export function nodeClickAction(node: LogicalNode, level: ViewLevel): NodeClickAction {
  // ext: nodes do nothing
  if (node.id.startsWith('ext:')) return null

  // site: nodes enter that site at any level
  if (node.id.startsWith('site:')) {
    return { kind: 'site', name: node.name }
  }

  // tier 'remote' nodes with a siteName enter that site
  // (e.g. clicking FRA1-core-01 at AMS1 site view enters FRA1)
  if (node.tier === 'remote' && node.siteName) {
    return { kind: 'site', name: node.siteName }
  }

  // Device nodes at site level select the device
  if (node.device && level === 'site') {
    return { kind: 'select', id: node.device.id }
  }

  return null
}
