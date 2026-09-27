import { queryOptions, useQuery } from '@tanstack/react-query'
import type { SiteTelemetry } from '@net3d/shared'
import { apiUrl, type Backend } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

const POLL_MS = 2_000 // Junos samples no faster than 2 s
// ponytail: every viewer polls every 2 s; move to server push (SSE fan-out) if viewer count loads netstatex

export function siteTelemetryQueryOptions(backend: Backend, siteName: string) {
  return queryOptions({
    queryKey: ['telemetry', backend, siteName] as const, // must NOT start with 'site' (useLiveUpdates / subscribeToSiteSuccesses prefix-match 'site')
    queryFn: async ({ signal }): Promise<SiteTelemetry> => {
      const res = await fetch(apiUrl(backend, `/telemetry/sites/${encodeURIComponent(siteName)}`), { signal })
      if (!res.ok) throw new Error(`telemetry ${siteName}: HTTP ${res.status}`)
      return res.json()
    },
    // stop only once the server says the site has no monitored device; errors keep polling
    refetchInterval: (q) => (q.state.data && Object.keys(q.state.data.devices).length === 0 ? false : POLL_MS),
    retry: false,
  })
}

/** Latest site telemetry; undefined while loading or after a failed poll (cables fall back to static colours). */
export function useSiteTelemetry(siteName: string | null, enabled: boolean): SiteTelemetry | undefined {
  const backend = useAppStore((s) => s.backend)
  const { data, isError } = useQuery({ ...siteTelemetryQueryOptions(backend, siteName ?? ''), enabled: !!enabled && !!siteName })
  return isError ? undefined : data
}
