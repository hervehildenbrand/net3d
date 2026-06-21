import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SITE_LAYOUT_VERSION, type SiteLayout } from '@net3d/shared'
import { createLayoutStore } from '../src/layout-store'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'net3d-layouts-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const layout = (over: Partial<SiteLayout> = {}): SiteLayout => ({
  version: SITE_LAYOUT_VERSION,
  updatedAt: '2026-06-21T00:00:00.000Z',
  racks: [{ rackId: 'A1', x: 5, z: 7, rotationDeg: 90 }],
  rooms: [],
  floor: null,
  ...over,
})

describe('createLayoutStore', () => {
  test('get returns null when no layout exists', () => {
    const store = createLayoutStore(dir)
    expect(store.get('AMS1')).toBeNull()
  })

  test('put then get round-trips the layout', async () => {
    const store = createLayoutStore(dir)
    await store.put('AMS1', layout())
    expect(store.get('AMS1')).toEqual(layout())
  })

  test('put creates the directory if it is missing', async () => {
    const nested = join(dir, 'does', 'not', 'exist', 'yet')
    const store = createLayoutStore(nested)
    await store.put('AMS1', layout())
    expect(store.get('AMS1')).toEqual(layout())
  })

  test('put leaves no temp files behind', async () => {
    const store = createLayoutStore(dir)
    await store.put('AMS1', layout())
    expect(readdirSync(dir).every((f) => f.endsWith('.json'))).toBe(true)
  })

  test('get returns null for corrupt JSON', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'AMS1.json'), '{ not json')
    expect(createLayoutStore(dir).get('AMS1')).toBeNull()
  })

  test('get returns null for an incompatible schema version', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'AMS1.json'), JSON.stringify({ ...layout(), version: 999 }))
    expect(createLayoutStore(dir).get('AMS1')).toBeNull()
  })

  test('site names with unusual characters round-trip', async () => {
    const store = createLayoutStore(dir)
    await store.put('site/a b', layout())
    expect(store.get('site/a b')).toEqual(layout())
  })

  test('list returns the site names that have a saved layout', async () => {
    const store = createLayoutStore(dir)
    await store.put('AMS1', layout())
    await store.put('LON2', layout())
    expect(store.list().sort()).toEqual(['AMS1', 'LON2'])
  })

  test('delete removes the layout and reports whether it existed', async () => {
    const store = createLayoutStore(dir)
    await store.put('AMS1', layout())
    expect(await store.delete('AMS1')).toBe(true)
    expect(store.get('AMS1')).toBeNull()
    expect(existsSync(join(dir, 'AMS1.json'))).toBe(false)
    expect(await store.delete('AMS1')).toBe(false)
  })
})
