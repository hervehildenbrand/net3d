import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CACHE_VERSION, createDiskCacheStore, hashNetboxUrl } from '../src/persistence'

const URL_A = 'http://localhost:8088'
const URL_B = 'https://netbox.example.com'

let baseDir: string
beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'net3d-cache-'))
})
afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

/** The per-instance directory a store writes into, for direct disk assertions. */
function hashDir(netboxUrl: string): string {
  return join(baseDir, hashNetboxUrl(netboxUrl))
}

/** Plant a raw file directly in an instance's cache dir (to simulate corruption/foreign data). */
function plant(netboxUrl: string, filename: string, contents: string): void {
  const dir = hashDir(netboxUrl)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, filename), contents)
}

function record(
  over: Partial<{ cacheVersion: number; netboxUrl: string; key: string; expiresAt: number; value: unknown }> = {},
): string {
  return JSON.stringify({
    cacheVersion: CACHE_VERSION,
    netboxUrl: URL_A,
    key: 'site:AMS1',
    expiresAt: 1000,
    value: { racks: [], cables: [] },
    ...over,
  })
}

describe('hashNetboxUrl', () => {
  test('is deterministic for the same url', () => {
    expect(hashNetboxUrl(URL_A)).toBe(hashNetboxUrl(URL_A))
  })

  test('ignores a trailing slash', () => {
    expect(hashNetboxUrl('http://localhost:8088')).toBe(hashNetboxUrl('http://localhost:8088/'))
  })

  test('is case-insensitive on the host', () => {
    expect(hashNetboxUrl('https://NetBox.Example.com')).toBe(hashNetboxUrl('https://netbox.example.com'))
  })

  test('differs for different instances', () => {
    expect(hashNetboxUrl(URL_A)).not.toBe(hashNetboxUrl(URL_B))
  })

  test('returns a non-empty hex string', () => {
    expect(hashNetboxUrl(URL_A)).toMatch(/^[0-9a-f]+$/)
  })
})

describe('DiskCacheStore write + loadAllSync', () => {
  test('round-trips a value with its expiresAt', async () => {
    const store = createDiskCacheStore({ baseDir, netboxUrl: URL_A })
    await store.write('site:AMS1', { racks: [1], cables: [2] }, 1234)
    const loaded = createDiskCacheStore({ baseDir, netboxUrl: URL_A }).loadAllSync()
    expect(loaded).toEqual([{ key: 'site:AMS1', value: { racks: [1], cables: [2] }, expiresAt: 1234 }])
  })

  test('round-trips multiple keys (flush awaits in-flight writes)', async () => {
    const store = createDiskCacheStore({ baseDir, netboxUrl: URL_A })
    store.write('sites', [{ name: 'AMS1' }], 10)
    store.write('site:AMS1', { racks: [], cables: [] }, 20)
    await store.flush()
    const keys = store.loadAllSync().map((e) => e.key).sort()
    expect(keys).toEqual(['site:AMS1', 'sites'])
  })

  test('uses a filesystem-safe filename for keys containing a colon', async () => {
    const store = createDiskCacheStore({ baseDir, netboxUrl: URL_A })
    await store.write('site:AMS1', { ok: true }, 1)
    const files = readdirSync(hashDir(URL_A))
    expect(files.length).toBeGreaterThan(0)
    expect(files.every((f) => f.endsWith('.json'))).toBe(true)
    expect(files.some((f) => f.includes(':'))).toBe(false)
  })

  test('returns [] when the cache directory does not exist', () => {
    const store = createDiskCacheStore({ baseDir, netboxUrl: URL_A })
    expect(store.loadAllSync()).toEqual([])
  })
})

describe('DiskCacheStore resilience', () => {
  test('skips truncated json without throwing', () => {
    plant(URL_A, 'truncated.json', '{"cacheVersion":1,"key":"site:X"')
    expect(createDiskCacheStore({ baseDir, netboxUrl: URL_A }).loadAllSync()).toEqual([])
  })

  test('skips non-json content', () => {
    plant(URL_A, 'garbage.json', 'this is not json')
    expect(createDiskCacheStore({ baseDir, netboxUrl: URL_A }).loadAllSync()).toEqual([])
  })

  test('skips records with the wrong shape', () => {
    plant(URL_A, 'wrongshape.json', JSON.stringify({ foo: 'bar' }))
    expect(createDiskCacheStore({ baseDir, netboxUrl: URL_A }).loadAllSync()).toEqual([])
  })

  test('skips records from a different cache version', () => {
    plant(URL_A, 'oldver.json', record({ cacheVersion: CACHE_VERSION + 1 }))
    expect(createDiskCacheStore({ baseDir, netboxUrl: URL_A }).loadAllSync()).toEqual([])
  })

  test('skips records written for a different netbox url', () => {
    plant(URL_A, 'foreign.json', record({ netboxUrl: URL_B }))
    expect(createDiskCacheStore({ baseDir, netboxUrl: URL_A }).loadAllSync()).toEqual([])
  })

  test('ignores .tmp and non-json files', () => {
    plant(URL_A, 'good.json', record())
    plant(URL_A, 'orphan.tmp', record())
    plant(URL_A, '.DS_Store', 'junk')
    const loaded = createDiskCacheStore({ baseDir, netboxUrl: URL_A }).loadAllSync()
    expect(loaded).toEqual([{ key: 'site:AMS1', value: { racks: [], cables: [] }, expiresAt: 1000 }])
  })
})

describe('profile isolation', () => {
  test('a store does not load entries written under a different netbox url', async () => {
    const a = createDiskCacheStore({ baseDir, netboxUrl: URL_A })
    await a.write('site:AMS1', { from: 'A' }, 1)
    const b = createDiskCacheStore({ baseDir, netboxUrl: URL_B })
    expect(b.loadAllSync()).toEqual([])
  })

  test('different urls write to different directories', async () => {
    const a = createDiskCacheStore({ baseDir, netboxUrl: URL_A })
    const b = createDiskCacheStore({ baseDir, netboxUrl: URL_B })
    await a.write('site:AMS1', { x: 1 }, 1)
    await b.write('site:AMS1', { x: 2 }, 1)
    expect(hashDir(URL_A)).not.toBe(hashDir(URL_B))
    expect(existsSync(hashDir(URL_A))).toBe(true)
    expect(existsSync(hashDir(URL_B))).toBe(true)
  })

  test('write never rejects even when the value is not serializable', async () => {
    const store = createDiskCacheStore({ baseDir, netboxUrl: URL_A })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(store.write('site:BAD', circular, 1)).resolves.toBeUndefined()
  })
})
