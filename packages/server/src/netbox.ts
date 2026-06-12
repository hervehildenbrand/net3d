import type { SiteCircuit } from '@net3d/shared'
import { normalizeRawCables, type RawCable, type SiteCable } from './cables'
import { parseNetBoxMajor, siteRacksQuery, siteCablesQuery, type NetBoxMajor } from './graphql-dialect'

export interface NetBoxSite {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  region: string | null
  status: string
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
}

export interface SiteRack {
  id: string
  name: string
  uHeight: number
  location: string | null
  devices: SiteDevice[]
}

export interface NetBoxClient {
  getSites(): Promise<NetBoxSite[]>
  getCircuits(): Promise<SiteCircuit[]>
  getSiteRacks(site: string): Promise<SiteRack[]>
  getSiteCables(site: string): Promise<SiteCable[]>
  napalm(deviceId: number, method: string): Promise<unknown>
  getStatus(): Promise<NetBoxStatus>
}

export interface NetBoxStatus {
  netboxVersion: string | null
  napalmAvailable: boolean
}

/** The NAPALM plugin reached NetBox but NetBox could not reach the device. */
export class NapalmUnreachableError extends Error {}

// NetBox 3.7: *_list takes no pagination args and returns all rows.
const SITES_QUERY = `{
  site_list {
    id
    name
    latitude
    longitude
    status
    region { name }
  }
}`

export interface RawRack {
  id: string
  name: string
  u_height: number
  location: { name: string } | null
  devices: {
    id: string
    name: string
    position: string | number | null
    face: string | null
    role: { name: string; color: string } | null
    device_type: {
      u_height: string | number
      model: string
      is_full_depth: boolean
      manufacturer: { name: string } | null
    }
  }[]
}

/** Map NetBox rack rows into the SiteRack shape, normalizing types and enum casing. */
export function normalizeRawRacks(raw: RawRack[]): SiteRack[] {
  return raw.map((r) => ({
    id: r.id,
    name: r.name,
    uHeight: r.u_height,
    location: r.location?.name ?? null,
    devices: r.devices.map((d) => ({
      id: d.id,
      name: d.name,
      position: d.position === null ? null : Number(d.position),
      // NetBox 4.x (Strawberry) returns enums lowercase; the app compares 'REAR'
      face: d.face ? d.face.toUpperCase() : d.face,
      roleName: d.role?.name ?? 'unknown',
      roleColor: d.role?.color ?? '888888',
      uHeight: Number(d.device_type.u_height) || 1,
      model: d.device_type.model,
      manufacturer: d.device_type.manufacturer?.name ?? 'unknown',
      isFullDepth: d.device_type.is_full_depth,
    })),
  }))
}

const CIRCUITS_QUERY = `{
  circuit_list {
    id
    cid
    provider { name }
    terminations { term_side site { name } }
  }
}`

interface RawCircuit {
  id: string
  cid: string
  provider: { name: string } | null
  terminations: { term_side: string; site: { name: string } | null }[]
}

interface RawSite {
  id: string
  name: string
  latitude: string | number | null
  longitude: string | number | null
  status: string
  region: { name: string } | null
}

export function createNetBoxClient(baseUrl: string, token: string): NetBoxClient {
  // Detect the GraphQL dialect once (lazily, on first filtered query) and memoize.
  // Defaults to v3 if NetBox is unreachable, so the app still boots when it's down.
  let majorPromise: Promise<NetBoxMajor> | null = null
  function netboxMajor(): Promise<NetBoxMajor> {
    if (!majorPromise) {
      majorPromise = (async () => {
        try {
          const res = await fetch(`${baseUrl}/api/status/`, {
            headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
          })
          if (!res.ok) return 3
          const body = (await res.json()) as { 'netbox-version'?: string }
          return parseNetBoxMajor(body['netbox-version'])
        } catch {
          return 3
        }
      })()
    }
    return majorPromise
  }

  async function graphql<T>(query: string): Promise<T> {
    const res = await fetch(`${baseUrl}/graphql/`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) throw new Error(`NetBox GraphQL HTTP ${res.status}`)
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (body.errors?.length) throw new Error(`NetBox GraphQL: ${body.errors[0]?.message}`)
    if (!body.data) throw new Error('NetBox GraphQL: empty response')
    return body.data
  }

  return {
    async getSites() {
      const data = await graphql<{ site_list: RawSite[] }>(SITES_QUERY)
      return data.site_list.map((s) => ({
        id: s.id,
        name: s.name,
        // NetBox returns decimals as strings
        latitude: s.latitude === null ? null : Number(s.latitude),
        longitude: s.longitude === null ? null : Number(s.longitude),
        region: s.region?.name ?? null,
        status: s.status,
      }))
    },

    async getCircuits() {
      const data = await graphql<{ circuit_list: RawCircuit[] }>(CIRCUITS_QUERY)
      const circuits: SiteCircuit[] = []
      for (const c of data.circuit_list) {
        const a = c.terminations.find((t) => t.term_side === 'A')?.site?.name
        const z = c.terminations.find((t) => t.term_side === 'Z')?.site?.name
        // only circuits with both ends documented can be drawn on the globe
        if (!a || !z) continue
        circuits.push({
          id: c.id,
          cid: c.cid,
          provider: c.provider?.name ?? null,
          siteA: a,
          siteZ: z,
        })
      }
      return circuits
    },

    async getSiteRacks(site) {
      if (!/^[\w.-]+$/.test(site)) throw new Error(`invalid site name: ${site}`)
      const data = await graphql<{ rack_list: RawRack[] }>(siteRacksQuery(site, await netboxMajor()))
      return normalizeRawRacks(data.rack_list)
    },

    async getSiteCables(site) {
      if (!/^[\w.-]+$/.test(site)) throw new Error(`invalid site name: ${site}`)
      const data = await graphql<{ cable_list: RawCable[] }>(siteCablesQuery(site, await netboxMajor()))
      return normalizeRawCables(data.cable_list)
    },

    async napalm(deviceId, method) {
      const url = `${baseUrl}/api/plugins/netbox_napalm_plugin/napalmplatformconfig/${deviceId}/napalm/?method=${method}`
      const res = await fetch(url, {
        headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(45_000), // live SSH sessions take seconds
      })
      if (res.status === 503) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string }
        throw new NapalmUnreachableError(body.detail ?? 'device unreachable')
      }
      if (!res.ok) throw new Error(`NAPALM HTTP ${res.status}`)
      return res.json()
    },

    async getStatus() {
      const res = await fetch(`${baseUrl}/api/status/`, {
        headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`NetBox status HTTP ${res.status}`)
      const body = (await res.json()) as { 'netbox-version'?: string; plugins?: Record<string, unknown> }
      return {
        netboxVersion: body['netbox-version'] ?? null,
        napalmAvailable: Object.keys(body.plugins ?? {}).some((p) => p.includes('napalm')),
      }
    },
  }
}
