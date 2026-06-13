import { groupCircuitsBySitePair } from '@net3d/shared'
import type { TtlCache } from './cache'
import type { NetBoxClient, SiteRack } from './netbox'
import type { SiteCable } from './cables'

export interface PrewarmTtl {
  sites: number
  circuits: number
  siteDetail: number
}

export interface SiteDetail {
  racks: SiteRack[]
  cables: SiteCable[]
}

/** The /api/sites/:name payload — shared by the route and the pre-warm loop. */
export async function loadSiteDetail(netbox: NetBoxClient, name: string): Promise<SiteDetail> {
  const [racks, cables] = await Promise.all([
    netbox.getSiteRacks(name),
    netbox.getSiteCables(name),
  ])
  return { racks, cables }
}

/**
 * Refresh the sites/circuits/site-detail caches in place so requests are
 * always served hot. Values are swapped atomically (no eviction window);
 * per-site failures are skipped. Intended to run at startup and on an
 * interval; routes serve stale-while-revalidate as the backstop.
 */
export async function prewarmCaches(
  cache: TtlCache,
  netbox: NetBoxClient,
  ttl: PrewarmTtl,
  concurrency = 2,
): Promise<void> {
  const sites = await netbox.getSites()
  cache.set('sites', sites, ttl.sites)

  try {
    cache.set('circuits', groupCircuitsBySitePair(await netbox.getCircuits()), ttl.circuits)
  } catch {
    // circuits are optional eye-candy; keep warming site details
  }

  const names = sites.map((s) => s.name)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, names.length)) }, async () => {
    while (next < names.length) {
      const name = names[next++]
      if (name === undefined) break
      try {
        cache.set(`site:${name}`, await loadSiteDetail(netbox, name), ttl.siteDetail)
      } catch {
        // site fetch failed (NetBox hiccup); leave any previous entry in place
      }
    }
  })
  await Promise.all(workers)
}
