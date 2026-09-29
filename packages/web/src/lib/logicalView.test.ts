import { describe, expect, test } from 'vitest'
import type {
  LogicalEdge,
  LogicalGraph,
  LogicalLayer,
  LogicalNode,
  CircuitGroup,
  SiteTelemetry,
  CircuitLive,
  TopologyCable,
} from '@net3d/shared'
import type { SiteRack } from '../hooks/useSiteDetail'
import type { ViewLevel, ViewMode, ColorMode, CableColorMode } from '../store/useAppStore'
import type { Capabilities } from '../hooks/useCapabilities'
import { theme } from '../theme'
import { utilColor } from './liveTelemetry'
import {
  isLogicalActive,
  viewFlags,
  findDevice,
  graphInput,
  siteEdgeLive,
  mapEdgeLive,
  edgeGeometry,
  edgeStyle,
  edgeTooltip,
  nodeClickAction,
  cameraFrame,
  visibleLayers,
  isEdgeHidden,
} from './logicalView'

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NO_CAPS: Capabilities = {
  backend: 'netbox',
  version: null,
  napalmAvailable: false,
  liveUpdatesAvailable: false,
  telemetryAvailable: false,
}

const NAPALM_ONLY: Capabilities = { ...NO_CAPS, napalmAvailable: true }
const TELEMETRY_ONLY: Capabilities = { ...NO_CAPS, telemetryAvailable: true }
const BOTH_CAPS: Capabilities = { ...NO_CAPS, napalmAvailable: true, telemetryAvailable: true }

function dev(name: string, rackId = 'r1'): { id: string; name: string } {
  return { id: `dev-${name}`, name }
}

function rack(id: string, ...devices: { id: string; name: string }[]): SiteRack {
  return {
    id,
    name: `rack-${id}`,
    uHeight: 42,
    location: null,
    devices: devices.map((d) => ({
      ...d,
      position: 1,
      face: 'FRONT',
      roleName: 'router',
      roleColor: '#ccc',
      uHeight: 1,
      model: 'test',
      manufacturer: 'test',
      isFullDepth: false,
      status: 'active',
    })),
  }
}

interface StateInput {
  viewMode?: ViewMode
  level?: ViewLevel
  siteDetail?: { racks: SiteRack[] } | null
  selectedDevice?: { id: string } | null
  editModeActive?: boolean
  cableColorMode?: CableColorMode
  dcLinksVisible?: boolean
  colorMode?: ColorMode
}

