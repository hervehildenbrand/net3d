import { useQuery } from '@tanstack/react-query'
import type { CircuitGroup } from '@net3d/shared'
import { apiUrl } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

export function useCircuits() {
  const backend = useAppStore((s) => s.backend)
  return useQuery<CircuitGroup[]>({
    queryKey: ['circuits', backend],
    queryFn: async () => {
      const res = await fetch(apiUrl(backend, '/circuits'))
      if (!res.ok) throw new Error(`circuits: HTTP ${res.status}`)
      return res.json()
    },
    staleTime: 300_000,
  })
}
