// Showcase-only stand-in for a live-telemetry collector: serves the two read-only endpoints net3d's
// collector client reads, for the switches and routers net3d itself serves, with rates from model.mjs.
// Stdlib only; showcase/ is outside the Docker build context, so this never reaches the net3d image.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { buildInventory, interfacesAt } from './model.mjs'

const warn = (err) => console.warn(`telemetry-sim: ${err.message}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ponytail: no NET3D_API_TOKEN support (showcase and demo leave it unset); send a bearer header here if one ever needs it
const getJson = async (url) => {
  // longer than net3d's own 120 s upstream timeout, so a cold site load is waited for, not counted as failed
  const res = await fetch(url, { signal: AbortSignal.timeout(130_000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

const decode = (segment) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return '' // malformed %-escape: no such device (an uncaught URIError would kill the process)
  }
}

/** Every site's detail from every net3d URL, two requests in flight per URL, plus how many calls failed. */
async function discover(net3dUrls) {
  const sites = []
  let failed = 0
  const get = (url) =>
    getJson(url).catch((err) => {
      warn(err)
      failed++
      return null
    })
  for (const base of net3dUrls) {
    const list = (await get(`${base}/api/sites`)) ?? []
    let next = 0
    const worker = async () => {
      while (next < list.length) {
        const site = list[next++]
        const detail = await get(`${base}/api/sites/${encodeURIComponent(site.name)}`)
        if (detail) sites.push({ lon: site.longitude ?? 0, detail })
      }
    }
    await Promise.all([worker(), worker()])
  }
  return { sites, failed }
}

/**
 * Discover until net3d yields a monitored device, then serve the collector contract. Rediscover every
 * refreshMs; after an incomplete round (any failed call) retry sooner, backing off from retryMs to 60 s,
 * so a site whose first load failed is not left without live data until the next full refresh.
 */
export async function start({ net3dUrls, host = '127.0.0.1', port = 8090, refreshMs = 600_000, retryMs = 2_000 }) {
  let inv = new Map()
  let backoff = retryMs
  /** One discovery round; resolves to the delay before the next one. */
  const refresh = async () => {
    let failed = 1
    try {
      const found = await discover(net3dUrls)
      // merge, never replace: a site that failed this round keeps serving its last good devices
      // ponytail: devices are never dropped; restart the sim after reseeding a smaller fabric
      inv = new Map([...inv, ...buildInventory(found.sites)])
      failed = found.failed
    } catch (err) {
      warn(err) // malformed payload: keep serving what we have
    }
    if (!failed && inv.size) {
      backoff = retryMs
      return refreshMs
    }
    const wait = backoff
    backoff = Math.min(backoff * 2, 60_000)
    console.warn(`telemetry-sim: incomplete discovery from ${net3dUrls.join(', ')} (${inv.size} devices so far), retrying in ${wait} ms`)
    return wait
  }
  // Listen only once there is something to serve: net3d turns an empty device list into "no monitored
  // device at this site", and the browser then stops polling that site.
  let wait = await refresh()
  while (!inv.size) {
    await sleep(wait)
    wait = await refresh()
  }

  const server = createServer((req, res) => {
    // ponytail: net3d only sends GET; any method gets the same answer
    const path = req.url.split('?')[0]
    const m = /^\/api\/v1\/devices\/([^/]+)\/interfaces$/.exec(path)
    const body =
      path === '/api/v1/devices' ? [...inv.keys()].map((name) => ({ name })) : m && interfacesAt(inv, decode(m[1]), Date.now())
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body ?? { error: { code: 'NOT_FOUND' } }))
  })
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve))

  let closed = false
  let timer
  const schedule = (ms) => {
    timer = setTimeout(async () => {
      const next = await refresh()
      if (!closed) schedule(next)
    }, ms)
  }
  schedule(wait)
  const close = () => {
    closed = true
    clearTimeout(timer)
    return new Promise((resolve) => server.close(resolve))
  }
  return { server, close }
}

// `node showcase/telemetry-sim/sim.mjs` (pnpm sim:telemetry), configured by env — see README.md
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.on('SIGTERM', () => process.exit(0)) // as a container's PID 1, node would otherwise ignore SIGTERM
  const { NET3D_URLS = 'http://127.0.0.1:3001', HOST = '127.0.0.1', PORT = '8090', REFRESH_MS = '600000' } = process.env
  const net3dUrls = NET3D_URLS.split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean)
  await start({ net3dUrls, host: HOST, port: Number(PORT), refreshMs: Number(REFRESH_MS) })
  console.log(`telemetry-sim: serving http://${HOST}:${PORT}/api/v1 for ${net3dUrls.join(', ')}`)
}
