import { useQuery } from '@tanstack/react-query'

export interface Capabilities {
  netboxVersion: string | null
  napalmAvailable: boolean
}

/** What this NetBox can do — NAPALM/LLDP UI hides when the plugin is absent. */
export function useCapabilities(): Capabilities {
  const { data } = useQuery<Capabilities>({
    queryKey: ['meta'],
    queryFn: async () => {
      const res = await fetch('/api/meta')
      if (!res.ok) return { netboxVersion: null, napalmAvailable: false }
      return res.json()
    },
    staleTime: Infinity,
  })
  return data ?? { netboxVersion: null, napalmAvailable: false }
}
