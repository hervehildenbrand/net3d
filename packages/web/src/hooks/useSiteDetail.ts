import { useQuery } from '@tanstack/react-query'
import { apiUrl } from '../lib/api'
import { useAppStore } from '../store/useAppStore'

export interface DeviceSpecs {
  cpuModel?: string
  cpuCores?: number
  ramGb?: number
  storageTb?: number
  /** Typical/allocated power draw in watts (from the device type); drives rack load. */
  powerDrawW?: number
}

export interface SiteDevice {
  id: string
  name: string
  position: number | null
  face: string | null
  roleName: string
  roleColor: string
  uHeight: number
  model: string
  manufacturer: string
  isFullDepth: boolean
  status: string
  /** Hardware specs from device-type custom fields; absent on plain instances. */
  specs?: DeviceSpecs
  /** NetBox inventory fields; null when not set. */
  serial?: string | null
  assetTag?: string | null
  description?: string | null
  platform?: string | null
  primaryIp?: string | null
  oobIp?: string | null
}

export interface SiteRack {
  id: string
  name: string
  uHeight: number
  location: string | null
  devices: SiteDevice[]
}

export interface CableEndpoint {
  kind: 'device' | 'powerfeed' | 'circuit'
  name: string
  deviceName: string | null
  rackName: string | null
  /** Interface form factor at this end (e.g. "100gbase-x-qsfp28"); null for non-interface ends. */
  ifaceType: string | null
}

export interface SiteCable {
  id: string
  type: string | null
  status: string
  color: string
  a: CableEndpoint | null
  b: CableEndpoint | null
}

export interface SitePowerPanel {
  id: string
  name: string
  location: string | null
}

export interface SitePowerFeed {
  id: string
  name: string
  status: string
  voltage: number | null
  amperage: number | null
  phase: string | null
  supply: string | null
  type: string | null
  maxUtilization: number | null
  panelName: string | null
  rackName: string | null
}

export interface SitePower {
  panels: SitePowerPanel[]
  feeds: SitePowerFeed[]
}

export interface SiteDetailData {
  racks: SiteRack[]
  cables: SiteCable[]
  /** Power panels + feeds; absent from older server responses, so optional. */
  power?: SitePower
}

export function useSiteDetail(siteName: string | null) {
  const backend = useAppStore((s) => s.backend)
  return useQuery<SiteDetailData>({
    queryKey: ['site', backend, siteName],
    queryFn: async () => {
      const res = await fetch(apiUrl(backend, `/sites/${encodeURIComponent(siteName!)}`))
      if (!res.ok) throw new Error(`site ${siteName}: HTTP ${res.status}`)
      return res.json()
    },
    enabled: !!siteName,
    // the server pre-warms and serves stale-while-revalidate: trust it longer
    staleTime: 300_000,
  })
}
