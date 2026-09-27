import type { LiveIface } from '@net3d/shared'

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

  const get = async <T>(path: string): Promise<T> => {
    // shorter than the 2 s browser poll so hung calls never stack
    const res = await fetch(`${base}/api/v1${path}`, { headers, signal: AbortSignal.timeout(1_500) })
    if (!res.ok) throw new Error(`netstatex ${path}: HTTP ${res.status}`)
    return (await res.json()) as T
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
  }
}

export type NetstatexClient = ReturnType<typeof createNetstatexClient>
