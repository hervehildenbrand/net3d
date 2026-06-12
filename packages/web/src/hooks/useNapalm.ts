import { useQuery } from '@tanstack/react-query'

export type NapalmMethod =
  | 'get_facts'
  | 'get_environment'
  | 'get_interfaces'
  | 'get_lldp_neighbors'

const STALE_MS: Record<NapalmMethod, number> = {
  get_facts: 30_000,
  get_environment: 15_000,
  get_interfaces: 10_000,
  get_lldp_neighbors: 15_000,
}

export class UnreachableError extends Error {}

export function useNapalm<T = unknown>(deviceId: string | null, method: NapalmMethod) {
  return useQuery<T>({
    queryKey: ['napalm', deviceId, method],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${deviceId}/napalm/${method}`)
      if (res.status === 503) throw new UnreachableError('device unreachable')
      if (!res.ok) throw new Error(`napalm ${method}: HTTP ${res.status}`)
      const body = await res.json()
      return body[method] as T
    },
    enabled: !!deviceId,
    staleTime: STALE_MS[method],
    retry: false, // a 25s SSH round-trip is too expensive to auto-retry
  })
}
