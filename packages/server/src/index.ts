import { resolve } from 'node:path'
import { buildApp } from './app'
import { ConnectionCheckError, verifyConnection } from './connection-check'
import { createNetBoxClient, netboxFetch } from './netbox'

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
} = process.env

if (!NETBOX_URL || !NETBOX_TOKEN) {
  console.error('NETBOX_URL and NETBOX_TOKEN must be set (see .env.example)')
  process.exit(1)
}
const netboxUrl = NETBOX_URL
const netboxToken = NETBOX_TOKEN

// TLS verification is on unless explicitly disabled; the relaxation is scoped
// to NetBox calls (via an undici dispatcher), not the whole process.
const tlsVerify = NETBOX_TLS_VERIFY !== 'false'

async function main() {
  // Fail fast on a misconfigured NetBox: a wrong URL or rejected token should
  // stop here with an actionable message, not surface later as a blank UI.
  // Set SKIP_NETBOX_CHECK=1 to boot offline (e.g. CI, or a NetBox not up yet).
  if (SKIP_NETBOX_CHECK !== '1') {
    try {
      const info = await verifyConnection(netboxUrl, netboxToken, netboxFetch(tlsVerify))
      console.log(
        `✓ Connected to NetBox ${info.version ?? '(unknown version)'} at ${netboxUrl}, ` +
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

  const app = buildApp({
    netbox: createNetBoxClient(netboxUrl, netboxToken, { tlsVerify }),
    // when set (production/Docker), serve the built UI from this process too
    webDist: WEB_DIST ? resolve(WEB_DIST) : undefined,
    // optional shared-secret guard; unset = open (showcase / public demo)
    apiToken: process.env.NET3D_API_TOKEN || undefined,
    // structured logs in real runs; buildApp defaults to silent for tests
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
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
