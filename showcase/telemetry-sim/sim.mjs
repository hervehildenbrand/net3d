// Showcase-only stand-in for a live-telemetry collector: serves the two read-only endpoints net3d's
// collector client reads, for the switches and routers net3d itself serves, with rates from model.mjs.
// Stdlib only; showcase/ is outside the Docker build context, so this never reaches the net3d image.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { buildInventory, interfacesAt, MONITORED_ROLES, protocolsFor } from './model.mjs'

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
        if (detail) sites.push({ name: site.name, lon: site.longitude ?? 0, detail })
      }
    }
    await Promise.all([worker(), worker()])
  }
  return { sites, failed }
}

/**
 * Extract only the fields protocolsFor/buildInventory need from a site's detail.
 * Drops the full SiteDetail after extraction to save memory.
 */
const extractMinimal = ({ name, lon, detail }) => ({
  name,
  lon,
  detail: {
    racks: detail.racks.map((r) => ({
      name: r.name,
      devices: r.devices.map((d) => ({ name: d.name, roleName: d.roleName })),
    })),
    cables: detail.cables,
  },
})

/**
 * Discover until net3d yields a monitored device, then serve the collector contract. Rediscover every
 * refreshMs; after an incomplete round (any failed call) retry sooner, backing off from retryMs to 60 s,
 * so a site whose first load failed is not left without live data until the next full refresh.
 * @param opts.lsdbEnabled - if false, /isis/topology returns empty, adjacencies have null hostnames
 * @param opts.ospfEnabled - if false, /ospf/adjacencies returns 404
 * @param opts.monitoredRoles - Set of role names to consider monitored (default: from env or MONITORED_ROLES)
 */
export async function start({ net3dUrls, host = '127.0.0.1', port = 8090, refreshMs = 600_000, retryMs = 2_000, lsdbEnabled = true, ospfEnabled = true, monitoredRoles = null }) {
  let inv = new Map()
  // Pre-stringified protocol responses (avoid re-stringifying ~16 MB on every request)
  let protocolsJson = { links: '[]', isisAdjacencies: '[]', isisTopology: '{"sources":[],"nodes":[],"links":[]}', ospfAdjacencies: '[]' }
  // Minimal site data: only fields protocolsFor/buildInventory need (saves ~90% of memory)
  let lastGoodSites = []
  let backoff = retryMs
  /** One discovery round; resolves to the delay before the next one. */
  const refresh = async () => {
    let failed = 1
    try {
      const found = await discover(net3dUrls)
      // merge, never replace: a site that failed this round keeps serving its last good devices
      // ponytail: devices are never dropped; restart the sim after reseeding a smaller fabric
      inv = new Map([...inv, ...buildInventory(found.sites)])
      // Merge site details for protocolsFor (keyed by site name), extracting only minimal fields
      const siteMap = new Map(lastGoodSites.map((s) => [s.name, s]))
      for (const s of found.sites) siteMap.set(s.name, extractMinimal(s))
      lastGoodSites = [...siteMap.values()]
      const protocols = protocolsFor(lastGoodSites, { lsdb: lsdbEnabled, ospf: ospfEnabled }, monitoredRoles ?? MONITORED_ROLES)
      // Pre-stringify once per refresh to avoid ~16 MB stringify per request
      protocolsJson = {
        links: JSON.stringify(protocols.links),
        isisAdjacencies: JSON.stringify(protocols.isisAdjacencies),
        isisTopology: JSON.stringify(protocols.isisTopology),
        ospfAdjacencies: JSON.stringify(protocols.ospfAdjacencies),
      }
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
    res.setHeader('Content-Type', 'application/json')
    // Pre-stringified protocol responses (avoid re-stringifying ~16 MB on every request)
    if (path === '/api/v1/links' || path === '/links') {
      res.writeHead(200)
      res.end(protocolsJson.links)
      return
    }
    if (path === '/api/v1/isis/adjacencies' || path === '/isis/adjacencies') {
      res.writeHead(200)
      res.end(protocolsJson.isisAdjacencies)
      return
    }
    if (path === '/api/v1/isis/topology' || path === '/isis/topology') {
      res.writeHead(200)
      res.end(protocolsJson.isisTopology)
      return
    }
    if (path === '/api/v1/ospf/adjacencies' || path === '/ospf/adjacencies') {
      if (!ospfEnabled) {
        res.writeHead(404)
        res.end('{"error":{"code":"NOT_FOUND"}}')
      } else {
        res.writeHead(200)
        res.end(protocolsJson.ospfAdjacencies)
      }
      return
    }
    // Dynamic responses (small, ok to stringify per request)
    let body
    let status = 200
    if (path === '/api/v1/devices') {
      body = [...inv.keys()].map((name) => ({ name }))
    } else if (m) {
      body = interfacesAt(inv, decode(m[1]), Date.now())
    } else {
      body = null
    }
    res.writeHead(body !== null ? status : 404)
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
  const { NET3D_URLS = 'http://127.0.0.1:3001', HOST = '127.0.0.1', PORT = '8090', REFRESH_MS = '600000', SIM_LSDB, SIM_OSPF, SIM_MONITORED } = process.env
  const net3dUrls = NET3D_URLS.split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean)
  const lsdbEnabled = SIM_LSDB !== '0'
  const ospfEnabled = SIM_OSPF !== '0'
  const monitoredRoles = SIM_MONITORED ? new Set(SIM_MONITORED.split(',').map((r) => r.trim()).filter(Boolean)) : null
  await start({ net3dUrls, host: HOST, port: Number(PORT), refreshMs: Number(REFRESH_MS), lsdbEnabled, ospfEnabled, monitoredRoles })
  console.log(`telemetry-sim: serving http://${HOST}:${PORT}/api/v1 for ${net3dUrls.join(', ')}`)
}
