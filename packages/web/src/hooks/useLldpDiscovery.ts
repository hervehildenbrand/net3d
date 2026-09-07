import { useQueries } from '@tanstack/react-query'
import type { LldpNeighbor } from '@net3d/shared'
import { apiUrl } from '../lib/api'
import type { Backend } from '../lib/api'
import { useAppStore } from '../store/useAppStore'
import type { SiteDevice } from './useSiteDetail'

/** Max NAPALM/LLDP calls in flight from this client — each is a ~25 s SSH behind NetBox. */
const MAX_CONCURRENT = 3

type Release = () => void

export class LldpSemaphore {
  private inFlight = 0
  private readonly waiters: Array<{ grant: () => boolean }> = []

  constructor(private readonly maxConcurrent: number) {}

  async acquire(signal: AbortSignal): Promise<Release> {
    signal.throwIfAborted()
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++
      return this.releaseOnce()
    }

    return new Promise<Release>((resolve, reject) => {
      let settled = false
      const onAbort = () => {
        if (settled) return
        settled = true
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(signal.reason)
      }
      const waiter = {
        grant: () => {
          if (settled) return false
          settled = true
          signal.removeEventListener('abort', onAbort)
          resolve(this.releaseOnce())
          return true
        },
      }
      this.waiters.push(waiter)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

  private releaseOnce(): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      while (this.waiters.length > 0) {
        if (this.waiters.shift()!.grant()) return
      }
      this.inFlight--
    }
  }
}

const lldpSemaphore = new LldpSemaphore(MAX_CONCURRENT)

export async function fetchLldp(
  backend: Backend,
  device: Pick<SiteDevice, 'id' | 'name'>,
  signal: AbortSignal,
): Promise<Record<string, LldpNeighbor[]>> {
  const release = await lldpSemaphore.acquire(signal)
  try {
    const res = await fetch(apiUrl(backend, `/devices/${device.id}/napalm/get_lldp_neighbors`), {
      signal,
    })
    if (!res.ok) throw new Error(`lldp ${device.name}: HTTP ${res.status}`)
    const body = await res.json()
    return body.get_lldp_neighbors as Record<string, LldpNeighbor[]>
  } finally {
    release()
  }
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
      queryFn: ({ signal }) => fetchLldp(backend, d, signal),
      enabled: activeIds.has(d.id),
      staleTime: 3_600_000,
      retry: false,
      gcTime: 3_600_000,
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
