import { useMemo, useRef } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import {
  buildLogicalGraph,
  sotLinks,
  type CollectorTopology,
  type LogicalGraph,
  type LogicalEdge,
  type CircuitLive,
  type SiteTelemetry,
  type CircuitGroup,
  type GraphDevice,
  type TopologyCable,
} from '@net3d/shared'
import { apiUrl, type Backend } from '../lib/api'
import type { SiteDetailData } from './useSiteDetail'
import type { DeviceIndexData } from './useDeviceIndex'
import type { Site } from './useSites'
import type { LldpDiscovery } from './useLldpDiscovery'
import type { ViewLevel } from '../store/useAppStore'
import {
  graphInput,
  siteEdgeLive,
  mapEdgeLive,
  edgeGeometry,
  edgeStyle,
  edgeTooltip,
  nodeClickAction,
  cameraFrame,
  type EdgeLive,
  type Bounds,
} from '../lib/logicalView'
import { layoutSite, layoutBackbone, sitePairEdges } from '../lib/logicalLayout'

const POLL_MS = 30_000

export function siteTopologyQueryOptions(backend: Backend, siteName: string) {
  return queryOptions({
    queryKey: ['topology', backend, 'site', siteName] as const, // must NOT start with 'site' (useLiveUpdates prefix-match)
    queryFn: async ({ signal }): Promise<CollectorTopology> => {
      const res = await fetch(apiUrl(backend, `/telemetry/topology/sites/${encodeURIComponent(siteName)}`), { signal })
      if (!res.ok) throw new Error(`topology ${siteName}: HTTP ${res.status}`)
      return res.json()
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

export function backboneTopologyQueryOptions(backend: Backend) {
  return queryOptions({
    queryKey: ['topology', backend, 'backbone'] as const,
    queryFn: async ({ signal }): Promise<CollectorTopology> => {
      const res = await fetch(apiUrl(backend, '/telemetry/topology/backbone'), { signal })
      if (!res.ok) throw new Error(`topology backbone: HTTP ${res.status}`)
      return res.json()
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// useLogicalView — composes topology queries with data hooks and memos
// ─────────────────────────────────────────────────────────────────────────────

interface UseLogicalViewInput {
  enabled: boolean
  level: ViewLevel
  backend: Backend
  siteName: string | null
  siteDetail: SiteDetailData | undefined
  deviceIndex: DeviceIndexData | undefined
  sites: Site[] | undefined
  circuitGroups: CircuitGroup[] | undefined
  lldp: LldpDiscovery
  telemetry: SiteTelemetry | undefined
  circuitLive: Map<string, CircuitLive> | undefined
  hiddenLogical: Set<import('@net3d/shared').LogicalLayer | 'end'>
}

export interface LogicalViewData {
  graph: LogicalGraph
  positions: Map<string, [number, number, number]>
  bounds: Bounds
  geometry: import('../lib/logicalView').EdgeGeometry
  getEdgeLive: (edge: LogicalEdge) => EdgeLive | null
  getEdgeStyle: (edge: LogicalEdge, live: EdgeLive | null) => import('../lib/logicalView').EdgeStyle
  getEdgeTooltip: (edge: LogicalEdge, live: EdgeLive | null) => string
  getCameraFrame: (bounds: Bounds) => import('../lib/logicalView').CameraFrame
  getNodeClickAction: (node: import('@net3d/shared').LogicalNode, level: ViewLevel) => import('../lib/logicalView').NodeClickAction
  layers: import('@net3d/shared').LogicalLayer[]
  hasLive: boolean
}

export function useLogicalView(input: UseLogicalViewInput): { data: LogicalViewData | null; isError: boolean } {
  const {
    enabled,
    level,
    backend,
    siteName,
    siteDetail,
    deviceIndex,
    sites,
    circuitGroups,
    lldp,
    telemetry,
    circuitLive,
    hiddenLogical,
  } = input

  // Topology queries
  const siteTopologyEnabled = enabled && level === 'site' && !!siteName
  const backboneTopologyEnabled = enabled && level === 'map'

  const siteTopology = useQuery({
    ...siteTopologyQueryOptions(backend, siteName ?? ''),
    enabled: siteTopologyEnabled,
  })

  const backboneTopology = useQuery({
    ...backboneTopologyQueryOptions(backend),
    enabled: backboneTopologyEnabled,
  })

  // Keep last data on error
  const lastDataRef = useRef<LogicalViewData | null>(null)

  // Build devices list from siteDetail + deviceIndex
  const devices = useMemo<GraphDevice[]>(() => {
    if (!enabled) return []

    const result: GraphDevice[] = []
    const seen = new Set<string>()

    // Site detail devices (primary)
    if (siteDetail) {
      for (const rack of siteDetail.racks) {
        for (const d of rack.devices) {
          if (seen.has(d.id)) continue
          seen.add(d.id)
          result.push({
            id: d.id,
            name: d.name,
            siteName: siteName ?? '',
            roleName: d.roleName ?? '',
            roleColor: d.roleColor ?? '',
          })
        }
      }
    }

    // Device index (for backbone/cross-site)
    if (deviceIndex) {
      for (const d of deviceIndex.devices) {
        if (seen.has(d.id)) continue
        seen.add(d.id)
        result.push({
          id: d.id,
          name: d.name,
          siteName: d.siteName,
          roleName: d.roleName ?? '',
          roleColor: d.roleColor ?? '',
        })
      }
    }

    return result
  }, [enabled, siteDetail, deviceIndex, siteName])

  // Build SoT links from cables
  const links = useMemo<TopologyCable[]>(() => {
    if (!enabled || !siteDetail) return []
    return sotLinks(siteDetail.cables)
  }, [enabled, siteDetail])

  // Topology data
  const topology = level === 'site' ? siteTopology.data : backboneTopology.data

  // Build graph input
  const gi = useMemo(() => {
    if (!enabled || !circuitGroups) {
      return { circuits: [] as TopologyCable[], circuitSites: {} as Record<string, [string, string]> }
    }
    return graphInput(level, siteName, siteDetail?.cables ?? [], circuitGroups, topology)
  }, [enabled, level, siteName, siteDetail, circuitGroups, topology])

  // Build logical graph
  const graph = useMemo<LogicalGraph | null>(() => {
    if (!enabled) return null
    if (devices.length === 0 && !topology) return null

    return buildLogicalGraph(
      {
        devices,
        links,
        circuits: gi.circuits,
        circuitSites: gi.circuitSites,
        lldp: lldp.byDevice,
        topology,
      },
      level === 'site' ? siteName : null,
    )
  }, [enabled, devices, links, gi, lldp.byDevice, topology, level, siteName])

  // Add site-pair edges for backbone
  const graphWithSitePairs = useMemo<LogicalGraph | null>(() => {
    if (!graph || level !== 'map' || !circuitGroups) return graph
    const pairEdges = sitePairEdges(graph, circuitGroups)
    if (pairEdges.length === 0) return graph

    // Collect unique site: node IDs that need to be added
    const existingIds = new Set(graph.nodes.map((n) => n.id))
    const newSiteIds = new Set<string>()
    for (const e of pairEdges) {
      if (e.a.startsWith('site:') && !existingIds.has(e.a)) newSiteIds.add(e.a)
      if (e.b.startsWith('site:') && !existingIds.has(e.b)) newSiteIds.add(e.b)
    }

    return {
      nodes: [
        ...graph.nodes,
        ...[...newSiteIds].map((id) => ({
          id,
          name: id.slice(5),
          tier: 'remote' as const,
          siteName: id.slice(5),
          device: null,
          sid: null,
        })),
      ],
      edges: [...graph.edges, ...pairEdges],
    }
  }, [graph, level, circuitGroups])

  // Layout
  const layout = useMemo(() => {
    if (!graphWithSitePairs) return null
    if (level === 'site') {
      return layoutSite(graphWithSitePairs)
    }
    // Backbone layout
    if (!sites) return null
    return {
      positions: layoutBackbone(graphWithSitePairs, sites),
      bounds: {
        min: { x: -20, y: -2, z: -20 },
        max: { x: 20, y: 2, z: 20 },
      } as Bounds,
    }
  }, [graphWithSitePairs, level, sites])

  // Geometry (memoised on layout + hidden)
  const geometry = useMemo(() => {
    if (!graphWithSitePairs || !layout) return null
    return edgeGeometry(graphWithSitePairs, layout.positions, hiddenLogical)
  }, [graphWithSitePairs, layout, hiddenLogical])

  // Collect layers present in the graph
  const layers = useMemo(() => {
    if (!graphWithSitePairs) return []
    const layerSet = new Set<import('@net3d/shared').LogicalLayer>()
    for (const edge of graphWithSitePairs.edges) {
      for (const layer of Object.keys(edge.layers) as import('@net3d/shared').LogicalLayer[]) {
        layerSet.add(layer)
      }
    }
    return [...layerSet].sort()
  }, [graphWithSitePairs])

  // Edge live helper
  const getEdgeLive = useMemo(() => {
    return (edge: LogicalEdge): EdgeLive | null => {
      if (level === 'site' && telemetry) {
        return siteEdgeLive(edge, telemetry)
      }
      if (level === 'map' && circuitLive) {
        return mapEdgeLive(edge, circuitLive)
      }
      return null
    }
  }, [level, telemetry, circuitLive])

  // Check if any edge has live data
  const hasLive = useMemo(() => {
    if (!graphWithSitePairs) return false
    if (level === 'site' && telemetry) {
      return graphWithSitePairs.edges.some((e) => siteEdgeLive(e, telemetry) !== null)
    }
    if (level === 'map' && circuitLive) {
      return graphWithSitePairs.edges.some((e) => mapEdgeLive(e, circuitLive) !== null)
    }
    return false
  }, [graphWithSitePairs, level, telemetry, circuitLive])

  // Build result data
  const data = useMemo<LogicalViewData | null>(() => {
    if (!graphWithSitePairs || !layout || !geometry) return null

    return {
      graph: graphWithSitePairs,
      positions: layout.positions,
      bounds: layout.bounds,
      geometry,
      getEdgeLive,
      getEdgeStyle: (edge: LogicalEdge, live: EdgeLive | null) => edgeStyle(edge, live),
      getEdgeTooltip: (edge: LogicalEdge, live: EdgeLive | null) => edgeTooltip(edge, live),
      getCameraFrame: cameraFrame,
      getNodeClickAction: nodeClickAction,
      layers,
      hasLive,
    }
  }, [graphWithSitePairs, layout, geometry, getEdgeLive, layers, hasLive])

  // Keep last data on error
  if (data) {
    lastDataRef.current = data
  }

  const isError = (siteTopologyEnabled && siteTopology.isError) || (backboneTopologyEnabled && backboneTopology.isError)

  // Return last data on error
  return {
    data: data ?? lastDataRef.current,
    isError,
  }
}
