import { queryOptions } from '@tanstack/react-query'
import type { CollectorTopology } from '@net3d/shared'
import { apiUrl, type Backend } from '../lib/api'

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
