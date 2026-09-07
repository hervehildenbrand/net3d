import { useEffect } from 'react'
import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiUrl, type Backend } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import type { DeviceIndexEntry } from '../lib/deviceSearch'

export type { DeviceIndexEntry }

export interface DeviceIndexData {
  devices: DeviceIndexEntry[]
  indexedSites: number
  totalSites: number
  prewarmEnabled: boolean
}

export function deviceIndexQueryOptions(backend: Backend) {
  return queryOptions({
    queryKey: ['devices', backend] as const,
    queryFn: async (): Promise<DeviceIndexData> => {
      const res = await fetch(apiUrl(backend, '/devices'))
      if (!res.ok) throw new Error(`devices: HTTP ${res.status}`)
      return {
        devices: await res.json(),
        indexedSites: Number(res.headers.get('X-Indexed-Sites') ?? 0),
        totalSites: Number(res.headers.get('X-Total-Sites') ?? 0),
        prewarmEnabled: res.headers.get('X-Prewarm-Enabled') === 'true',
      }
    },
    staleTime: 60_000,
    refetchInterval: (query) => {
      const coverage = query.state.data
      return coverage &&
        coverage.prewarmEnabled &&
        coverage.indexedSites < coverage.totalSites &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
        ? 15_000
        : false
    },
    refetchIntervalInBackground: false,
  })
}

export function subscribeToSiteSuccesses(queryClient: QueryClient, backend: Backend): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    const [scope, eventBackend, siteName] = event.query.queryKey
    if (scope !== 'site' || eventBackend !== backend || typeof siteName !== 'string') return
    void queryClient.invalidateQueries({ queryKey: ['devices', backend], exact: true })
  })
}

/** Device index for the active backend, refreshed as site caches become available. */
export function useDeviceIndex() {
  const backend = useAppStore((s) => s.backend)
  const queryClient = useQueryClient()
  useEffect(() => subscribeToSiteSuccesses(queryClient, backend), [backend, queryClient])
  return useQuery(deviceIndexQueryOptions(backend))
}
