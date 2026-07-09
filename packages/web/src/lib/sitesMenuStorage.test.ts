import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { loadSitesMenuOpen, saveSitesMenuOpen } from './sitesMenuStorage'

describe('sites menu open persistence', () => {
  const store: Record<string, string> = {}
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (k in store ? store[k]! : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k]
      },
      key: () => null,
      length: 0,
    } as Storage
  })
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage
  })

  test('loadSitesMenuOpen defaults to open', () => {
    expect(loadSitesMenuOpen()).toBe(true)
  })

  test('saveSitesMenuOpen(false) round-trips to closed', () => {
    saveSitesMenuOpen(false)
    expect(loadSitesMenuOpen()).toBe(false)
  })

  test('saveSitesMenuOpen(true) round-trips to open', () => {
    saveSitesMenuOpen(false)
    saveSitesMenuOpen(true)
    expect(loadSitesMenuOpen()).toBe(true)
  })
})
