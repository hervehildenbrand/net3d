import { groupCircuitsBySitePair } from '@net3d/shared'
import type { TtlCache } from './cache'
import type { SoTClient } from './sot/client'
import type { SiteRack } from './sot/types'
import type { SiteCable } from './cables'
import type { SitePower } from './power'

export interface PrewarmTtl {
  sites: number
  circuits: number
  siteDetail: number
}

export interface SiteDetail {
  racks: SiteRack[]
  cables: SiteCable[]
  /** Power panels + feeds for the room-view chain; empty when none/unsupported. */
  power: SitePower
}

/** The /api/sites/:name payload — shared by the route and the pre-warm loop. */
export async function loadSiteDetail(netbox: SoTClient, name: string): Promise<SiteDetail> {
  const [racks, cables, power] = await Promise.all([
    netbox.getSiteRacks(name),
    netbox.getSiteCables(name),
    // power is optional eye-candy: a NetBox without it (or v3) must not fail the load
    netbox.getSitePower(name).catch(() => ({ panels: [], feeds: [] })),
  ])
  return { racks, cables, power }
}

/**
 * Refresh the sites/circuits/site-detail caches in place so requests are
 * always served hot. Values are swapped atomically (no eviction window);
 * per-site failures are skipped. Intended to run at startup and on an
 * interval; routes serve stale-while-revalidate as the backstop.
 */
export async function prewarmCaches(
  cache: TtlCache,
  netbox: SoTClient,
  ttl: PrewarmTtl,
  concurrency = 2,
): Promise<void> {
  const sites = await cache.refresh('sites', ttl.sites, () => netbox.getSites())

  try {
    await cache.refresh('circuits', ttl.circuits, async () =>
      groupCircuitsBySitePair(await netbox.getCircuits()),
    )
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
        await cache.refresh(`site:${name}`, ttl.siteDetail, () => loadSiteDetail(netbox, name))
      } catch {
        // site fetch failed (NetBox hiccup); leave any previous entry in place
      }
    }
  })
  await Promise.all(workers)
}
