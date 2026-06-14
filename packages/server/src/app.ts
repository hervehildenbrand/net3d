import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import fastifyStatic from '@fastify/static'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { timingSafeEqual } from 'node:crypto'
import { groupCircuitsBySitePair } from '@net3d/shared'
import { TtlCache } from './cache'
import { NapalmUnreachableError, type NetBoxClient } from './netbox'
import { loadSiteDetail, prewarmCaches } from './prewarm'

// Stale entries are served instantly and refreshed in the background, so a
// TTL here is "how old may data get before a refresh starts", not a hard cutoff.
const SWR = { staleWhileRevalidate: true }

export const CACHE_TTL = {
  sites: 300_000,
  circuits: 300_000,
  siteDetail: 120_000,
} as const

export const NAPALM_METHODS = {
  get_facts: 30_000,
  get_environment: 15_000,
  get_interfaces: 10_000,
  // LLDP backs the cabling overlay — discovery is expensive (one SSH per
  // device through NetBox), topology changes slowly: cache for 10 minutes.
  get_lldp_neighbors: 600_000,
} as const

export interface AppDeps {
  netbox: NetBoxClient
  /** Max NAPALM calls in flight or waiting before requests are shed with 429. */
  napalmMaxQueue?: number
  /** Pre-warm all caches at startup and refresh on an interval (0 = once only). */
  prewarm?: { intervalMs?: number; concurrency?: number }
  /** Absolute path to the built web UI; when set, serve it with an SPA fallback. */
  webDist?: string
  /** When set, /api/* (except /api/health) requires `Authorization: Bearer <token>`. */
  apiToken?: string
  /** Fastify logger config; default false keeps tests quiet. */
  logger?: FastifyServerOptions['logger']
}

export function buildApp({
  netbox,
  napalmMaxQueue = 8,
  prewarm,
  webDist,
  apiToken,
  logger = false,
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger })
  const cache = new TtlCache()

  // Defense-in-depth headers. The CSP is permissive enough for the WebGL/map UI
  // (raster tiles, GL textures, inline styles from R3F/drei); tune in the browser
  // if violations appear. crossOriginEmbedderPolicy is off so cross-origin map
  // tiles/textures load without requiring CORP headers on every tile server.
  app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'blob:' is required by @react-three/drei <Text> → troika-worker-utils,
        // which spawns a worker from a blob and importScripts(blob:) inside it.
        // importScripts is governed by script-src (not worker-src), so without this
        // the 3D room's text worker is CSP-blocked and racks fail to render.
        scriptSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https:'],
        workerSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
      },
    },
  })
  app.register(rateLimit, { max: 300, timeWindow: '1 minute' })

  // Optional shared-secret guard for the read-only API. Unset = open (showcase /
  // public demo). When set, programmatic clients (or an auth-terminating reverse
  // proxy that injects the header) must present the bearer token.
  if (apiToken) {
    const expected = Buffer.from(`Bearer ${apiToken}`)
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/') || req.url === '/api/health') return
      const got = Buffer.from(req.headers.authorization ?? '')
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
        return reply.code(401).send({ error: 'unauthorized' })
      }
    })
  }

  if (prewarm) {
    const ttl = { sites: CACHE_TTL.sites, circuits: CACHE_TTL.circuits, siteDetail: CACHE_TTL.siteDetail }
    // a full warm can take minutes on a dense instance — never let cycles overlap
    let warming = false
    const warm = async () => {
      if (warming) return
      warming = true
      try {
        await prewarmCaches(cache, netbox, ttl, prewarm.concurrency)
      } catch (err) {
        app.log.warn(err)
      } finally {
        warming = false
      }
    }
    void warm()
    if (prewarm.intervalMs && prewarm.intervalMs > 0) {
      const timer = setInterval(() => void warm(), prewarm.intervalMs)
      timer.unref()
      app.addHook('onClose', async () => clearInterval(timer))
    }
  }

  // /api routes live in a child plugin registered AFTER rate-limit so that
  // @fastify/rate-limit's onRoute hook (it attaches the limiter as each route is
  // registered) actually sees them — routes added to the root before the deferred
  // plugin finishes loading would silently skip rate limiting. (helmet's global
  // onRequest hook applies regardless, which is why headers worked but limits didn't.)
  app.register(async function apiRoutes(app) {
    app.get('/api/health', async () => ({ status: 'ok' }))

    app.get('/api/meta', async () => {
      try {
        return await cache.getOrSet('meta', CACHE_TTL.sites, () => netbox.getStatus())
      } catch (err) {
        app.log.warn(err)
        // showcase degrades gracefully: no capabilities ≠ broken app
        return { netboxVersion: null, napalmAvailable: false }
      }
    })

    app.get('/api/sites', async (_req, reply) => {
      try {
        return await cache.getOrSet('sites', CACHE_TTL.sites, () => netbox.getSites(), SWR)
      } catch (err) {
        app.log.error(err)
        return reply.code(502).send({ error: 'netbox_unavailable' })
      }
    })

    app.get<{ Params: { name: string } }>('/api/sites/:name', async (req, reply) => {
      try {
        const { name } = req.params
        return await cache.getOrSet(
          `site:${name}`,
          CACHE_TTL.siteDetail,
          () => loadSiteDetail(netbox, name),
          SWR,
        )
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
            // err.message carries the device IP ("cannot connect to <ip>") — keep
            // it server-side only; clients get a generic, non-leaking detail.
            app.log.warn(err)
            return reply.code(503).send({ error: 'unreachable', detail: 'device unreachable' })
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
        return await cache.getOrSet(
          'circuits',
          CACHE_TTL.circuits,
          async () => groupCircuitsBySitePair(await netbox.getCircuits()),
          SWR,
        )
      } catch (err) {
        app.log.error(err)
        return reply.code(502).send({ error: 'netbox_unavailable' })
      }
    })
  })

  if (webDist) {
    // Serve the built UI from the same process so production is one container.
    // wildcard:false registers a route per built file; the SPA fallback lets
    // client routes deep-link, while /api/* keeps priority and 404s as JSON.
    app.register(fastifyStatic, { root: webDist, wildcard: false })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: 'not_found' })
    })
  }

  return app
}
