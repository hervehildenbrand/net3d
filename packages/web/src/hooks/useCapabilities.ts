import { useQuery } from '@tanstack/react-query'
import { apiUrl } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

export interface Capabilities {
  /** Which source of truth is serving data. */
  backend: 'netbox' | 'infrahub'
  /** Backend version string, or null if unknown. */
  version: string | null
  napalmAvailable: boolean
}

const NO_CAPABILITIES: Capabilities = { backend: 'netbox', version: null, napalmAvailable: false }

/** What the active backend can do — NAPALM/LLDP UI hides when live queries are absent. */
export function useCapabilities(): Capabilities {
  const backend = useAppStore((s) => s.backend)
  const { data } = useQuery<Capabilities>({
    queryKey: ['meta', backend],
    queryFn: async () => {
      const res = await fetch(apiUrl(backend, '/meta'))
      if (!res.ok) return NO_CAPABILITIES
      return res.json()
    },
    staleTime: Infinity,
  })
  return data ?? NO_CAPABILITIES
}
