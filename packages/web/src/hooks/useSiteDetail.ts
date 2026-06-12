import { useQuery } from '@tanstack/react-query'

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
    staleTime: 120_000,
  })
}
