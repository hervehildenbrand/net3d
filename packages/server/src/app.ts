import Fastify, { type FastifyInstance } from 'fastify'
import { groupCircuitsBySitePair } from '@net3d/shared'
import { TtlCache } from './cache'
import { NapalmUnreachableError, type NetBoxClient } from './netbox'

export const CACHE_TTL = {
  sites: 300_000,
  circuits: 300_000,
  siteDetail: 120_000,
} as const

export const NAPALM_METHODS = {
  get_facts: 30_000,
  get_environment: 15_000,
  get_interfaces: 10_000,
  get_lldp_neighbors: 15_000,
} as const

export interface AppDeps {
  netbox: NetBoxClient
  /** Max NAPALM calls in flight or waiting before requests are shed with 429. */
  napalmMaxQueue?: number
}

export function buildApp({ netbox, napalmMaxQueue = 8 }: AppDeps): FastifyInstance {
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

  app.get<{ Params: { name: string } }>('/api/sites/:name', async (req, reply) => {
    try {
      const { name } = req.params
      return await cache.getOrSet(`site:${name}`, CACHE_TTL.siteDetail, async () => {
        const [racks, cables] = await Promise.all([
          netbox.getSiteRacks(name),
          netbox.getSiteCables(name),
        ])
        return { racks, cables }
      })
    } catch (err) {
      app.log.error(err)
      return reply.code(502).send({ error: 'netbox_unavailable' })
    }
  })

  let napalmInFlight = 0
  app.get<{ Params: { id: string; method: string } }>(
    '/api/devices/:id/napalm/:method',
    async (req, reply) => {
      const { id, method } = req.params
      const ttl = NAPALM_METHODS[method as keyof typeof NAPALM_METHODS]
      if (ttl === undefined) {
        return reply.code(400).send({ error: 'method_not_allowed', allowed: Object.keys(NAPALM_METHODS) })
      }
      const cacheKey = `napalm:${id}:${method}`
      const hit = cache.get(cacheKey)
      if (hit !== undefined) return hit
      if (napalmInFlight >= napalmMaxQueue) {
        return reply.code(429).send({ error: 'napalm_busy' })
      }
      napalmInFlight++
      try {
        const data = await netbox.napalm(Number(id), method)
        cache.set(cacheKey, data, ttl)
        return data
      } catch (err) {
        if (err instanceof NapalmUnreachableError) {
          return reply.code(503).send({ error: 'unreachable', detail: err.message })
        }
        app.log.error(err)
        return reply.code(502).send({ error: 'netbox_unavailable' })
      } finally {
        napalmInFlight--
      }
    },
  )

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
