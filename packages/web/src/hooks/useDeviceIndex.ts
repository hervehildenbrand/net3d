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
    // The server index is built from the warm cache, so right after a backend
    // restart it can be partial until prewarm fills every site. A short stale
    // time lets it converge to the full index within a minute rather than
    // holding a partial list for the whole session.
    staleTime: 60_000,
  })
}
