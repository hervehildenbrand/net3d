import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiUrl, type Backend } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

export interface Capabilities {
  /** Which source of truth is serving data. */
  backend: 'netbox' | 'infrahub'
  /** Backend version string, or null if unknown. */
  version: string | null
  napalmAvailable: boolean
  liveUpdatesAvailable: boolean
  telemetryAvailable: boolean
}

const NO_CAPABILITIES: Capabilities = {
  backend: 'netbox',
  version: null,
  napalmAvailable: false,
  liveUpdatesAvailable: false,
  telemetryAvailable: false,
}

export function capabilitiesQueryOptions(backend: Backend) {
  return queryOptions({
    queryKey: ['meta', backend] as const,
    queryFn: async (): Promise<Capabilities> => {
      const res = await fetch(apiUrl(backend, '/meta'))
      if (!res.ok) return NO_CAPABILITIES
      // A flag the server omits (telemetryAvailable when no collector is configured) reads as
      // false: callers hand these straight to react-query `enabled`, where undefined means on.
      return { ...NO_CAPABILITIES, ...(await res.json()) }
    },
    staleTime: Infinity,
  })
}

/** What the active backend can do — NAPALM/LLDP UI hides when live queries are absent. */
export function useCapabilities(): Capabilities {
  const backend = useAppStore((s) => s.backend)
  return useQuery(capabilitiesQueryOptions(backend)).data ?? NO_CAPABILITIES
}
