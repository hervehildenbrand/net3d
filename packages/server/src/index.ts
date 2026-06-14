import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app'
import { ConnectionCheckError, verifyConnection } from './connection-check'
import { createNetBoxClient } from './netbox'
import { createDiskCacheStore } from './persistence'

const {
  NETBOX_URL,
  NETBOX_TOKEN,
  NETBOX_TLS_VERIFY,
  PORT,
  PREWARM,
  PREWARM_INTERVAL_MS,
  PREWARM_CONCURRENCY,
  SKIP_NETBOX_CHECK,
  WEB_DIST,
  HOST,
  CACHE_PERSIST,
  CACHE_DIR,
} = process.env

if (!NETBOX_URL || !NETBOX_TOKEN) {
  console.error('NETBOX_URL and NETBOX_TOKEN must be set (see .env.example)')
  process.exit(1)
}
const netboxUrl = NETBOX_URL
const netboxToken = NETBOX_TOKEN

if (NETBOX_TLS_VERIFY === 'false') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

async function main() {
  // Fail fast on a misconfigured NetBox: a wrong URL or rejected token should
  // stop here with an actionable message, not surface later as a blank UI.
  // Set SKIP_NETBOX_CHECK=1 to boot offline (e.g. CI, or a NetBox not up yet).
  if (SKIP_NETBOX_CHECK !== '1') {
    try {
      const info = await verifyConnection(netboxUrl, netboxToken)
      console.log(
        `✓ Connected to NetBox ${info.version ?? '(unknown version)'} at ${netboxUrl} — ` +
          `NAPALM ${info.napalmAvailable ? 'available' : 'not installed'}`,
      )
    } catch (err) {
      if (err instanceof ConnectionCheckError) {
        console.error(`✗ Cannot reach NetBox at ${netboxUrl}: ${err.message}\n  → ${err.hint}`)
      } else {
        console.error(`✗ Cannot reach NetBox at ${netboxUrl}:`, err)
      }
      process.exit(1)
    }
  }

  // Persist the NetBox cache across restarts (default on). A restart otherwise wipes
  // the in-memory cache, so the next big-site click hangs 30-75s re-warming. Keyed by
  // NetBox instance so showcase (:8088) and live never read each other's data.
  const persist =
    CACHE_PERSIST === '0' || CACHE_PERSIST === 'false'
      ? undefined
      : createDiskCacheStore({
          // default lives next to the server package, stable across cwd + tsx-watch restarts
          baseDir: CACHE_DIR ? resolve(CACHE_DIR) : fileURLToPath(new URL('../.cache/net3d/', import.meta.url)),
          netboxUrl,
        })

  const app = buildApp({
    netbox: createNetBoxClient(netboxUrl, netboxToken),
    // when set (production/Docker), serve the built UI from this process too
    webDist: WEB_DIST ? resolve(WEB_DIST) : undefined,
    persist,
    // opt-in: live NetBox instances can be slow (~25s/site); the showcase enables it
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
