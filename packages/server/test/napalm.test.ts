import { describe, expect, test } from 'vitest'
import { buildApp } from '../src/app'
import { NapalmUnreachableError } from '../src/netbox'
import type { NetBoxClient } from '../src/netbox'

function fakeNetbox(overrides: Partial<NetBoxClient> = {}): NetBoxClient {
  return {
    getSites: async () => [],
    getCircuits: async () => [],
    getSiteRacks: async () => [],
    getSiteCables: async () => [],
    getSitePower: async () => ({ panels: [], feeds: [] }),
    napalm: async (_id, method) => ({ [method]: { ok: true } }),
    getStatus: async () => ({ netboxVersion: '3.7.8', napalmAvailable: true }),
    ...overrides,
  }
}

describe('GET /api/devices/:id/napalm/:method', () => {
  test('proxies an allowlisted method', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/devices/1771/napalm/get_facts' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ get_facts: { ok: true } })
  })

  test('rejects non-allowlisted methods with 400', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/devices/1771/napalm/get_config' })
    expect(res.statusCode).toBe(400)
  })

  test('caches per device+method', async () => {
    let calls = 0
    const app = buildApp({
      netbox: fakeNetbox({
        napalm: async (_id, method) => {
          calls++
          return { [method]: calls }
        },
      }),
    })
    await app.inject({ method: 'GET', url: '/api/devices/1/napalm/get_facts' })
    await app.inject({ method: 'GET', url: '/api/devices/1/napalm/get_facts' })
    await app.inject({ method: 'GET', url: '/api/devices/1/napalm/get_environment' })
    await app.inject({ method: 'GET', url: '/api/devices/2/napalm/get_facts' })
    expect(calls).toBe(3)
  })

  test('maps device-unreachable to 503 with a sanitized body (no device IP)', async () => {
    const app = buildApp({
      netbox: fakeNetbox({
        napalm: async () => {
          throw new NapalmUnreachableError('cannot connect to 172.21.210.144')
        },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/devices/1/napalm/get_facts' })
    expect(res.statusCode).toBe(503)
    // the upstream detail carries the device IP — it must not leak to clients
    expect(res.json()).toEqual({ error: 'unreachable', detail: 'device unreachable' })
  })

  test('other upstream failures map to 502', async () => {
    const app = buildApp({
      netbox: fakeNetbox({
        napalm: async () => {
          throw new Error('boom')
        },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/devices/1/napalm/get_facts' })
    expect(res.statusCode).toBe(502)
  })

  test('sheds load with 429 when too many NAPALM calls queue up', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const app = buildApp({
      netbox: fakeNetbox({
        napalm: async () => {
          await gate
          return { get_facts: {} }
        },
      }),
      napalmMaxQueue: 2,
    })
    const p1 = app.inject({ method: 'GET', url: '/api/devices/1/napalm/get_facts' })
    const p2 = app.inject({ method: 'GET', url: '/api/devices/2/napalm/get_facts' })
    // give the first two time to occupy the queue
    await new Promise((r) => setTimeout(r, 20))
    const res3 = await app.inject({ method: 'GET', url: '/api/devices/3/napalm/get_facts' })
    expect(res3.statusCode).toBe(429)
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.statusCode).toBe(200)
    expect(r2.statusCode).toBe(200)
  })
})
