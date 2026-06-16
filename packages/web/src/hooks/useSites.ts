import { useQuery } from '@tanstack/react-query'
import { apiUrl } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

export interface Site {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  region: string | null
  status: string
  physicalAddress: string | null
  facility: string | null
  role: 'compute' | 'pop' | null
  rackCount: number | null
  deviceCount: number | null
}

export function useSites() {
  const backend = useAppStore((s) => s.backend)
  return useQuery<Site[]>({
    queryKey: ['sites', backend],
    queryFn: async () => {
      const res = await fetch(apiUrl(backend, '/sites'))
      if (!res.ok) throw new Error(`sites: HTTP ${res.status}`)
      return res.json()
    },
    staleTime: 300_000,
  })
}
