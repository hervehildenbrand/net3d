import { useQuery } from '@tanstack/react-query'
import { apiUrl } from '../lib/api'
import type { Backend } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import { withLldpSlot } from './useLldpDiscovery'

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

export async function fetchNapalm<T>(
  backend: Backend,
  deviceId: string,
  method: NapalmMethod,
  signal: AbortSignal,
): Promise<T> {
  const request = async () => {
    const res = await fetch(apiUrl(backend, `/devices/${deviceId}/napalm/${method}`), { signal })
    if (res.status === 503) throw new UnreachableError('device unreachable')
    if (!res.ok) throw new Error(`napalm ${method}: HTTP ${res.status}`)
    const body = await res.json()
    return body[method] as T
  }
  return method === 'get_lldp_neighbors' ? withLldpSlot(signal, request) : request()
}

export function useNapalm<T = unknown>(deviceId: string | null, method: NapalmMethod) {
  const backend = useAppStore((s) => s.backend)
  return useQuery<T>({
    queryKey: ['napalm', backend, deviceId, method],
    queryFn: ({ signal }) => fetchNapalm<T>(backend, deviceId!, method, signal),
    enabled: !!deviceId,
    staleTime: STALE_MS[method],
    // keep interface state fresh while a device is being watched
    refetchInterval: method === 'get_interfaces' ? 10_000 : false,
    retry: false, // a 25s SSH round-trip is too expensive to auto-retry
  })
}
