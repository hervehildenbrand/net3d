import { useMemo } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import {
  buildLogicalGraph,
  sotLinks,
  type CollectorTopology,
  type LogicalGraph,
  type LogicalEdge,
  type CircuitGroup,
  type GraphDevice,
  type TopologyCable,
  type SiteTelemetry,
  type LogicalLayer,
} from '@net3d/shared'
import { apiUrl, type Backend } from '../lib/api'
import type { SiteDetailData } from './useSiteDetail'
import type { DeviceIndexData } from './useDeviceIndex'
import type { LldpDiscovery } from './useLldpDiscovery'
import type { ViewLevel } from '../store/useAppStore'
import {
  graphInput,
  siteEdgeLive,
  type EdgeLive,
} from '../lib/logicalView'

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
  circuitGroups: CircuitGroup[] | undefined
  lldp: LldpDiscovery
  telemetry: SiteTelemetry | undefined
  // Topology poll gates from flags.poll.*
  pollSiteTopology: boolean
  pollBackboneTopology: boolean
}

/** Data that only changes when topology/siteDetail/lldp change, never on a telemetry poll. */
export interface LogicalViewData {
  graph: LogicalGraph
  layers: LogicalLayer[]
}

/** Live telemetry accessors — new identity each poll. */
export interface LogicalLive {
  getEdgeLive: (edge: LogicalEdge) => EdgeLive | null
  hasLive: boolean
}

export function useLogicalView(input: UseLogicalViewInput): { data: LogicalViewData | null; live: LogicalLive; isError: boolean } {
  const {
    enabled,
    level,
    backend,
    siteName,
    siteDetail,
    deviceIndex,
    circuitGroups,
    lldp,
    telemetry,
    pollSiteTopology,
    pollBackboneTopology,
  } = input

  // Topology queries — gated by flags.poll.* so NAPALM-only deployments never poll a 404 route
  const siteTopologyEnabled = pollSiteTopology && enabled && level === 'site' && !!siteName
  const backboneTopologyEnabled = pollBackboneTopology && enabled && level === 'map'

  const siteTopology = useQuery({
    ...siteTopologyQueryOptions(backend, siteName ?? ''),
    enabled: siteTopologyEnabled,
  })

  const backboneTopology = useQuery({
    ...backboneTopologyQueryOptions(backend),
    enabled: backboneTopologyEnabled,
  })

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

  // Build logical graph — identity changes only when topology/siteDetail/lldp change
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

  // Collect layers present in the graph
  const layers = useMemo<LogicalLayer[]>(() => {
    if (!graph) return []
    const layerSet = new Set<LogicalLayer>()
    for (const edge of graph.edges) {
      for (const layer of Object.keys(edge.layers) as LogicalLayer[]) {
        layerSet.add(layer)
      }
    }
    return [...layerSet].sort()
  }, [graph])

  // Edge live helper — site level only for now (Task 4 adds map-level via ArcLayer)
  const getEdgeLive = useMemo(() => {
    return (edge: LogicalEdge): EdgeLive | null => {
      if (level === 'site' && telemetry) {
        return siteEdgeLive(edge, telemetry)
      }
      return null
    }
  }, [level, telemetry])

  // Check if any edge has live data
  const hasLive = useMemo(() => {
    if (!graph) return false
    if (level === 'site' && telemetry) {
      return graph.edges.some((e) => siteEdgeLive(e, telemetry) !== null)
    }
    return false
  }, [graph, level, telemetry])

  // Build data (graph + layers) — stable identity across telemetry polls
  const data = useMemo<LogicalViewData | null>(() => {
    if (!graph) return null
    return { graph, layers }
  }, [graph, layers])

  // Build live accessors — new identity each telemetry poll
  const live = useMemo<LogicalLive>(() => {
    return { getEdgeLive, hasLive }
  }, [getEdgeLive, hasLive])

  const isError = (siteTopologyEnabled && siteTopology.isError) || (backboneTopologyEnabled && backboneTopology.isError)

  return { data, live, isError }
}
