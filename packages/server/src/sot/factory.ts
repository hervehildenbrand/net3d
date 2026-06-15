// Chooses and constructs the active source-of-truth client from configuration.
// This is the only place that knows both backends exist; everything downstream
// depends solely on the SoTClient interface.

import { createNetBoxClient } from '../netbox'
import { createInfrahubClient } from '../infrahub/client'
import type { SoTClient } from './client'

export type SoTBackend = 'netbox' | 'infrahub'

export interface SoTConfig {
  backend: SoTBackend
  netbox: { url?: string; token?: string; tlsVerify: boolean }
  infrahub: { url?: string; token?: string; branch: string; tlsVerify: boolean }
}

/** Parse the SoT configuration from an environment bag (defaults to process.env). */
export function getSoTConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SoTConfig {
  const raw = env.SOT_BACKEND ?? 'netbox'
  if (raw !== 'netbox' && raw !== 'infrahub') {
    throw new Error(`SOT_BACKEND must be "netbox" or "infrahub" (got "${raw}")`)
  }
  return {
    backend: raw,
    netbox: {
      url: env.NETBOX_URL,
      token: env.NETBOX_TOKEN,
      // verification on unless explicitly disabled (scoped per-client via undici)
      tlsVerify: env.NETBOX_TLS_VERIFY !== 'false',
    },
    infrahub: {
      url: env.INFRAHUB_URL,
      token: env.INFRAHUB_TOKEN,
      branch: env.INFRAHUB_BRANCH ?? 'main',
      tlsVerify: env.INFRAHUB_TLS_VERIFY !== 'false',
    },
  }
}

/** Construct the SoT client for the configured backend, or throw with a clear hint. */
export function createSoTClient(config: SoTConfig): SoTClient {
  if (config.backend === 'infrahub') {
    const { url, token, branch, tlsVerify } = config.infrahub
    if (!url || !token) {
      throw new Error('INFRAHUB_URL and INFRAHUB_TOKEN must be set when SOT_BACKEND=infrahub')
    }
    return createInfrahubClient(url, token, { branch, tlsVerify })
  }
  const { url, token, tlsVerify } = config.netbox
  if (!url || !token) {
    throw new Error('NETBOX_URL and NETBOX_TOKEN must be set (see .env.example)')
  }
  return createNetBoxClient(url, token, { tlsVerify })
}
