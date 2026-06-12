import { useQuery } from '@tanstack/react-query'

export interface Site {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  region: string | null
  status: string
}

export function useSites() {
  return useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: async () => {
      const res = await fetch('/api/sites')
      if (!res.ok) throw new Error(`sites: HTTP ${res.status}`)
      return res.json()
    },
    staleTime: 300_000,
  })
}
