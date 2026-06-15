import { useQuery } from '@tanstack/react-query'

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
  const { data } = useQuery<Capabilities>({
    queryKey: ['meta'],
    queryFn: async () => {
      const res = await fetch('/api/meta')
      if (!res.ok) return NO_CAPABILITIES
      return res.json()
    },
    staleTime: Infinity,
  })
  return data ?? NO_CAPABILITIES
}
