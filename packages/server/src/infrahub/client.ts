// Infrahub source-of-truth adapter — implements the same SoTClient interface as
// the NetBox client so net3d's core (routes, cache, prewarm, UI) is unchanged.
//
// NOTE: the data-fetching methods (getSites/getSiteRacks/getSiteCables/
// getSitePower/getCircuits) are filled in by Phase 4 against GraphQL fixtures
// captured from a real seeded instance — the schema-library models hierarchy via
// a Location generic and uses field names (rack_face, primary_address, ...) that
// must be confirmed against the running schema rather than guessed here. Until
// then they throw, so an accidentally-selected-but-unfinished backend fails loudly
// instead of returning empty data. getStatus() and napalm() are final.

import type { SiteCircuit } from '@net3d/shared'
import type { SiteCable } from '../cables'
import type { SitePower } from '../power'
import type { SoTClient } from '../sot/client'
import type { Site, SiteRack, SoTStatus } from '../sot/types'
import { NapalmUnreachableError } from '../sot/errors'

export interface InfrahubClientOptions {
  /** Infrahub branch to read from; data lives on 'main' by default. */
  branch?: string
  /** TLS cert verification; disable only for an internal/self-signed CA. */
  tlsVerify?: boolean
}

export function createInfrahubClient(
  baseUrl: string,
  token: string,
  opts: InfrahubClientOptions = {},
): SoTClient {
  // baseUrl/token/branch are wired in Phase 4 when the GraphQL methods land.
  void baseUrl
  void token
  void opts

  const pending = (method: string): never => {
    throw new Error(`Infrahub adapter: ${method} not implemented yet (Phase 4)`)
  }

  return {
    async getSites(): Promise<Site[]> {
      return pending('getSites')
    },
    async getCircuits(): Promise<SiteCircuit[]> {
      return pending('getCircuits')
    },
    async getSiteRacks(_site: string): Promise<SiteRack[]> {
      return pending('getSiteRacks')
    },
    async getSiteCables(_site: string): Promise<SiteCable[]> {
      return pending('getSiteCables')
    },
    async getSitePower(_site: string): Promise<SitePower> {
      return pending('getSitePower')
    },

    // Infrahub has no NAPALM plugin: live device queries are never available.
    async napalm(_deviceId: number, _method: string): Promise<unknown> {
      throw new NapalmUnreachableError('NAPALM is not available with the Infrahub backend')
    },

    async getStatus(): Promise<SoTStatus> {
      // Version reporting is added in Phase 4; the discriminator is what /api/meta
      // and the UI need to know which source of truth is active.
      return { backend: 'infrahub', version: null, napalmAvailable: false }
    },
  }
}
