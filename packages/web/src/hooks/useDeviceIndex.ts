import { useQuery } from '@tanstack/react-query'
import { apiUrl } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import type { DeviceIndexEntry } from '../lib/deviceSearch'

export type { DeviceIndexEntry }

/**
 * The flat, backend-agnostic device index (GET /api/devices) for the active
 * backend — powers the device search box. Keyed by backend so switching
 * NetBox⇄Infrahub refetches the right index. Mirrors useSites().
 */
export function useDeviceIndex() {
  const backend = useAppStore((s) => s.backend)
  return useQuery<DeviceIndexEntry[]>({
    queryKey: ['devices', backend],
    queryFn: async () => {
      const res = await fetch(apiUrl(backend, '/devices'))
      if (!res.ok) throw new Error(`devices: HTTP ${res.status}`)
      return res.json()
    },
    staleTime: 300_000,
  })
}
