import type { LiveIface, CollectorTopology } from '@net3d/shared'
import { resolveTopology, type RawTopologyData } from './topology'

// Only the projected fields are read: raw counters, description and DeviceDTO.address
// (the device management IP) never leave this module.
interface InterfaceDTO {
  interface: string
  telemetry_state: string
  capacity_bps: number | null
  rx_bps: number | null
  tx_bps: number | null
}

/** A thin REST client over a netstatex gNMI collector: device list + per-device interface rates. */
export function createNetstatexClient(baseUrl: string, token?: string) {
  const base = baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }

  // Last-good body cache for topology endpoints
  const lastGood = new Map<string, unknown>()

  const get = async <T>(path: string, timeoutMs = 1_500): Promise<T> => {
    // shorter than the 2 s browser poll so hung calls never stack
    const res = await fetch(`${base}/api/v1${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) {
      const err = new Error(`netstatex ${path}: HTTP ${res.status}`)
      ;(err as Error & { status: number }).status = res.status
      throw err
    }
    return (await res.json()) as T
  }

  // Topology endpoint fetcher with last-good fallback
  const fetchTopologyEndpoint = async <T>(
    path: string,
    emptyValue: T,
    timeoutMs: number,
  ): Promise<{ value: T; answered: boolean }> => {
    try {
      const value = await get<T>(path, timeoutMs)
      lastGood.set(path, value)
      return { value, answered: true }
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 404) {
        // 404 -> layer dark, do NOT reuse last good
        return { value: emptyValue, answered: true }
      }
      // Other failure -> reuse last good if available
      const cached = lastGood.get(path) as T | undefined
      if (cached !== undefined) {
        return { value: cached, answered: true }
      }
      // No prior value -> mark as not answered
      return { value: emptyValue, answered: false }
    }
  }

  return {
    deviceNames: async () => (await get<{ name: string }[]>('/devices')).map((d) => d.name),
    interfaces: async (device: string): Promise<Record<string, LiveIface>> =>
      Object.fromEntries(
        (await get<InterfaceDTO[]>(`/devices/${encodeURIComponent(device)}/interfaces`)).map((i) => [
          i.interface,
          { rxBps: i.rx_bps, txBps: i.tx_bps, capacityBps: i.capacity_bps, stale: i.telemetry_state === 'STALE' },
        ]),
      ),

    /** Fetch topology data from all 4 endpoints and join into facts. */
    topology: async (): Promise<Pick<CollectorTopology, 'facts' | 'nodeSids'>> => {
      const timeoutMs = 5_000

      const results = await Promise.allSettled([
        fetchTopologyEndpoint<unknown[]>('/links', [], timeoutMs),
        fetchTopologyEndpoint<unknown[]>('/isis/adjacencies', [], timeoutMs),
        fetchTopologyEndpoint<{ sources: unknown[]; nodes: unknown[]; links: unknown[] }>(
          '/isis/topology',
          { sources: [], nodes: [], links: [] },
          timeoutMs,
        ),
        fetchTopologyEndpoint<unknown[]>('/ospf/adjacencies', [], timeoutMs),
      ])

      // Check if any endpoint answered
      const answered = results.some(r => r.status === 'fulfilled' && r.value.answered)
      if (!answered) {
        throw new Error('netstatex: no endpoint answered')
      }

      // Extract values (settled promises won't reject due to our try/catch)
      const links = (results[0] as PromiseFulfilledResult<{ value: unknown[]; answered: boolean }>).value.value
      const isisAdj = (results[1] as PromiseFulfilledResult<{ value: unknown[]; answered: boolean }>).value.value
      const isisTopo = (results[2] as PromiseFulfilledResult<{ value: { sources: unknown[]; nodes: unknown[]; links: unknown[] }; answered: boolean }>).value.value
      const ospfAdj = (results[3] as PromiseFulfilledResult<{ value: unknown[]; answered: boolean }>).value.value

      const raw: RawTopologyData = {
        links: links as RawTopologyData['links'],
        isisAdjacencies: isisAdj as RawTopologyData['isisAdjacencies'],
        isisTopology: isisTopo as RawTopologyData['isisTopology'],
        ospfAdjacencies: ospfAdj as RawTopologyData['ospfAdjacencies'],
      }

      return resolveTopology(raw)
    },
  }
}

export type NetstatexClient = ReturnType<typeof createNetstatexClient>

/** The collector configured by NETSTATEX_URL / NETSTATEX_TOKEN; an unset or blank URL means the feature is off. */
export function netstatexFromEnv(env: NodeJS.ProcessEnv = process.env): NetstatexClient | undefined {
  const url = env.NETSTATEX_URL?.trim()
  return url ? createNetstatexClient(url, env.NETSTATEX_TOKEN?.trim() || undefined) : undefined
}
