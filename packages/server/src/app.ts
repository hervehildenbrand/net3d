import Fastify, { type FastifyInstance } from 'fastify'
import { groupCircuitsBySitePair } from '@net3d/shared'
import { TtlCache } from './cache'
import type { NetBoxClient } from './netbox'

export const CACHE_TTL = {
  sites: 300_000,
  circuits: 300_000,
} as const

export interface AppDeps {
  netbox: NetBoxClient
}

export function buildApp({ netbox }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  const cache = new TtlCache()

  app.get('/api/health', async () => ({ status: 'ok' }))

  app.get('/api/sites', async (_req, reply) => {
    try {
      return await cache.getOrSet('sites', CACHE_TTL.sites, () => netbox.getSites())
    } catch (err) {
      app.log.error(err)
      return reply.code(502).send({ error: 'netbox_unavailable' })
    }
  })

  app.get('/api/circuits', async (_req, reply) => {
    try {
      return await cache.getOrSet('circuits', CACHE_TTL.circuits, async () =>
        groupCircuitsBySitePair(await netbox.getCircuits()),
      )
    } catch (err) {
      app.log.error(err)
      return reply.code(502).send({ error: 'netbox_unavailable' })
    }
  })

  return app
}
