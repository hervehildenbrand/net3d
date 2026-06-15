import { Agent, fetch as undiciFetch } from 'undici'
import type { SiteCircuit } from '@net3d/shared'
import { normalizeRawCables, type RawCable, type SiteCable } from './cables'
import {
  parseNetBoxMajor,
  siteRacksQuery,
  siteCablesQuery,
  sitePowerQuery,
  circuitsQuery,
  type NetBoxMajor,
} from './graphql-dialect'
import { normalizeRawPower, type RawSitePower, type SitePower } from './power'
import type { SoTClient } from './sot/client'
import type { DeviceSpecs, Site, SiteDevice, SiteRack, SoTStatus } from './sot/types'
import { NapalmUnreachableError } from './sot/errors'

// Back-compat aliases: the domain types now live in ./sot/types (backend-agnostic)
// and NapalmUnreachableError in ./sot/errors. Existing imports of these names from
// './netbox' keep working unchanged.
export type { SoTClient as NetBoxClient } from './sot/client'
export type {
  Site as NetBoxSite,
  SiteDevice,
  SiteRack,
  DeviceSpecs,
  SoTStatus as NetBoxStatus,
} from './sot/types'
export { NapalmUnreachableError } from './sot/errors'

// NetBox 3.7: *_list takes no pagination args and returns all rows.
const SITES_QUERY = `{
  site_list {
    id
    name
    latitude
    longitude
    status
    region { name }
    physical_address
    facility
    tags { slug }
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
    status?: string | null
    serial?: string | null
    asset_tag?: string | null
    description?: string | null
    platform?: { name: string } | null
    primary_ip4?: { address: string } | null
    oob_ip?: { address: string } | null
    role: { name: string; color: string } | null
    device_type: {
      u_height: string | number
      model: string
      is_full_depth: boolean
      manufacturer: { name: string } | null
      custom_fields?: Record<string, unknown> | null
    }
  }[]
}

/** Hardware specs from the device-type custom-fields blob; undefined when empty. */
function parseSpecs(cf: Record<string, unknown> | null | undefined): DeviceSpecs | undefined {
  if (!cf) return undefined
  const specs: DeviceSpecs = {}
  if (typeof cf.cpu_model === 'string' && cf.cpu_model) specs.cpuModel = cf.cpu_model
  const num = (v: unknown): number | undefined => {
    const n = Number(v)
    return v == null || v === '' || Number.isNaN(n) ? undefined : n
  }
  const cores = num(cf.cpu_cores)
  if (cores !== undefined) specs.cpuCores = cores
  const ram = num(cf.ram_gb)
  if (ram !== undefined) specs.ramGb = ram
  const storage = num(cf.storage_tb)
  if (storage !== undefined) specs.storageTb = storage
  return Object.keys(specs).length ? specs : undefined
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
      status: (d.status ?? 'active').toLowerCase(),
      specs: parseSpecs(d.device_type.custom_fields),
      serial: d.serial ?? null,
      assetTag: d.asset_tag ?? null,
      description: d.description ?? null,
      platform: d.platform?.name ?? null,
      primaryIp: d.primary_ip4?.address ?? null,
      oobIp: d.oob_ip?.address ?? null,
    })),
  }))
}

interface RawCircuit {
  id: string
  cid: string
  status: string
  commit_rate: number | string | null
  description: string | null
  provider: { name: string } | null
  terminations: {
    term_side: string
    // 3.7 exposes the site directly; 4.x exposes it via the termination scope union
    site?: { name: string } | null
    termination?: { __typename?: string; name?: string } | null
  }[]
}

/** Site name of a circuit termination, across the 3.7 (`site`) and 4.x (`termination`) shapes. */
function terminationSiteName(t: RawCircuit['terminations'][number]): string | undefined {
  return t.site?.name ?? t.termination?.name
}

export interface RawSite {
  id: string
  name: string
  latitude: string | number | null
  longitude: string | number | null
  status: string
  region: { name: string } | null
  physical_address: string | null
  facility: string | null
  tags: { slug: string }[] | null
}

/** Rack/device totals from the REST site serializer (GraphQL has no counts). */
export interface SiteCounts {
  rackCount: number | null
  deviceCount: number | null
}

export function normalizeRawSites(raw: RawSite[], counts: Map<string, SiteCounts>): Site[] {
  return raw.map((s) => {
    const slugs = (s.tags ?? []).map((t) => t.slug)
    return {
      id: s.id,
      name: s.name,
      // NetBox returns decimals as strings
      latitude: s.latitude === null ? null : Number(s.latitude),
      longitude: s.longitude === null ? null : Number(s.longitude),
      region: s.region?.name ?? null,
      status: s.status,
      physicalAddress: s.physical_address || null,
      facility: s.facility || null,
      role: slugs.includes('pop') ? 'pop' : slugs.includes('compute') ? 'compute' : null,
      rackCount: counts.get(s.id)?.rackCount ?? null,
      deviceCount: counts.get(s.id)?.deviceCount ?? null,
    }
  })
}

/**
 * A `fetch` for NetBox calls. When TLS verification is disabled (for an
 * internal/self-signed CA), the relaxation is scoped to NetBox via an undici
 * dispatcher rather than the process-wide NODE_TLS_REJECT_UNAUTHORIZED kill
 * switch, so any other outbound HTTPS still verifies certificates normally.
 */
export function netboxFetch(tlsVerify: boolean): typeof fetch {
  if (tlsVerify) return fetch
  // The dispatcher and the fetch must come from the SAME undici, or undici
  // rejects the request (UND_ERR_INVALID_ARG) — Node's global fetch is backed by
  // its own bundled undici, which won't accept this package's Agent. So use
  // undici's fetch here too.
  const dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
  // `any` bridges undici's types and the global fetch types at this thin shim;
  // the public signature stays `typeof fetch` so callers keep global Response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((input, init) => (undiciFetch as any)(input, { ...init, dispatcher })) as typeof fetch
}

export function createNetBoxClient(
  baseUrl: string,
  token: string,
  opts: { tlsVerify?: boolean } = {},
): SoTClient {
  // verification on by default; only an explicit tlsVerify:false relaxes it
  const doFetch = netboxFetch(opts.tlsVerify !== false)
  // Detect the GraphQL dialect once (lazily, on first filtered query) and memoize.
  // Defaults to v3 if NetBox is unreachable, so the app still boots when it's down.
  let majorPromise: Promise<NetBoxMajor> | null = null
  function netboxMajor(): Promise<NetBoxMajor> {
    if (!majorPromise) {
      majorPromise = (async () => {
        try {
          const res = await doFetch(`${baseUrl}/api/status/`, {
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

  // The GraphQL site type has no rack/device totals; the REST serializer does
  // (both 3.7 and 4.x). Counts are cosmetic, so failures degrade to an empty map.
  async function fetchSiteCounts(): Promise<Map<string, SiteCounts>> {
    const counts = new Map<string, SiteCounts>()
    try {
      const res = await doFetch(`${baseUrl}/api/dcim/sites/?limit=1000`, {
        headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
      })
      if (!res.ok) return counts
      const body = (await res.json()) as {
        results?: { id: number; rack_count?: number; device_count?: number }[]
      }
      for (const s of body.results ?? []) {
        counts.set(String(s.id), {
          rackCount: s.rack_count ?? null,
          deviceCount: s.device_count ?? null,
        })
      }
    } catch {
      // NetBox REST hiccup: sites render without counts
    }
    return counts
  }

  // Total cable count for a site via REST (SQL COUNT — cheap, unlike the rows).
  // The REST filter matches the site slug, i.e. the lowercased site code.
  async function restCableCount(site: string): Promise<number | null> {
    try {
      const res = await doFetch(`${baseUrl}/api/dcim/cables/?site=${encodeURIComponent(site.toLowerCase())}&limit=1`, {
        headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
      })
      if (!res.ok) return null
      const body = (await res.json()) as { count?: number }
      return typeof body.count === 'number' ? body.count : null
    } catch {
      return null
    }
  }

  async function graphql<T>(query: string): Promise<T> {
    const res = await doFetch(`${baseUrl}/graphql/`, {
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
      const [data, counts] = await Promise.all([
        graphql<{ site_list: RawSite[] }>(SITES_QUERY),
        fetchSiteCounts(),
      ])
      return normalizeRawSites(data.site_list, counts)
    },

    async getCircuits() {
      const data = await graphql<{ circuit_list: RawCircuit[] }>(circuitsQuery(await netboxMajor()))
      const circuits: SiteCircuit[] = []
      for (const c of data.circuit_list) {
        const aTerm = c.terminations.find((t) => t.term_side === 'A')
        const zTerm = c.terminations.find((t) => t.term_side === 'Z')
        const a = aTerm && terminationSiteName(aTerm)
        const z = zTerm && terminationSiteName(zTerm)
        // only circuits with both ends documented can be drawn on the globe
        if (!a || !z) continue
        circuits.push({
          id: c.id,
          cid: c.cid,
          provider: c.provider?.name ?? null,
          siteA: a,
          siteZ: z,
          commitRate: c.commit_rate == null ? null : Number(c.commit_rate),
          // NetBox 4.x (Strawberry) returns enums lowercase
          status: (c.status ?? 'unknown').toLowerCase(),
          description: c.description || null,
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
      const major = await netboxMajor()
      if (major < 4) {
        const data = await graphql<{ cable_list: RawCable[] }>(siteCablesQuery(site, major))
        return normalizeRawCables(data.cable_list)
      }
      // 4.x caps list responses at 1000 rows, and each page is expensive to
      // serialize (~20s for a dense site) — learn the page count from a cheap
      // REST count and fetch all pages concurrently.
      const limit = 1000
      const fetchPage = (offset: number) =>
        graphql<{ cable_list: RawCable[] }>(siteCablesQuery(site, major, { offset, limit }))
      const count = await restCableCount(site)
      if (count === null) {
        // count unavailable: sequential paging until a short page
        const all: RawCable[] = []
        for (let offset = 0; ; offset += limit) {
          const data = await fetchPage(offset)
          all.push(...data.cable_list)
          if (data.cable_list.length < limit) break
        }
        return normalizeRawCables(all)
      }
      const pages = Math.max(1, Math.ceil(count / limit))
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) => fetchPage(i * limit)),
      )
      return normalizeRawCables(results.flatMap((r) => r.cable_list))
    },

    async getSitePower(site) {
      if (!/^[\w.-]+$/.test(site)) throw new Error(`invalid site name: ${site}`)
      const data = await graphql<RawSitePower>(sitePowerQuery(site, await netboxMajor()))
      return normalizeRawPower(data)
    },

    async napalm(deviceId, method) {
      const url = `${baseUrl}/api/plugins/netbox_napalm_plugin/napalmplatformconfig/${deviceId}/napalm/?method=${method}`
      const res = await doFetch(url, {
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
      const res = await doFetch(`${baseUrl}/api/status/`, {
        headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`NetBox status HTTP ${res.status}`)
      const body = (await res.json()) as { 'netbox-version'?: string; plugins?: Record<string, unknown> }
      return {
        backend: 'netbox',
        version: body['netbox-version'] ?? null,
        napalmAvailable: Object.keys(body.plugins ?? {}).some((p) => p.includes('napalm')),
      }
    },
  }
}
