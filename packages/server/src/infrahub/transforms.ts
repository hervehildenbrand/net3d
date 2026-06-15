// Map raw Infrahub GraphQL responses into net3d's backend-agnostic domain types,
// matching the NetBox client's normalization byte-for-byte where it matters:
//   device.face   -> UPPERCASE          device.status -> lowercase
//   cable.status  -> UPPERCASE          feed.status   -> lowercase
//   colors        -> 6-hex, no '#'

import type { SiteCircuit } from '@net3d/shared'
import type { CableEndpoint, SiteCable } from '../cables'
import type { SitePower } from '../power'
import type { DeviceSpecs, Site, SiteDevice, SiteRack } from '../sot/types'
import type {
  Many,
  One,
  RawCable,
  RawCableEndpoint,
  RawCircuit,
  RawDevice,
  RawPowerFeed,
  RawPowerPanel,
  RawRack,
  RawSite,
  Val,
} from './types'

const val = <T>(a: Val<T> | undefined): T | null => (a ? a.value : null)
const node = <T>(r: One<T> | undefined): T | null => (r ? r.node : null)
const list = <T>(m: Many<T> | undefined): T[] => (m ? m.edges.map((e) => e.node) : [])
const dehash = (c: string | null): string => (c ? c.replace(/^#/, '') : '')
/** Parse a decimal stored as Text (Infrahub Number is integer-only) to a number. */
const num = (a: Val<string> | undefined): number | null => {
  const s = val(a)
  if (s == null || s === '') return null
  const n = Number(s)
  return Number.isNaN(n) ? null : n
}

export function normalizeInfrahubSites(raw: RawSite[]): Site[] {
  return raw.map((s) => {
    const role = val(s.role)
    return {
      id: s.id,
      name: val(s.name) ?? '',
      latitude: num(s.latitude),
      longitude: num(s.longitude),
      region: val(s.region),
      status: val(s.status) ?? 'active',
      physicalAddress: val(s.physical_address) || null,
      facility: val(s.facility) || null,
      role: role === 'compute' ? 'compute' : role === 'pop' ? 'pop' : null,
      rackCount: s.racks?.count ?? null,
      deviceCount: s.devices?.count ?? null,
    }
  })
}

function normalizeDevice(d: RawDevice): SiteDevice {
  const dt = node(d.device_type)
  const role = node(d.role)
  const face = val(d.face)
  const specs: DeviceSpecs = {}
  const cpuModel = val(dt?.cpu_model)
  if (cpuModel) specs.cpuModel = cpuModel
  const cpuCores = val(dt?.cpu_cores)
  if (cpuCores != null) specs.cpuCores = cpuCores
  const ramGb = val(dt?.ram_gb)
  if (ramGb != null) specs.ramGb = ramGb
  const storageTb = num(dt?.storage_tb)
  if (storageTb != null) specs.storageTb = storageTb
  return {
    id: d.id,
    name: val(d.name) ?? '',
    position: val(d.position),
    // match NetBox: the app compares 'REAR'/'FRONT' uppercase
    face: face ? face.toUpperCase() : null,
    roleName: val(role?.name) ?? 'unknown',
    roleColor: dehash(val(role?.color)) || '888888',
    uHeight: val(dt?.u_height) ?? 1,
    model: val(dt?.model) ?? 'unknown',
    manufacturer: val(node(dt?.manufacturer)?.name) ?? 'unknown',
    isFullDepth: val(dt?.is_full_depth) ?? true,
    status: (val(d.status) ?? 'active').toLowerCase(),
    specs: Object.keys(specs).length ? specs : undefined,
    serial: val(d.serial) ?? null,
    assetTag: val(d.asset_tag) ?? null,
    description: val(d.description) ?? null,
    platform: val(node(d.platform)?.name) ?? null,
    primaryIp: val(d.primary_ip) ?? null,
    oobIp: val(d.oob_ip) ?? null,
  }
}

export function normalizeInfrahubRacks(raw: RawRack[]): SiteRack[] {
  return raw.map((r) => ({
    id: r.id,
    name: val(r.name) ?? '',
    uHeight: val(r.u_height) ?? 42,
    location: val(r.location) ?? null,
    devices: list(r.devices).map(normalizeDevice),
  }))
}

/** Site name an endpoint's device sits in (null for circuit ends), for site filtering. */
function endpointSiteName(e: RawCableEndpoint | null): string | null {
  const dev = node(e?.device)
  return val(node(dev?.site)?.name)
}

function endpoint(e: RawCableEndpoint | null): CableEndpoint | null {
  if (!e) return null
  const dev = node(e.device)
  if (e.__typename === 'DcimInterface' || dev) {
    return {
      kind: 'device',
      name: val(e.name) ?? '',
      deviceName: val(dev?.name) ?? null,
      rackName: val(node(dev?.rack)?.name) ?? null,
    }
  }
  const circuit = node(e.circuit)
  if (e.__typename === 'CircuitEndpoint' || circuit) {
    return { kind: 'circuit', name: val(circuit?.cid) ?? val(e.name) ?? '', deviceName: null, rackName: null }
  }
  return null
}

/** Cables touching `site` (either end's device is in it), normalized like NetBox. */
export function normalizeInfrahubCables(raw: RawCable[], site: string): SiteCable[] {
  return raw
    .filter((c) => endpointSiteName(node(c.endpoint_a)) === site || endpointSiteName(node(c.endpoint_b)) === site)
    .map((c) => ({
      id: c.id,
      type: val(c.cable_type),
      // match NetBox: the app compares 'CONNECTED' uppercase
      status: (val(c.status) ?? '').toUpperCase(),
      color: dehash(val(c.color)),
      a: endpoint(node(c.endpoint_a)),
      b: endpoint(node(c.endpoint_b)),
    }))
}

export function normalizeInfrahubPower(panels: RawPowerPanel[], feeds: RawPowerFeed[]): SitePower {
  return {
    panels: panels.map((p) => ({ id: p.id, name: val(p.name) ?? '', location: val(p.location) ?? null })),
    feeds: feeds.map((f) => ({
      id: f.id,
      name: val(f.name) ?? '',
      status: (val(f.status) ?? '').toLowerCase(),
      voltage: val(f.voltage),
      amperage: val(f.amperage),
      phase: val(f.phase),
      supply: val(f.supply),
      type: val(f.feed_type),
      maxUtilization: val(f.max_utilization),
      panelName: val(node(f.power_panel)?.name),
      rackName: val(node(f.rack)?.name),
    })),
  }
}

export function normalizeInfrahubCircuits(raw: RawCircuit[]): SiteCircuit[] {
  const out: SiteCircuit[] = []
  for (const c of raw) {
    const ends = list(c.endpoints)
    const a = ends.find((e) => val(e.term_side) === 'A')
    const z = ends.find((e) => val(e.term_side) === 'Z')
    const siteA = val(node(a?.site)?.name)
    const siteZ = val(node(z?.site)?.name)
    // only circuits with both ends documented can be drawn on the globe
    if (!siteA || !siteZ) continue
    out.push({
      id: c.id,
      cid: val(c.cid) ?? '',
      provider: val(node(c.provider)?.name),
      siteA,
      siteZ,
      commitRate: val(c.commit_rate),
      status: (val(c.status) ?? 'unknown').toLowerCase(),
      description: val(c.description) || null,
    })
  }
  return out
}
