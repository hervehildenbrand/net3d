import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app'
import { ConnectionCheckError, verifyConnection } from './connection-check'
import { netboxFetch } from './netbox'
import { createSoTClient, getSoTConfigFromEnv } from './sot/factory'
import { createDiskCacheStore } from './persistence'
import { createLayoutStore } from './layout-store'

const {
  PORT,
  PREWARM,
  PREWARM_INTERVAL_MS,
  PREWARM_CONCURRENCY,
  SKIP_NETBOX_CHECK,
  SKIP_SOT_CHECK,
  WEB_DIST,
  HOST,
  CACHE_PERSIST,
  CACHE_DIR,
  LAYOUT_DIR,
  LAYOUT_EDIT,
} = process.env

// Which source of truth, and its connection details (NETBOX_* / INFRAHUB_*).
const config = getSoTConfigFromEnv()

// Set SKIP_SOT_CHECK=1 to boot without a preflight (e.g. CI, or the backend not
// up yet). SKIP_NETBOX_CHECK is kept as a back-compat alias.
const skipCheck = SKIP_SOT_CHECK === '1' || SKIP_NETBOX_CHECK === '1'

async function main() {
  // Throws a clear, actionable message if the selected backend is misconfigured.
  const sot = createSoTClient(config)

  // Fail fast on an unreachable/misconfigured backend rather than surfacing it
  // later as a blank UI.
  if (!skipCheck) {
    if (config.backend === 'netbox') {
      try {
        const info = await verifyConnection(
          config.netbox.url!,
          config.netbox.token!,
          netboxFetch(config.netbox.tlsVerify),
        )
        console.log(
          `✓ Connected to NetBox ${info.version ?? '(unknown version)'} at ${config.netbox.url}, ` +
            `NAPALM ${info.napalmAvailable ? 'available' : 'not installed'}`,
        )
      } catch (err) {
        if (err instanceof ConnectionCheckError) {
          console.error(`✗ Cannot reach NetBox at ${config.netbox.url}: ${err.message}\n  → ${err.hint}`)
        } else {
          console.error(`✗ Cannot reach NetBox at ${config.netbox.url}:`, err)
        }
        process.exit(1)
      }
    } else {
      // Infrahub preflight: resolve the backend status. A full GraphQL ping lands
      // with the adapter in Phase 4.
      try {
        await sot.getStatus()
        console.log(`✓ Using Infrahub at ${config.infrahub.url} (branch ${config.infrahub.branch})`)
      } catch (err) {
        console.error(`✗ Cannot reach Infrahub at ${config.infrahub.url}:`, err)
        process.exit(1)
      }
    }
  }

  // Persist the NetBox cache across restarts (default on). A restart otherwise wipes
  // the in-memory cache, so the next big-site click hangs 30-75s re-warming. Keyed by
  // NetBox instance so showcase (:8088) and live never read each other's data.
  // key the on-disk cache by the active backend instance so showcase (:8088),
  // live NetBox, and Infrahub (:8000) never read each other's data
  const cacheKeyUrl = config.backend === 'netbox' ? config.netbox.url! : config.infrahub.url!
  const persist =
    CACHE_PERSIST === '0' || CACHE_PERSIST === 'false'
      ? undefined
      : createDiskCacheStore({
          // default lives next to the server package, stable across cwd + tsx-watch restarts
          baseDir: CACHE_DIR ? resolve(CACHE_DIR) : fileURLToPath(new URL('../.cache/net3d/', import.meta.url)),
          netboxUrl: cacheKeyUrl,
        })

  // User-edited floor plans live OUTSIDE the cache dir (dev-restart wipes .cache),
  // so they survive restarts and reseeds. Backend-agnostic: keyed by site name, so
  // both the NetBox and Infrahub instances share one store when pointed at the same
  // LAYOUT_DIR (in the dual-backend deploy the UI routes all layout calls to /api).
  const layoutStore = createLayoutStore(
    LAYOUT_DIR ? resolve(LAYOUT_DIR) : fileURLToPath(new URL('../.data/net3d-layouts/', import.meta.url)),
  )
  // Off by default → PUT/DELETE 403, keeping the public demo a read-only viewer.
  const layoutEditable = LAYOUT_EDIT === '1' || LAYOUT_EDIT === 'true'

  const app = buildApp({
    netbox: sot,
    backend: config.backend,
    layoutStore,
    layoutEditable,
    // when set (production/Docker), serve the built UI from this process too
    webDist: WEB_DIST ? resolve(WEB_DIST) : undefined,
    // optional shared-secret guard; unset = open (showcase / public demo)
    apiToken: process.env.NET3D_API_TOKEN || undefined,
    // structured logs in real runs; buildApp defaults to silent for tests
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // persist the cache to disk so a restart doesn't wipe the warm cache
    persist,
    // opt-in: live instances can be slow (~25s/site); the showcase enables it
    prewarm:
      PREWARM === '1' || PREWARM === 'true'
        ? {
            intervalMs: Number(PREWARM_INTERVAL_MS ?? 60_000),
            concurrency: Number(PREWARM_CONCURRENCY ?? 2),
          }
        : undefined,
  })

  const port = Number(PORT ?? 3001)
  // default to loopback for local dev; containers set HOST=0.0.0.0 to be reachable
  const host = HOST ?? '127.0.0.1'
  await app.listen({ port, host })
  console.log(`net3d server on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
