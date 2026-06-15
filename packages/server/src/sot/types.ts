// Backend-agnostic domain types — the contract every source-of-truth (SoT)
// adapter (NetBox, Infrahub, ...) must produce. These shapes are what the
// Fastify routes, cache/prewarm, and the web UI consume; they intentionally
// carry no backend-specific naming so a second backend plugs in unchanged.

export interface Site {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  region: string | null
  status: string
  physicalAddress: string | null
  facility: string | null
  /** Derived from the site's compute/pop tag; null when untagged. */
  role: 'compute' | 'pop' | null
  rackCount: number | null
  deviceCount: number | null
}

export interface DeviceSpecs {
  cpuModel?: string
  cpuCores?: number
  ramGb?: number
  storageTb?: number
}

export interface SiteDevice {
  id: string
  name: string
  /** U position; null for unpositioned (e.g. child/0U) devices. */
  position: number | null
  face: string | null
  roleName: string
  roleColor: string
  uHeight: number
  model: string
  manufacturer: string
  isFullDepth: boolean
  status: string
  /** Hardware specs from device-type fields; undefined when not documented. */
  specs?: DeviceSpecs
  /** Inventory fields; null when not set. */
  serial: string | null
  assetTag: string | null
  description: string | null
  platform: string | null
  /** primary_ip4 address, with mask (e.g. "10.0.0.5/24"). */
  primaryIp: string | null
  /** out-of-band mgmt address, with mask. */
  oobIp: string | null
}

export interface SiteRack {
  id: string
  name: string
  uHeight: number
  location: string | null
  devices: SiteDevice[]
}

/** Which source of truth is serving data, and its live capabilities. */
export interface SoTStatus {
  backend: 'netbox' | 'infrahub'
  /** Backend version string, or null if unknown. */
  version: string | null
  /** True only when live device queries (NAPALM) are available. */
  napalmAvailable: boolean
}
