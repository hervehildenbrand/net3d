// Infrahub source-of-truth adapter — implements the same SoTClient interface as
// the NetBox client, so net3d's core (routes, cache, prewarm, UI) is unchanged.
// Infrahub is GraphQL-native: POST to /graphql/<branch> with an X-INFRAHUB-KEY
// header; attributes come back wrapped as { value }, relationships as
// { edges { node } } / { node }. NAPALM has no Infrahub equivalent, so live
// device queries always report unreachable.

import { Agent, fetch as undiciFetch } from 'undici'
import type { SiteCircuit } from '@net3d/shared'
import type { SiteCable } from '../cables'
import type { SitePower } from '../power'
import type { SoTClient } from '../sot/client'
import { NapalmUnreachableError } from '../sot/errors'
import type { Site, SiteRack, SoTStatus } from '../sot/types'
import {
  CABLES_QUERY,
  CIRCUITS_QUERY,
  SITES_QUERY,
  feedsByPanelsQuery,
  siteRacksQuery,
  sitePanelsQuery,
} from './queries'
import {
  normalizeInfrahubCables,
  normalizeInfrahubCircuits,
  normalizeInfrahubPower,
  normalizeInfrahubRacks,
  normalizeInfrahubSites,
} from './transforms'
import type {
  NodeList,
  RawCable,
  RawCircuit,
  RawPowerFeed,
  RawPowerPanel,
  RawRack,
  RawSite,
} from './types'

export interface InfrahubClientOptions {
  /** Infrahub branch to read from; data lives on 'main' by default. */
  branch?: string
  /** TLS cert verification; disable only for an internal/self-signed CA. */
  tlsVerify?: boolean
}

const SITE_RE = /^[\w.-]+$/

// Same per-client TLS relaxation pattern as netboxFetch: scope it via an undici
// dispatcher rather than the process-wide kill switch.
function makeFetch(tlsVerify: boolean): typeof fetch {
  if (tlsVerify) return fetch
  const dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((input, init) => (undiciFetch as any)(input, { ...init, dispatcher })) as typeof fetch
}

const nodes = <T>(list: NodeList<T> | undefined): T[] => (list ? list.edges.map((e) => e.node) : [])

export function createInfrahubClient(
  baseUrl: string,
  token: string,
  opts: InfrahubClientOptions = {},
): SoTClient {
  const branch = opts.branch ?? 'main'
  const doFetch = makeFetch(opts.tlsVerify !== false)
  const headers = { 'X-INFRAHUB-KEY': token, 'Content-Type': 'application/json', Accept: 'application/json' }

  async function graphql<T>(query: string): Promise<T> {
    const res = await doFetch(`${baseUrl}/graphql/${branch}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    })
    if (!res.ok) throw new Error(`Infrahub GraphQL HTTP ${res.status}`)
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (body.errors?.length) throw new Error(`Infrahub GraphQL: ${body.errors[0]?.message}`)
    if (!body.data) throw new Error('Infrahub GraphQL: empty response')
    return body.data
  }

  return {
    async getSites(): Promise<Site[]> {
      const data = await graphql<{ DcimSite: NodeList<RawSite> }>(SITES_QUERY)
      return normalizeInfrahubSites(nodes(data.DcimSite))
    },

    async getCircuits(): Promise<SiteCircuit[]> {
      const data = await graphql<{ CircuitCircuit: NodeList<RawCircuit> }>(CIRCUITS_QUERY)
      return normalizeInfrahubCircuits(nodes(data.CircuitCircuit))
    },

    async getSiteRacks(site: string): Promise<SiteRack[]> {
      if (!SITE_RE.test(site)) throw new Error(`invalid site name: ${site}`)
      const data = await graphql<{ DcimRack: NodeList<RawRack> }>(siteRacksQuery(site))
      return normalizeInfrahubRacks(nodes(data.DcimRack))
    },

    async getSiteCables(site: string): Promise<SiteCable[]> {
      if (!SITE_RE.test(site)) throw new Error(`invalid site name: ${site}`)
      const data = await graphql<{ DcimCable: NodeList<RawCable> }>(CABLES_QUERY)
      return normalizeInfrahubCables(nodes(data.DcimCable), site)
    },

    async getSitePower(site: string): Promise<SitePower> {
      if (!SITE_RE.test(site)) throw new Error(`invalid site name: ${site}`)
      const panelData = await graphql<{ DcimPowerPanel: NodeList<RawPowerPanel> }>(sitePanelsQuery(site))
      const panels = nodes(panelData.DcimPowerPanel)
      const panelIds = panels.map((p) => p.id)
      const feeds = panelIds.length
        ? nodes((await graphql<{ DcimPowerFeed: NodeList<RawPowerFeed> }>(feedsByPanelsQuery(panelIds))).DcimPowerFeed)
        : []
      return normalizeInfrahubPower(panels, feeds)
    },

    // Infrahub has no NAPALM plugin: live device queries are never available.
    async napalm(_deviceId: number, _method: string): Promise<unknown> {
      throw new NapalmUnreachableError('NAPALM is not available with the Infrahub backend')
    },

    async getStatus(): Promise<SoTStatus> {
      let version: string | null = null
      try {
        const res = await doFetch(`${baseUrl}/api/config`, {
          headers: { 'X-INFRAHUB-KEY': token },
          signal: AbortSignal.timeout(5_000),
        })
        if (res.ok) {
          const body = (await res.json()) as { version?: string; main?: { version?: string } }
          version = body.version ?? body.main?.version ?? null
        }
      } catch {
        // version is cosmetic; a degraded/unreachable Infrahub still reports its backend
      }
      return { backend: 'infrahub', version, napalmAvailable: false }
    },
  }
}
