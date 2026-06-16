import { useQueries } from '@tanstack/react-query'
import type { LldpNeighbor } from '@net3d/shared'
import { apiUrl } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import type { SiteDevice } from './useSiteDetail'

/** Max NAPALM/LLDP calls in flight from this client — each is a ~25 s SSH behind NetBox. */
const MAX_CONCURRENT = 3

let inFlight = 0
const waiters: (() => void)[] = []

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  inFlight++
}

function release() {
  inFlight--
  waiters.shift()?.()
}

export interface LldpDiscovery {
  /** LLDP answers keyed by device NAME (matches cable terminations). */
  byDevice: Record<string, Record<string, LldpNeighbor[]>>
  completed: number
  total: number
  discovering: boolean
}

/**
 * Pass ALL site devices; only those in `activeIds` actually fetch (entering a
 * rack activates its devices). Cached answers from previously visited racks
 * keep flowing into `byDevice`, so the site overlay accumulates.
 */
export function useLldpDiscovery(devices: SiteDevice[], activeIds: Set<string>): LldpDiscovery {
  const backend = useAppStore((s) => s.backend)
  const results = useQueries({
    queries: devices.map((d) => ({
      queryKey: ['napalm', backend, d.id, 'get_lldp_neighbors'],
      queryFn: async () => {
        await acquire()
        try {
          const res = await fetch(apiUrl(backend, `/devices/${d.id}/napalm/get_lldp_neighbors`))
          if (!res.ok) throw new Error(`lldp ${d.name}: HTTP ${res.status}`)
          const body = await res.json()
          return body.get_lldp_neighbors as Record<string, LldpNeighbor[]>
        } finally {
          release()
        }
      },
      enabled: activeIds.has(d.id),
      staleTime: 600_000,
      retry: false,
      gcTime: 600_000,
    })),
  })

  const byDevice: Record<string, Record<string, LldpNeighbor[]>> = {}
  let completed = 0
  results.forEach((r, i) => {
    const d = devices[i]!
    if (activeIds.has(d.id) && (r.isSuccess || r.isError)) completed++
    if (r.data) byDevice[d.name] = r.data
  })

  return {
    byDevice,
    completed,
    total: activeIds.size,
    discovering: activeIds.size > 0 && completed < activeIds.size,
  }
}
