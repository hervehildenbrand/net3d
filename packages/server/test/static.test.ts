import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildApp } from '../src/app'
import type { NetBoxClient } from '../src/netbox'

function fakeNetbox(): NetBoxClient {
  return {
    getSites: async () => [],
    getCircuits: async () => [],
    getSiteRacks: async () => [],
    getSiteCables: async () => [],
    getSitePower: async () => ({ panels: [], feeds: [] }),
    napalm: async (_id, method) => ({ [method]: {} }),
    getStatus: async () => ({ netboxVersion: '4.0.5', napalmAvailable: false }),
  }
}

let dist: string
beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'net3d-dist-'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>net3d</title><body>SPA SHELL</body>')
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("hi")')
})
afterAll(() => rmSync(dist, { recursive: true, force: true }))

describe('serving the built UI (webDist)', () => {
  test('serves index.html at the root', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webDist: dist })
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('SPA SHELL')
  })

  test('serves hashed static assets', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webDist: dist })
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/javascript/)
  })

  test('falls back to index.html for client-side routes', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webDist: dist })
    const res = await app.inject({ method: 'GET', url: '/site/AMS1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('SPA SHELL')
  })

  test('API routes keep priority over the SPA fallback', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webDist: dist })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  test('unknown API routes 404 with JSON, never the SPA shell', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webDist: dist })
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('SPA SHELL')
  })

  test('without webDist the root is not served (dev mode unchanged)', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(404)
  })
})
