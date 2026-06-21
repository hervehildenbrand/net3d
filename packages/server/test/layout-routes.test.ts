import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SITE_LAYOUT_VERSION } from '@net3d/shared'
import { buildApp } from '../src/app'
import { createLayoutStore } from '../src/layout-store'
import type { SoTClient } from '../src/sot/client'

const fakeNetbox = (): SoTClient =>
  ({
    getSites: async () => [],
    getCircuits: async () => [],
    getSiteRacks: async () => [],
    getSiteCables: async () => [],
    getSitePower: async () => ({ panels: [], feeds: [] }),
    napalm: async () => ({}),
    getStatus: async () => ({ backend: 'netbox', version: '3.7.8', napalmAvailable: true }),
  }) as unknown as SoTClient

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'net3d-layoutroutes-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const buildWith = (editable: boolean, withStore = true) =>
  buildApp({
    netbox: fakeNetbox(),
    layoutStore: withStore ? createLayoutStore(dir) : undefined,
    layoutEditable: editable,
  })

const validBody = { racks: [{ rackId: 'A1', x: 1, z: 2, rotationDeg: 90 }], rooms: [], floor: null }

describe('GET /api/layouts/:site', () => {
  test('returns 404 when the site has no saved layout', async () => {
    const res = await buildWith(true).inject({ method: 'GET', url: '/api/layouts/AMS1' })
    expect(res.statusCode).toBe(404)
  })

  test('returns 404 (route absent) when the layout feature is not configured', async () => {
    const res = await buildWith(false, false).inject({ method: 'GET', url: '/api/layouts/AMS1' })
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /api/layouts/:site', () => {
  test('saves the layout and stamps version + updatedAt when editing is enabled', async () => {
    const app = buildWith(true)
    const res = await app.inject({ method: 'PUT', url: '/api/layouts/AMS1', payload: validBody })
    expect(res.statusCode).toBe(200)
    const saved = res.json()
    expect(saved.version).toBe(SITE_LAYOUT_VERSION)
    expect(typeof saved.updatedAt).toBe('string')
    expect(saved.racks).toEqual(validBody.racks)

    const get = await app.inject({ method: 'GET', url: '/api/layouts/AMS1' })
    expect(get.statusCode).toBe(200)
    expect(get.json().racks).toEqual(validBody.racks)
  })

  test('returns 403 when editing is disabled', async () => {
    const res = await buildWith(false).inject({
      method: 'PUT',
      url: '/api/layouts/AMS1',
      payload: validBody,
    })
    expect(res.statusCode).toBe(403)
  })

  test('returns 400 for an invalid payload', async () => {
    const res = await buildWith(true).inject({
      method: 'PUT',
      url: '/api/layouts/AMS1',
      payload: { racks: 'nope', rooms: [], floor: null },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/layouts/:site', () => {
  test('removes a saved layout when editing is enabled', async () => {
    const app = buildWith(true)
    await app.inject({ method: 'PUT', url: '/api/layouts/AMS1', payload: validBody })
    const del = await app.inject({ method: 'DELETE', url: '/api/layouts/AMS1' })
    expect(del.statusCode).toBe(200)
    const get = await app.inject({ method: 'GET', url: '/api/layouts/AMS1' })
    expect(get.statusCode).toBe(404)
  })

  test('returns 403 when editing is disabled', async () => {
    const res = await buildWith(false).inject({ method: 'DELETE', url: '/api/layouts/AMS1' })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /api/meta', () => {
  test('reports layoutEditable true when editing is enabled', async () => {
    const res = await buildWith(true).inject({ method: 'GET', url: '/api/meta' })
    expect(res.json().layoutEditable).toBe(true)
  })

  test('reports layoutEditable false by default', async () => {
    const res = await buildWith(false, false).inject({ method: 'GET', url: '/api/meta' })
    expect(res.json().layoutEditable).toBe(false)
  })
})
