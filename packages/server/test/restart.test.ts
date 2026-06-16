import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildApp } from '../src/app'
import type { NetBoxClient, SiteRack } from '../src/netbox'
import { createDiskCacheStore } from '../src/persistence'

const SITE_META = {
  region: null,
  status: 'active',
  physicalAddress: null,
  facility: null,
  role: null,
  rackCount: null,
  deviceCount: null,
} as const

function rack(name: string): SiteRack {
  return { id: name, name, uHeight: 42, location: null, devices: [] }
}

/** A NetBox whose getSiteRacks is tagged + counted, so we can tell a disk serve from a fetch. */
function countingNetbox(rackName: string) {
  const counts = { racks: 0, cables: 0 }
  const netbox: NetBoxClient = {
    getSites: async () => [{ id: '1', name: 'AMS1', latitude: 0, longitude: 0, ...SITE_META }],
    getCircuits: async () => [],
    getSiteRacks: async () => {
      counts.racks++
      return [rack(rackName)]
    },
    getSiteCables: async () => {
      counts.cables++
      return []
    },
    getSitePower: async () => ({ panels: [], feeds: [] }),
    napalm: async () => ({}),
    getStatus: async () => ({ backend: 'netbox' as const, version: '4.6.0', napalmAvailable: false }),
  }
  return { netbox, counts }
}

const URL = 'http://netbox.test:8088'

let baseDir: string
beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'net3d-restart-'))
})
afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

describe('cache persistence across restarts', () => {
  test('a previously-warmed site is served from disk after a restart, with no request-path fetch', async () => {
    // first boot: cold-fetch AMS1 and write it through to disk
    const first = countingNetbox('PERSISTED-RACK')
    const store1 = createDiskCacheStore({ baseDir, netboxUrl: URL })
    const app1 = buildApp({ netbox: first.netbox, persist: store1 })
    const r1 = await app1.inject({ method: 'GET', url: '/api/sites/AMS1' })
    expect(r1.statusCode).toBe(200)
    expect(first.counts.racks).toBe(1) // cold fetch happened on first boot
    await store1.flush() // make sure the write-through landed before "restarting"
    await app1.close()

    // restart: fresh app + fresh NetBox client, same on-disk cache dir
    const second = countingNetbox('FRESH-FETCH')
    const store2 = createDiskCacheStore({ baseDir, netboxUrl: URL })
    const app2 = buildApp({ netbox: second.netbox, persist: store2 })
    const r2 = await app2.inject({ method: 'GET', url: '/api/sites/AMS1' })

    expect(r2.statusCode).toBe(200)
    // it served the PERSISTED payload, not app2's own (FRESH-FETCH) fetch result…
    expect(r2.json()).toEqual({ racks: [rack('PERSISTED-RACK')], cables: [], power: { panels: [], feeds: [] } })
    // …and made no NetBox call on the request path
    expect(second.counts.racks).toBe(0)
    await app2.close()
  })

  test('the persisted cache is isolated per NetBox instance', async () => {
    const first = countingNetbox('A-RACK')
    const store1 = createDiskCacheStore({ baseDir, netboxUrl: 'http://a.test:8088' })
    const app1 = buildApp({ netbox: first.netbox, persist: store1 })
    await app1.inject({ method: 'GET', url: '/api/sites/AMS1' })
    await store1.flush()
    await app1.close()

    // a different instance over the same base dir must not see instance A's data
    const second = countingNetbox('B-RACK')
    const store2 = createDiskCacheStore({ baseDir, netboxUrl: 'http://b.test:8088' })
    const app2 = buildApp({ netbox: second.netbox, persist: store2 })
    const r2 = await app2.inject({ method: 'GET', url: '/api/sites/AMS1' })

    expect(r2.json()).toEqual({ racks: [rack('B-RACK')], cables: [], power: { panels: [], feeds: [] } })
    expect(second.counts.racks).toBe(1) // had to fetch — A's cache was correctly invisible
    await app2.close()
  })
})