function state(s: StateInput) {
  return {
    viewMode: s.viewMode ?? 'physical',
    level: s.level ?? 'map',
    siteDetail: s.siteDetail ?? null,
    selectedDevice: s.selectedDevice ?? null,
    editModeActive: s.editModeActive ?? false,
    cableColorMode: (s.cableColorMode ?? 'medium') as CableColorMode,
    dcLinksVisible: s.dcLinksVisible ?? false,
    colorMode: (s.colorMode ?? 'none') as ColorMode,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// isLogicalActive
// ─────────────────────────────────────────────────────────────────────────────

describe('isLogicalActive', () => {
  test('test_isLogicalActive_noCapabilities_false', () => {
    expect(isLogicalActive('logical', 'site', NO_CAPS)).toBe(false)
    expect(isLogicalActive('logical', 'map', NO_CAPS)).toBe(false)
  })

  test('test_isLogicalActive_rack_false', () => {
    // Rack level is always physical
    expect(isLogicalActive('physical', 'rack', BOTH_CAPS)).toBe(false)
    expect(isLogicalActive('logical', 'rack', BOTH_CAPS)).toBe(false)
  })

  test('test_isLogicalActive_napalmOnlySite_true', () => {
    // Site: either capability suffices
    expect(isLogicalActive('logical', 'site', NAPALM_ONLY)).toBe(true)
  })

  test('test_isLogicalActive_napalmOnlyMap_false', () => {
    // Map: telemetryAvailable only (NAPALM is never queried at map level)
    expect(isLogicalActive('logical', 'map', NAPALM_ONLY)).toBe(false)
    expect(isLogicalActive('logical', 'map', TELEMETRY_ONLY)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// viewFlags
// ─────────────────────────────────────────────────────────────────────────────

describe('viewFlags', () => {
  test('test_viewFlags_physical_matchesLegacy', () => {
    // Map level, physical mode
    const mapPhysical = viewFlags(state({ level: 'map', viewMode: 'physical' }), BOTH_CAPS)
    expect(mapPhysical.logical).toBe(false)
    expect(mapPhysical.inScene).toBe(false)
    expect(mapPhysical.viewSwitch).toBe(true) // shown at map level
    expect(mapPhysical.logicalLayers).toBe(false)
    expect(mapPhysical.siteSearch).toBe(true)
    expect(mapPhysical.layersPanel).toBe(false) // not at map
    expect(mapPhysical.powerLegend).toBe(false) // only at site
    expect(mapPhysical.editToolbar).toBe(false) // only at site
    expect(mapPhysical.poll.circuits).toBe(true)
    expect(mapPhysical.poll.siteTelemetry).toBe(false)
    expect(mapPhysical.poll.siteTopology).toBe(false)
    expect(mapPhysical.poll.backboneTopology).toBe(false)

    // Site level, physical mode with loaded site detail
    const sitePhysical = viewFlags(
      state({ level: 'site', viewMode: 'physical', siteDetail: { racks: [rack('r1')] } }),
      BOTH_CAPS,
    )
    expect(sitePhysical.logical).toBe(false)
    expect(sitePhysical.inScene).toBe(true)
    expect(sitePhysical.viewSwitch).toBe(true)
    expect(sitePhysical.logicalLayers).toBe(false)
    expect(sitePhysical.siteSearch).toBe(false) // only at map
    expect(sitePhysical.layersPanel).toBe(true)
    expect(sitePhysical.editToolbar).toBe(true)
    // poll.siteTelemetry depends on cableColorMode or selectedDevice
    expect(sitePhysical.poll.siteTelemetry).toBe(false)
    expect(sitePhysical.poll.circuits).toBe(false) // only at map or with dcLinks

    // Rack level, physical mode
    const rackPhysical = viewFlags(
      state({ level: 'rack', viewMode: 'physical', siteDetail: { racks: [rack('r1')] } }),
      BOTH_CAPS,
    )
    expect(rackPhysical.logical).toBe(false)
    expect(rackPhysical.inScene).toBe(true)
    expect(rackPhysical.viewSwitch).toBe(false) // hidden at rack
    expect(rackPhysical.layersPanel).toBe(true)
    expect(rackPhysical.powerLegend).toBe(false) // only at site
  })

  test('test_viewFlags_featureOff_matchesLegacy', () => {
    // When the feature is unavailable (no caps), everything reverts to physical behavior
    const mapNoCaps = viewFlags(state({ level: 'map', viewMode: 'logical' }), NO_CAPS)
    expect(mapNoCaps.logical).toBe(false)
    expect(mapNoCaps.viewSwitch).toBe(false) // switch hidden when unavailable
    expect(mapNoCaps.poll.backboneTopology).toBe(false)

    const siteNoCaps = viewFlags(
      state({ level: 'site', viewMode: 'logical', siteDetail: { racks: [rack('r1')] } }),
      NO_CAPS,
    )
    expect(siteNoCaps.logical).toBe(false)
    expect(siteNoCaps.viewSwitch).toBe(false)
    expect(siteNoCaps.poll.siteTopology).toBe(false)
  })

  test('test_viewFlags_logicalMap_keepsSiteSearchAndCircuitPoll', () => {
    const flags = viewFlags(state({ level: 'map', viewMode: 'logical' }), TELEMETRY_ONLY)
    expect(flags.logical).toBe(true)
    expect(flags.siteSearch).toBe(true)
    expect(flags.poll.circuits).toBe(true)
    expect(flags.poll.backboneTopology).toBe(true)
    expect(flags.poll.siteTelemetry).toBe(false)
    expect(flags.poll.siteTopology).toBe(false)
  })

  test('test_viewFlags_logicalSiteNotLoaded_noTopologyPoll', () => {
    // Site detail not loaded yet
    const flags = viewFlags(state({ level: 'site', viewMode: 'logical', siteDetail: null }), BOTH_CAPS)
    expect(flags.logical).toBe(true)
    expect(flags.poll.siteTopology).toBe(false) // needs siteDetail
    expect(flags.poll.siteTelemetry).toBe(false) // needs siteDetail
  })

  test('test_viewFlags_napalmOnly_noCollectorPolls', () => {
    const flags = viewFlags(
      state({ level: 'site', viewMode: 'logical', siteDetail: { racks: [rack('r1')] } }),
      NAPALM_ONLY,
    )
    expect(flags.logical).toBe(true)
    expect(flags.poll.siteTopology).toBe(false) // no telemetry
    expect(flags.poll.siteTelemetry).toBe(false) // no telemetry
    expect(flags.poll.backboneTopology).toBe(false)
  })

  test('test_viewFlags_editMode_hidesSwitch', () => {
    const flags = viewFlags(
      state({ level: 'site', viewMode: 'physical', siteDetail: { racks: [rack('r1')] }, editModeActive: true }),
      BOTH_CAPS,
    )
    expect(flags.viewSwitch).toBe(false)
  })

  test('test_viewFlags_logicalMap_keepsLeafletVisible', () => {
    // At map+logical, the Leaflet map stays up (inScene false), backbone drawn on it
    const flags = viewFlags(state({ level: 'map', viewMode: 'logical' }), TELEMETRY_ONLY)
    expect(flags.logical).toBe(true)
    expect(flags.logicalMap).toBe(true)
    expect(flags.siteDiagram).toBe(false)
    expect(flags.inScene).toBe(false) // Leaflet visible
  })

  test('test_viewFlags_logicalSite_mountsDiagramHidesEditToolbarAndPowerLegend', () => {
    // At site+logical: siteDiagram true, inScene true (scene mount), editToolbar/powerLegend false
    const flags = viewFlags(
      state({ level: 'site', viewMode: 'logical', siteDetail: { racks: [rack('r1')] } }),
      BOTH_CAPS,
    )
    expect(flags.logical).toBe(true)
    expect(flags.logicalMap).toBe(false)
    expect(flags.siteDiagram).toBe(true)
    expect(flags.inScene).toBe(true)
    expect(flags.editToolbar).toBe(false) // hidden in logical
    expect(flags.powerLegend).toBe(false) // hidden in logical
    expect(flags.poll.siteTopology).toBe(true)
  })

  test('test_viewFlags_napalmOnlyMap_physicalMap', () => {
    // NAPALM-only at map level: logical is unavailable (map requires telemetry)
    const flags = viewFlags(state({ level: 'map', viewMode: 'logical' }), NAPALM_ONLY)
    expect(flags.logical).toBe(false)
    expect(flags.logicalMap).toBe(false)
    expect(flags.siteDiagram).toBe(false)
    // Physical behavior
    expect(flags.poll.backboneTopology).toBe(false)
  })

  test('test_viewFlags_featureOff_noLogicalSurfaces', () => {
    // With NO_CAPS and viewMode logical: logicalMap and siteDiagram stay false
    const mapFlags = viewFlags(state({ level: 'map', viewMode: 'logical' }), NO_CAPS)
    expect(mapFlags.logicalMap).toBe(false)
    expect(mapFlags.siteDiagram).toBe(false)

    // At site, editToolbar/powerLegend are true (legacy behavior)
    const siteFlags = viewFlags(
      state({ level: 'site', viewMode: 'logical', siteDetail: { racks: [rack('r1')] } }),
      NO_CAPS,
    )
    expect(siteFlags.logicalMap).toBe(false)
    expect(siteFlags.siteDiagram).toBe(false)
    expect(siteFlags.editToolbar).toBe(true) // legacy behavior
    expect(siteFlags.powerLegend).toBe(true) // legacy behavior
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// findDevice
// ─────────────────────────────────────────────────────────────────────────────

describe('findDevice', () => {
  const r1 = rack('r1', dev('d1'))
  const r2 = rack('r2', dev('d2'))
  const racks = [r1, r2]

  test('test_findDevice_physicalWithoutRack_undefined', () => {
    // In physical mode, if no rack is selected, findDevice returns undefined
    const result = findDevice(racks, null, 'dev-d1', false)
    expect(result).toBeUndefined()
  })

  test('test_findDevice_logical_returnsOwningRack', () => {
    // In logical mode, search all racks
    const result = findDevice(racks, null, 'dev-d2', true)
    expect(result).toBeDefined()
    expect(result!.device.id).toBe('dev-d2')
    expect(result!.rack.id).toBe('r2')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// graphInput
// ─────────────────────────────────────────────────────────────────────────────

describe('graphInput', () => {
  test('test_graphInput_noTopology_circuitStubsFromCables', () => {
    const cables = [
      {
        id: 'c1',
        type: null,
        status: 'connected',
        color: '',
        a: { kind: 'circuit' as const, name: 'cid-1', deviceName: null, rackName: null, ifaceType: null },
        b: { kind: 'device' as const, name: 'et-0/0/0', deviceName: 'edge-router-1', rackName: 'r1', ifaceType: '100gbase' },
      },
    ]
    const circuitGroups: CircuitGroup[] = [
      {
        siteA: 'site-a',
        siteZ: 'site-b',
        count: 1,
        circuitIds: ['1'], // NetBox numeric id
        circuits: [{ id: '1', cid: 'cid-1', provider: null, siteA: 'site-a', siteZ: 'site-b', commitRate: null, status: 'active', description: null }],
        maxCommitRate: null,
      },
    ]

    const input = graphInput('site', 'site-a', cables, circuitGroups, undefined)

    // Without topology, circuits come from circuitLinks(cables)
    expect(input.circuits.length).toBeGreaterThan(0)
    expect(input.circuits[0]!.id).toBe('cid-1')
    expect(input.circuitSites['cid-1']).toEqual(['site-a', 'site-b'])
  })

  test('test_graphInput_circuitSites_keyedByCid', () => {
    // Regression: circuitIds holds NetBox numeric IDs (e.g. "25"),
    // but topology and edges use string CIDs (e.g. "PROVIDER-SITE-A-SITE-B-001").
    // circuitSites must be keyed by cid, not numeric id.
    const cables: Parameters<typeof graphInput>[2] = []
    const circuitGroups: CircuitGroup[] = [
      {
        siteA: 'site-a',
        siteZ: 'site-b',
        count: 2,
        circuitIds: ['25', '26'], // numeric NetBox IDs
        circuits: [
          { id: '25', cid: 'PROVIDER-SITE-A-SITE-B-001', provider: 'provider-1', siteA: 'site-a', siteZ: 'site-b', commitRate: null, status: 'active', description: null },
          { id: '26', cid: 'PROVIDER-SITE-A-SITE-B-002', provider: 'provider-1', siteA: 'site-a', siteZ: 'site-b', commitRate: null, status: 'active', description: null },
        ],
        maxCommitRate: null,
      },
    ]

    const input = graphInput('map', null, cables, circuitGroups, undefined)

    // Must be keyed by cid, NOT numeric id
    expect(input.circuitSites['PROVIDER-SITE-A-SITE-B-001']).toEqual(['site-a', 'site-b'])
    expect(input.circuitSites['PROVIDER-SITE-A-SITE-B-002']).toEqual(['site-a', 'site-b'])
    // Numeric IDs must NOT appear as keys
    expect(input.circuitSites['25']).toBeUndefined()
    expect(input.circuitSites['26']).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// siteEdgeLive
// ─────────────────────────────────────────────────────────────────────────────

describe('siteEdgeLive', () => {
  test('test_siteEdgeLive_igpMemberWithUnit_fallsBackToBase', () => {
    // Member interface is 'et-0/0/0.0' but telemetry has 'et-0/0/0'
    const edge: LogicalEdge = {
      id: 'a~b',
      a: 'edge-router-1',
      b: 'edge-router-2',
      layers: {},
      members: [
        { id: 'lldp:edge-router-1:et-0/0/0.0', a: { deviceName: 'edge-router-1', name: 'et-0/0/0.0' }, b: { deviceName: 'edge-router-2', name: 'et-0/0/0' } },
      ],
    }
    const telemetry: SiteTelemetry = {
      devices: {
        'edge-router-1': { 'et-0/0/0': { rxBps: 1e9, txBps: 2e9, capacityBps: 10e9, stale: false } },
        'edge-router-2': { 'et-0/0/0': { rxBps: 3e9, txBps: 4e9, capacityBps: 10e9, stale: false } },
      },
    }

    const live = siteEdgeLive(edge, telemetry)
    // Falls back to base interface
    expect(live).not.toBeNull()
    expect(live!.bps).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// mapEdgeLive
// ─────────────────────────────────────────────────────────────────────────────

describe('mapEdgeLive', () => {
  test('test_mapEdgeLive_circuitMember_usesCid', () => {
    const edge: LogicalEdge = {
      id: 'site:site-a~site:site-b',
      a: 'site:site-a',
      b: 'site:site-b',
      layers: {},
      members: [{ id: 'cid-1', a: null, b: null }],
    }
    const circuitLive = new Map<string, CircuitLive>([
      ['cid-1', { pct: 50, bps: 5e9, stale: false }],
    ])

    const live = mapEdgeLive(edge, circuitLive)
    expect(live).not.toBeNull()
    expect(live!.pct).toBe(50)
    expect(live!.bps).toBe(5e9)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// visibleLayers
// ─────────────────────────────────────────────────────────────────────────────

describe('visibleLayers', () => {
  const edge = (layers: LogicalEdge['layers']): LogicalEdge => ({
    id: 'a~b',
    a: 'a',
    b: 'b',
    layers,
    members: [],
  })

  test('test_visibleLayers_noHidden_returnsAll', () => {
    const e = edge({ isis: { up: 1, total: 1, label: 'L2' }, sr: { up: 1, total: 1, label: '' } })
    const visible = visibleLayers(e, new Set())
    expect(visible).toEqual(['isis', 'sr'])
  })

  test('test_visibleLayers_isisHidden_omitsIsis', () => {
    const e = edge({ isis: { up: 1, total: 1, label: '' }, sr: { up: 1, total: 1, label: '' }, physical: { up: 1, total: 1, label: '' } })
    const visible = visibleLayers(e, new Set(['isis']))
    expect(visible).toEqual(['physical', 'sr'])
    expect(visible).not.toContain('isis')
  })

  test('test_visibleLayers_allHidden_returnsEmpty', () => {
    const e = edge({ isis: { up: 1, total: 1, label: '' } })
    const visible = visibleLayers(e, new Set(['isis']))
    expect(visible).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isEdgeHidden
// ─────────────────────────────────────────────────────────────────────────────

describe('isEdgeHidden', () => {
  const node = (id: string, tier: 'core' | 'end' = 'core'): LogicalNode => ({
    id,
    name: id,
    tier,
    siteName: 'site-a',
    device: null,
    sid: null,
  })

  const edge = (a: string, b: string, layers: LogicalEdge['layers']): LogicalEdge => ({
    id: `${a}~${b}`,
    a,
    b,
    layers,
    members: [],
  })

  const tierOf = (nodes: LogicalNode[]): ReadonlyMap<string, string> =>
    new Map(nodes.map((n) => [n.id, n.tier]))

  test('test_isEdgeHidden_allLayersHidden_true', () => {
    const nodes = [node('a'), node('b')]
    const e = edge('a', 'b', { isis: { up: 1, total: 1, label: '' } })
    expect(isEdgeHidden(e, tierOf(nodes), new Set(['isis']))).toBe(true)
  })

  test('test_isEdgeHidden_oneLayerStillShown_false', () => {
    const nodes = [node('a'), node('b')]
    const e = edge('a', 'b', { isis: { up: 1, total: 1, label: '' }, physical: { up: 1, total: 1, label: '' } })
    // isis hidden, physical visible -> edge shown
    expect(isEdgeHidden(e, tierOf(nodes), new Set(['isis']))).toBe(false)
  })

  test('test_isEdgeHidden_endHidden_hidesEndEdges', () => {
    const nodes = [node('core', 'core'), node('server', 'end')]
    const e = edge('core', 'server', { physical: { up: 1, total: 1, label: '' } })
    expect(isEdgeHidden(e, tierOf(nodes), new Set(['end']))).toBe(true)
  })

  test('test_isEdgeHidden_layerlessEdge_followsPhysical', () => {
    const nodes = [node('a'), node('b')]
    const e = edge('a', 'b', {}) // no layers
    // No layers = physical-only implied; hidden when physical hidden
    expect(isEdgeHidden(e, tierOf(nodes), new Set(['physical']))).toBe(true)
    expect(isEdgeHidden(e, tierOf(nodes), new Set())).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// edgeGeometry
// ─────────────────────────────────────────────────────────────────────────────

describe('edgeGeometry', () => {
  const node = (id: string, tier: 'core' | 'end' = 'core'): LogicalNode => ({
    id,
    name: id,
    tier,
    siteName: 'site-a',
    device: null,
    sid: null,
  })

  const edge = (a: string, b: string, hasIgp = true): LogicalEdge => ({
    id: `${a}~${b}`,
    a,
    b,
    layers: hasIgp ? { isis: { up: 1, total: 1, label: 'L2 UP' } } : {},
    members: [],
  })

  const graph = (nodes: LogicalNode[], edges: LogicalEdge[]): LogicalGraph => ({ nodes, edges })
  const positions = new Map<string, [number, number, number]>([
    ['a', [0, 0, 0]],
    ['b', [1, 0, 0]],
    ['c', [2, 0, 0]],
    ['d', [3, 0, 0]],
  ])

  test('test_edgeGeometry_allLayersHidden_omitsEdge', () => {
    const g = graph([node('a'), node('b')], [edge('a', 'b', true)])
    const hidden = new Set(['isis', 'ospf', 'sr', 'physical'] as const)
    const geom = edgeGeometry(g, positions, hidden)
    // Edge has only isis layer which is hidden
    expect(geom.lines.length).toBe(0)
    expect(geom.batch.edgeIds.length).toBe(0)
  })

  test('test_edgeGeometry_endHidden_omitsEndEdges', () => {
    const g = graph([node('a', 'core'), node('b', 'end')], [edge('a', 'b', false)])
    const hidden = new Set(['end'] as const)
    const geom = edgeGeometry(g, positions, hidden)
    expect(geom.lines.length).toBe(0)
    expect(geom.batch.edgeIds.length).toBe(0)
  })

  test('test_edgeGeometry_overCap_batchesNonIgpEdges', () => {
    // Create more than 600 edges; non-IGP edges go to batch
    const nodes: LogicalNode[] = []
    const edges: LogicalEdge[] = []
    const pos = new Map<string, [number, number, number]>()

    for (let i = 0; i < 650; i++) {
      const a = `n${i}`
      const b = `n${i + 1000}`
      nodes.push(node(a, 'core'), node(b, 'core'))
      edges.push(edge(a, b, i < 100)) // first 100 have IGP, rest don't
      pos.set(a, [i, 0, 0])
      pos.set(b, [i + 1, 0, 0])
    }

    const geom = edgeGeometry(graph(nodes, edges), pos, new Set())
    // IGP edges (first 100) go to lines, capped at 600, rest go to batch
    // Actually all 100 IGP + up to 500 non-IGP fit in lines (600 cap)
    // The remaining 50 non-IGP go to batch
    expect(geom.lines.length).toBeLessThanOrEqual(600)
    expect(geom.batch.edgeIds.length).toBeGreaterThan(0)
  })

  test('test_edgeGeometry_endTierEdges_alwaysBatched', () => {
    // End-tier edges always go to batch, regardless of the 600 cap
    // Design: "The rest, and all end-tier edges, go into one <Line segments vertexColors>"
    const nodes: LogicalNode[] = [
      node('core-1', 'core'),
      node('core-2', 'core'),
      node('end-1', 'end'),
      node('end-2', 'end'),
    ]
    const edges: LogicalEdge[] = [
      edge('core-1', 'core-2', true), // core-to-core, IGP
      { id: 'core-1~end-1', a: 'core-1', b: 'end-1', layers: { physical: { up: 1, total: 1, label: '' } }, members: [] },
      { id: 'core-2~end-2', a: 'core-2', b: 'end-2', layers: { physical: { up: 1, total: 1, label: '' } }, members: [] },
    ]
    const pos = new Map<string, [number, number, number]>([
      ['core-1', [0, 0, 0]],
      ['core-2', [1, 0, 0]],
      ['end-1', [2, 0, 0]],
      ['end-2', [3, 0, 0]],
    ])

    const geom = edgeGeometry(graph(nodes, edges), pos, new Set())

    // End-tier edges should be in batch, not lines, even though we're well under 600
    const endTierEdgeIds = ['core-1~end-1', 'core-2~end-2']
    const linesWithEndTier = geom.lines.filter((l) => endTierEdgeIds.includes(l.id))
    expect(linesWithEndTier.length).toBe(0)

    // They should be in the batch
    const batchedEndTier = geom.batch.edgeIds.filter((id) => endTierEdgeIds.includes(id))
    expect(batchedEndTier.length).toBe(2)

    // Core-to-core edge should be in lines
    expect(geom.lines.some((l) => l.id === 'core-1~core-2')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// edgeStyle
// ─────────────────────────────────────────────────────────────────────────────

describe('edgeStyle', () => {
  const edge = (layers: LogicalEdge['layers']): LogicalEdge => ({
    id: 'a~b',
    a: 'a',
    b: 'b',
    layers,
    members: [],
  })

  test('test_edgeStyle_igpPartlyDown_dashed', () => {
    const e = edge({ isis: { up: 1, total: 2, label: 'L2' } })
    const style = edgeStyle(e, { pct: 30, bps: 3e9, stale: false })
    expect(style.dashed).toBe(true)
    expect(style.width).toBe(2) // has IGP layer
    expect(style.color).toBe(utilColor(30))
  })

  test('test_edgeStyle_staleLink_grey', () => {
    const e = edge({ physical: { up: 1, total: 1, label: '' } })
    const style = edgeStyle(e, { pct: 50, bps: 5e9, stale: true })
    expect(style.color).toBe(theme.heatmap.noData)
    expect(style.dashed).toBe(false) // physical fully up
  })

  test('test_edgeStyle_srAdjacencyDown_dashed', () => {
    // SR layer with up < total should dash (same as IGP)
    const e = edge({ sr: { up: 0, total: 1, label: 'adj-SID 24712' } })
    const style = edgeStyle(e, null)
    expect(style.dashed).toBe(true)
  })

  test('test_edgeStyle_hiddenLayerNeverDashes', () => {
    // ISIS is down but hidden - should NOT dash
    const e = edge({ isis: { up: 0, total: 1, label: 'L2' }, physical: { up: 1, total: 1, label: '' } })
    const hidden = new Set<LogicalLayer>(['isis'])
    const style = edgeStyle(e, null, hidden)
    expect(style.dashed).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// edgeTooltip
// ─────────────────────────────────────────────────────────────────────────────

describe('edgeTooltip', () => {
  test('test_edgeTooltip_layersAndBps_listed', () => {
    const edge: LogicalEdge = {
      id: 'a~b',
      a: 'a',
      b: 'b',
      layers: {
        isis: { up: 2, total: 2, label: 'L2 UP metric 10' },
        ospf: { up: 1, total: 1, label: 'area 0 FULL' },
      },
      members: [],
    }
    const tooltip = edgeTooltip(edge, { pct: 30, bps: 3e9, stale: false })
    expect(tooltip).toContain('IS-IS')
    expect(tooltip).toContain('2/2')
    expect(tooltip).toContain('OSPF')
    expect(tooltip).toContain('1/1')
    expect(tooltip).toContain('3 Gbps')
  })

  test('test_edgeTooltip_includesLayerLabel_listed', () => {
    // Each layer segment carries its label when non-empty
    const edge: LogicalEdge = {
      id: 'a~b',
      a: 'a',
      b: 'b',
      layers: {
        sr: { up: 1, total: 1, label: 'adj-SID 24712/24572' },
        isis: { up: 2, total: 2, label: 'L2 UP' },
      },
      members: [],
    }
    const tooltip = edgeTooltip(edge, null)
    // e.g. 'IS-IS: 2/2 · L2 UP'
    expect(tooltip).toContain('IS-IS: 2/2')
    expect(tooltip).toContain('L2 UP')
    expect(tooltip).toContain('SR: 1/1')
    expect(tooltip).toContain('adj-SID 24712/24572')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// nodeClickAction
// ─────────────────────────────────────────────────────────────────────────────

describe('nodeClickAction', () => {
  const siteNode: LogicalNode = {
    id: 'site:site-a',
    name: 'site-a',
    tier: 'remote',
    siteName: 'site-a',
    device: null,
    sid: null,
  }

  const deviceNode: LogicalNode = {
    id: 'edge-router-1',
    name: 'edge-router-1',
    tier: 'core',
    siteName: 'site-a',
    device: { id: 'd1', name: 'edge-router-1', siteName: 'site-a', roleName: 'router', roleColor: '#ccc' },
    sid: null,
  }

  const extNode: LogicalNode = {
    id: 'ext:unknown-device',
    name: 'unknown-device',
    tier: 'end',
    siteName: null,
    device: null,
    sid: null,
  }

  const remotePeerNode: LogicalNode = {
    id: 'FRA1-core-01',
    name: 'FRA1-core-01',
    tier: 'remote',
    siteName: 'FRA1',
    device: null,
    sid: null,
  }

  test('test_nodeClickAction_siteNode_entersSite', () => {
    // site: nodes enter the site at any level, not just map
    const action = nodeClickAction(siteNode, 'site')
    expect(action).toEqual({ kind: 'site', name: 'site-a' })
    // Also works at map level
    const mapAction = nodeClickAction(siteNode, 'map')
    expect(mapAction).toEqual({ kind: 'site', name: 'site-a' })
  })

  test('test_nodeClickAction_remotePeerAtSite_entersPeerSite', () => {
    // tier 'remote' with a siteName enters that site (e.g. FRA1-core-01 -> FRA1)
    const action = nodeClickAction(remotePeerNode, 'site')
    expect(action).toEqual({ kind: 'site', name: 'FRA1' })
  })

  test('test_nodeClickAction_deviceAtSite_selects', () => {
    const action = nodeClickAction(deviceNode, 'site')
    expect(action).toEqual({ kind: 'select', id: 'd1' })
  })

  test('test_nodeClickAction_extNode_null', () => {
    const action = nodeClickAction(extNode, 'site')
    expect(action).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// cameraFrame
// ─────────────────────────────────────────────────────────────────────────────

describe('cameraFrame', () => {
  test('test_cameraFrame_tinyBounds_spanFloored', () => {
    // Bounds smaller than 4 should be floored to 4 (as in CameraRig.tsx:74)
    const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }
    const frame = cameraFrame(bounds)
    expect(frame.position).toBeDefined()
    expect(frame.target).toBeDefined()
    // maxDistance is based on span, floored at 4
    expect(frame.maxDistance).toBeGreaterThanOrEqual(4)
  })
})
