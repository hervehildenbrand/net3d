import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import fastifyStatic from '@fastify/static'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { timingSafeEqual } from 'node:crypto'
import { groupCircuitsBySitePair, SITE_LAYOUT_VERSION, validateLayoutInput, type SiteLayout } from '@net3d/shared'
import { TtlCache } from './cache'
import { NapalmUnreachableError } from './netbox'
import type { SoTClient } from './sot/client'
import type { DiskCacheStore } from './persistence'
import type { LayoutStore } from './layout-store'
import { loadSiteDetail, prewarmCaches, type SiteDetail } from './prewarm'
import { buildDeviceIndex } from './devices'

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
  /** The active source-of-truth client (NetBox or Infrahub). */
  netbox: SoTClient
  /** Which backend `netbox` is; reported by /api/meta even when it's unreachable. */
  backend?: 'netbox' | 'infrahub'
  /** Max NAPALM calls in flight or waiting before requests are shed with 429. */
  napalmMaxQueue?: number
  /** Pre-warm all caches at startup and refresh on an interval (0 = once only). */
  prewarm?: { intervalMs?: number; concurrency?: number }
  /** Absolute path to the built web UI; when set, serve it with an SPA fallback. */
  webDist?: string
  /** When set, /api/* (except /api/health) requires `Authorization: Bearer <token>`. */
  apiToken?: string
  /**
   * Origins allowed to embed net3d in an iframe (in addition to 'self'). Unset
   * keeps the default same-origin-only posture. When set, CSP frame-ancestors
   * lists these origins and the legacy X-Frame-Options header is dropped (it
   * can't express an arbitrary allowed origin; modern browsers honor the CSP).
   */
  frameAncestors?: string[]
  /** Fastify logger config; default false keeps tests quiet. */
  logger?: FastifyServerOptions['logger']
  /** When set, the cache is persisted to disk and hydrated on boot (survives restarts). */
  persist?: DiskCacheStore
  /** Durable store for user-edited floor plans; when unset, layout routes are not registered. */
  layoutStore?: LayoutStore
  /** Gate for layout writes. Off (default) keeps the read-only posture: PUT/DELETE → 403. */
  layoutEditable?: boolean
  /** Sandbox: editor UI available but changes never persist (Save disabled; writes still 403). */
  layoutPreview?: boolean
}

// SWR-served payloads worth persisting. napalm:* is live device state with a short
// TTL (and uses the evicting get()); meta is tiny and non-SWR — both are excluded.
const PERSISTABLE_KEYS = (key: string): boolean =>
  key === 'sites' || key === 'circuits' || key.startsWith('site:')

export function buildApp({
  netbox,
  backend = 'netbox',
  napalmMaxQueue = 8,
  prewarm,
  webDist,
  apiToken,
  frameAncestors,
  logger = false,
  persist,
  layoutStore,
  layoutEditable = false,
  layoutPreview = false,
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger })
  const cache = new TtlCache(persist ? { persist, shouldPersist: PERSISTABLE_KEYS } : undefined)
  // Seed memory from disk before serving so the first post-restart request hits
  // the persisted copy (then revalidates in the background like any stale entry).
  cache.hydrate()

  // Defense-in-depth headers. The CSP is permissive enough for the WebGL/map UI
  // (raster tiles, GL textures, inline styles from R3F/drei); tune in the browser
  // if violations appear. crossOriginEmbedderPolicy is off so cross-origin map
  // tiles/textures load without requiring CORP headers on every tile server.
  // When embedding is configured, allow those origins to frame us via CSP and
  // drop X-Frame-Options (it only knows DENY/SAMEORIGIN — no arbitrary origin).
  const frameAncestorsDirective =
    frameAncestors && frameAncestors.length ? ["'self'", ...frameAncestors] : undefined

  app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    ...(frameAncestorsDirective ? { xFrameOptions: false } : {}),
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        ...(frameAncestorsDirective ? { frameAncestors: frameAncestorsDirective } : {}),
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
        const status = await cache.getOrSet('meta', CACHE_TTL.sites, () => netbox.getStatus())
        // layout flags are server-config, not SoT status — merge per response.
        return { ...status, layoutEditable, layoutPreview }
      } catch (err) {
        app.log.warn(err)
        // showcase degrades gracefully: no capabilities ≠ broken app
        return { backend, version: null, napalmAvailable: false, layoutEditable, layoutPreview }
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

    // A flat, backend-agnostic device index for the search box. Built ONLY from
    // per-site detail already in the cache (which the prewarm loop fills in the
    // background) — it never loads a site on demand. That keeps the request a
    // microsecond flatten and, crucially, non-blocking: one cold or slow site
    // (a known failure mode for a dense SoT) must not hang the whole index. The
    // index is complete in steady state and grows as prewarm warms sites after a
    // restart. Identical code serves NetBox and Infrahub (chosen by SOT_BACKEND).
    app.get('/api/devices', async (_req, reply) => {
      try {
        const sites = await cache.getOrSet('sites', CACHE_TTL.sites, () => netbox.getSites(), SWR)
        const details = new Map<string, SiteDetail>()
        for (const s of sites) {
          // peek (not get): include a site as long as it's ever been warmed —
          // its detail TTL (2 min) lapses faster than a full prewarm of a dense
          // SoT, and get()'s eviction would oscillate sites in/out of the index.
          const detail = cache.peek<SiteDetail>(`site:${s.name}`)
          if (detail) details.set(s.name, detail)
        }
        return buildDeviceIndex(details)
      } catch (err) {
        app.log.error(err)
        return reply.code(502).send({ error: 'netbox_unavailable' })
      }
    })

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

    // User-edited floor plans. Backend-agnostic (keyed by site name) and gated:
    // writes require layoutEditable so the default deploy stays a read-only viewer.
    if (layoutStore) {
      app.get<{ Params: { site: string } }>('/api/layouts/:site', async (req, reply) => {
        const layout = layoutStore.get(req.params.site)
        if (!layout) return reply.code(404).send({ error: 'no_layout' })
        return layout
      })

      app.put<{ Params: { site: string }; Body: unknown }>('/api/layouts/:site', async (req, reply) => {
        if (!layoutEditable) return reply.code(403).send({ error: 'layout_readonly' })
        const invalid = validateLayoutInput(req.body)
        if (invalid) return reply.code(400).send({ error: 'invalid_payload', detail: invalid })
        const body = req.body as Pick<SiteLayout, 'racks' | 'rooms' | 'floor'>
        // Server stamps version + updatedAt authoritatively.
        const layout: SiteLayout = {
          version: SITE_LAYOUT_VERSION,
          updatedAt: new Date().toISOString(),
          racks: body.racks,
          rooms: body.rooms,
          floor: body.floor ?? null,
        }
        try {
          return await layoutStore.put(req.params.site, layout)
        } catch (err) {
          app.log.error(err)
          return reply.code(500).send({ error: 'save_failed' })
        }
      })

      app.delete<{ Params: { site: string } }>('/api/layouts/:site', async (req, reply) => {
        if (!layoutEditable) return reply.code(403).send({ error: 'layout_readonly' })
        const existed = await layoutStore.delete(req.params.site)
        if (!existed) return reply.code(404).send({ error: 'no_layout' })
        return { deleted: true }
      })
    }
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
