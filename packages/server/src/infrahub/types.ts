// Raw Infrahub GraphQL response shapes for the net3d DCIM schema.
// Attributes are `{ value }`, cardinality-one relationships `{ node }`,
// cardinality-many `{ edges: [{ node }] }`, and counts `{ count }`.

export type Val<T> = { value: T | null } | null
export type One<T> = { node: T | null } | null
export type Many<T> = { edges: Array<{ node: T }> } | null
export type Count = { count: number } | null

export interface RawSite {
  id: string
  name: Val<string>
  // Text in the schema (Infrahub Number is integer-only); parsed to number.
  latitude: Val<string>
  longitude: Val<string>
  region: Val<string>
  status: Val<string>
  physical_address: Val<string>
  facility: Val<string>
  role: Val<string>
  racks: Count
  devices: Count
}

export interface RawManufacturer {
  name: Val<string>
}

export interface RawDeviceType {
  model: Val<string>
  u_height: Val<number>
  is_full_depth: Val<boolean>
  cpu_model: Val<string>
  cpu_cores: Val<number>
  ram_gb: Val<number>
  // Text in the schema (decimal TB); parsed to number.
  storage_tb: Val<string>
  manufacturer: One<RawManufacturer>
}

export interface RawDeviceRole {
  name: Val<string>
  color: Val<string>
}

export interface RawDevice {
  id: string
  name: Val<string>
  position: Val<number>
  face: Val<string>
  status: Val<string>
  serial: Val<string>
  asset_tag: Val<string>
  description: Val<string>
  primary_ip: Val<string>
  oob_ip: Val<string>
  role: One<RawDeviceRole>
  platform: One<{ name: Val<string> }>
  device_type: One<RawDeviceType>
}

export interface RawRack {
  id: string
  name: Val<string>
  u_height: Val<number>
  location: Val<string>
  devices: Many<RawDevice>
}

export interface RawCableEndpoint {
  __typename?: string
  name?: Val<string>
  interface_type?: Val<string>
  device?: One<{
    name: Val<string>
    site: One<{ name: Val<string> }>
    rack: One<{ name: Val<string> }>
  }>
  circuit?: One<{ cid: Val<string> }>
}

export interface RawCable {
  id: string
  cable_type: Val<string>
  status: Val<string>
  color: Val<string>
  endpoint_a: One<RawCableEndpoint>
  endpoint_b: One<RawCableEndpoint>
}

export interface RawPowerPanel {
  id: string
  name: Val<string>
  location: Val<string>
}

export interface RawPowerFeed {
  id: string
  name: Val<string>
  status: Val<string>
  voltage: Val<number>
  amperage: Val<number>
  phase: Val<string>
  supply: Val<string>
  feed_type: Val<string>
  max_utilization: Val<number>
  power_panel: One<{ name: Val<string> }>
  rack: One<{ name: Val<string> }>
}

export interface RawCircuit {
  id: string
  cid: Val<string>
  status: Val<string>
  commit_rate: Val<number>
  description: Val<string>
  provider: One<{ name: Val<string> }>
  endpoints: Many<{ term_side: Val<string>; site: One<{ name: Val<string> }> }>
}

export type NodeList<T> = { edges: Array<{ node: T }> }
