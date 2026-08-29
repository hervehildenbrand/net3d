import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, test } from 'vitest'
import { buildApp } from '../src/app'
import { createLayoutStore } from '../src/layout-store'
import type { SoTClient } from '../src/sot/client'

const fakeNetbox = (overrides: Partial<SoTClient> = {}): SoTClient =>
  ({
    getSites: async () => [],
    getCircuits: async () => [],
    getSiteRacks: async () => [],
    getSiteCables: async () => [],
    getSitePower: async () => ({ panels: [], feeds: [] }),
    napalm: async () => ({}),
    getStatus: async () => ({ backend: 'netbox', version: '4.6', napalmAvailable: false }),
    ...overrides,
  }) as unknown as SoTClient

describe('POST /api/webhooks/netbox', () => {
  test('404 when no webhook secret is configured', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/netbox', payload: {} })
    expect(res.statusCode).toBe(404)
  })

  test('401 on missing or invalid signature', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webhookSecret: 'sec' })
    const missing = await app.inject({
      method: 'POST',
      url: '/api/webhooks/netbox',
      payload: { model: 'site', data: { name: 'AMS1' } },
    })
    expect(missing.statusCode).toBe(401)
    const bad = await app.inject({
      method: 'POST',
      url: '/api/webhooks/netbox',
      payload: { model: 'site', data: { name: 'AMS1' } },
      headers: { 'x-hook-signature': 'nope' },
    })
    expect(bad.statusCode).toBe(401)
  })

  test('valid webhook returns 204 and force-refetches the site cache', async () => {
    let rackCalls = 0
    const netbox = fakeNetbox({
      getSiteRacks: async () => {
        rackCalls++
        return []
      },
    })
    const app = buildApp({ netbox, webhookSecret: 'sec' })
    await app.inject({ method: 'GET', url: '/api/sites/AMS1' })
    expect(rackCalls).toBe(1)

    const body = JSON.stringify({ event: 'updated', model: 'device', data: { site: { name: 'AMS1' } } })
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/netbox',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-hook-signature': createHmac('sha512', 'sec').update(body).digest('hex'),
      },
    })
    expect(res.statusCode).toBe(204)

    await app.inject({ method: 'GET', url: '/api/sites/AMS1' })
    expect(rackCalls).toBe(2) // cache was deleted, not stale-served
  })

  test('400 on valid signature over a non-JSON body', async () => {
    const body = 'not json'
    const app = buildApp({ netbox: fakeNetbox(), webhookSecret: 'sec' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/netbox',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-hook-signature': createHmac('sha512', 'sec').update(body).digest('hex'),
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/webhooks/infrahub', () => {
  test('valid standard-webhooks signature returns 204', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webhookSecret: 'sec' })
    const body = JSON.stringify({ event: 'infrahub.node.updated', data: { kind: 'DcimDevice' } })
    const id = 'msg_1'
    const ts = '1730000000'
    const sig = 'v1,' + createHmac('sha256', 'sec').update(`${id}.${ts}.${body}`).digest('base64')
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/infrahub',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': ts,
        'webhook-signature': sig,
      },
    })
    expect(res.statusCode).toBe(204)
  })

  test('401 without standard-webhooks headers', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webhookSecret: 'sec' })
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/infrahub', payload: {} })
    expect(res.statusCode).toBe(401)
  })
})

describe('raw-body parser encapsulation', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('other JSON routes still get parsed bodies when webhooks are enabled', async () => {
    dir = mkdtempSync(join(tmpdir(), 'net3d-webhookenc-'))
    const app = buildApp({
      netbox: fakeNetbox(),
      webhookSecret: 'sec',
      layoutStore: createLayoutStore(dir),
      layoutEditable: true,
    })
    const res = await app.inject({
      method: 'PUT',
      url: '/api/layouts/AMS1',
      payload: { racks: [{ rackId: 'A1', x: 1, z: 2, rotationDeg: 90 }], rooms: [], floor: null },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().racks[0].rackId).toBe('A1')
  })
})

describe('GET /api/events', () => {
  test('404 when webhooks are disabled', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/events' })
    expect(res.statusCode).toBe(404)
  })

  test('streams SSE headers when enabled', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webhookSecret: 'sec' })
    const res = await app.inject({ method: 'GET', url: '/api/events', payloadAsStream: true })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.headers['x-accel-buffering']).toBe('no')
    res.stream().destroy() // never-ending stream — don't await the body
  })
})

describe('bearer auth exemption', () => {
  test('webhook route uses HMAC auth, not the bearer token', async () => {
    const body = JSON.stringify({ event: 'updated', model: 'site', data: { name: 'AMS1' } })
    const app = buildApp({ netbox: fakeNetbox(), webhookSecret: 'sec', apiToken: 'bearer-tok' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/netbox',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-hook-signature': createHmac('sha512', 'sec').update(body).digest('hex'),
      },
    })
    expect(res.statusCode).toBe(204)
  })

  test('SSE route is reachable without the bearer token', async () => {
    const app = buildApp({ netbox: fakeNetbox(), webhookSecret: 'sec', apiToken: 'bearer-tok' })
    const res = await app.inject({ method: 'GET', url: '/api/events', payloadAsStream: true })
    expect(res.statusCode).toBe(200)
    res.stream().destroy()
  })
})
