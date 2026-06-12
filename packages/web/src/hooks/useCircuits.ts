import { useQuery } from '@tanstack/react-query'
import type { CircuitGroup } from '@net3d/shared'

export function useCircuits() {
  return useQuery<CircuitGroup[]>({
    queryKey: ['circuits'],
    queryFn: async () => {
      const res = await fetch('/api/circuits')
      if (!res.ok) throw new Error(`circuits: HTTP ${res.status}`)
      return res.json()
    },
    staleTime: 300_000,
  })
}
