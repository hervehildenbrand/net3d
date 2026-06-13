import { useQuery } from '@tanstack/react-query'

export interface DeviceSpecs {
  cpuModel?: string
  cpuCores?: number
  ramGb?: number
  storageTb?: number
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
}

export interface SiteCable {
  id: string
  type: string | null
  status: string
  color: string
  a: CableEndpoint | null
  b: CableEndpoint | null
}

export function useSiteDetail(siteName: string | null) {
  return useQuery<{ racks: SiteRack[]; cables: SiteCable[] }>({
    queryKey: ['site', siteName],
    queryFn: async () => {
      const res = await fetch(`/api/sites/${encodeURIComponent(siteName!)}`)
      if (!res.ok) throw new Error(`site ${siteName}: HTTP ${res.status}`)
      return res.json()
    },
    enabled: !!siteName,
    // the server pre-warms and serves stale-while-revalidate: trust it longer
    staleTime: 300_000,
  })
}
