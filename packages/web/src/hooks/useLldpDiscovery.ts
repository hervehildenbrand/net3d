import { useCallback } from 'react'
import {
  useQueries,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
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

export async function withLldpSlot<T>(
  signal: AbortSignal,
  request: () => Promise<T>,
): Promise<T> {
  const release = await lldpSemaphore.acquire(signal)
  try {
    return await request()
  } finally {
    release()
  }
}

export async function fetchLldp(
  backend: Backend,
  device: Pick<SiteDevice, 'id' | 'name'>,
  signal: AbortSignal,
): Promise<Record<string, LldpNeighbor[]>> {
  return withLldpSlot(signal, async () => {
    const res = await fetch(apiUrl(backend, `/devices/${device.id}/napalm/get_lldp_neighbors`), {
      signal,
    })
    if (!res.ok) throw new Error(`lldp ${device.name}: HTTP ${res.status}`)
    const body = await res.json()
    return body.get_lldp_neighbors as Record<string, LldpNeighbor[]>
  })
}

export interface LldpDiscovery {
  /** LLDP answers keyed by device NAME (matches cable terminations). */
  byDevice: Record<string, Record<string, LldpNeighbor[]>>
  completed: number
  total: number
  successful: number
  failed: number
  pending: number
  failedDeviceIds: string[]
  discovering: boolean
  retryFailed: () => Promise<void>
}

type LldpResult = Pick<
  UseQueryResult<Record<string, LldpNeighbor[]>>,
  'data' | 'isSuccess' | 'isError' | 'isFetching'
>

export function combineLldpResults(
  devices: Pick<SiteDevice, 'id' | 'name'>[],
  activeIds: Set<string>,
  results: LldpResult[],
): Omit<LldpDiscovery, 'retryFailed'> {
  const byDevice: LldpDiscovery['byDevice'] = {}
  const failedDeviceIds: string[] = []
  let successful = 0
  let pending = 0
  results.forEach((result, i) => {
    const device = devices[i]!
    if (result.data) byDevice[device.name] = result.data
    if (!activeIds.has(device.id)) return
    if (result.isFetching) pending++
    else if (result.isError) failedDeviceIds.push(device.id)
    else if (result.isSuccess) successful++
    else pending++
  })
  const failed = failedDeviceIds.length
  return {
    byDevice,
    completed: successful + failed,
    total: activeIds.size,
    successful,
    failed,
    pending,
    failedDeviceIds,
    discovering: pending > 0,
  }
}

export async function retryFailedLldp(
  queryClient: QueryClient,
  backend: Backend,
  failedDeviceIds: string[],
): Promise<void> {
  const failed = new Set(failedDeviceIds)
  await queryClient.refetchQueries({
    type: 'active',
    predicate: ({ queryKey }) =>
      queryKey[0] === 'napalm' &&
      queryKey[1] === backend &&
      typeof queryKey[2] === 'string' &&
      failed.has(queryKey[2]) &&
      queryKey[3] === 'get_lldp_neighbors',
  })
}

/**
 * Pass ALL site devices; only those in `activeIds` actually fetch (entering a
 * rack activates its devices). Cached answers from previously visited racks
 * keep flowing into `byDevice`, so the site overlay accumulates.
 */
export function useLldpDiscovery(devices: SiteDevice[], activeIds: Set<string>): LldpDiscovery {
  const backend = useAppStore((s) => s.backend)
  const queryClient = useQueryClient()
  const combine = useCallback(
    (results: UseQueryResult<Record<string, LldpNeighbor[]>>[]) =>
      combineLldpResults(devices, activeIds, results),
    [devices, activeIds],
  )
  const result = useQueries({
    queries: devices.map((d) => ({
      queryKey: ['napalm', backend, d.id, 'get_lldp_neighbors'],
      queryFn: ({ signal }) => fetchLldp(backend, d, signal),
      enabled: activeIds.has(d.id),
      staleTime: 3_600_000,
      retry: false,
      gcTime: 3_600_000,
    })),
    combine,
  })
  const retryFailed = useCallback(
    () => retryFailedLldp(queryClient, backend, result.failedDeviceIds),
    [queryClient, backend, result.failedDeviceIds],
  )
  return { ...result, retryFailed }
}
