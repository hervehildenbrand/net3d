import { describe, expect, test } from 'vitest'
import { buildApp } from '../src/app'
import type { NetBoxClient } from '../src/netbox'

function fakeNetbox(overrides: Partial<NetBoxClient> = {}): NetBoxClient {
  return {
    getSites: async () => [],
    getCircuits: async () => [],
    getSiteRacks: async () => [],
    getSiteCables: async () => [],
    getSitePower: async () => ({ panels: [], feeds: [] }),
    napalm: async (_id, method) => ({ [method]: { ok: true } }),
    getStatus: async () => ({ netboxVersion: '4.x', napalmAvailable: false }),
    ...overrides,
  }
}

describe('security headers (helmet)', () => {
  test('sets a Content-Security-Policy and X-Content-Type-Options on responses', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-security-policy']).toBeDefined()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('bearer auth on /api/*', () => {
  test('no apiToken → API is open', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    expect((await app.inject({ method: 'GET', url: '/api/sites' })).statusCode).toBe(200)
  })

  test('apiToken set → 401 without a valid bearer', async () => {
    const app = buildApp({ netbox: fakeNetbox(), apiToken: 'sekret' })
    expect((await app.inject({ method: 'GET', url: '/api/sites' })).statusCode).toBe(401)
    const bad = await app.inject({ method: 'GET', url: '/api/sites', headers: { authorization: 'Bearer nope' } })
    expect(bad.statusCode).toBe(401)
  })

  test('apiToken set → 200 with the valid bearer', async () => {
    const app = buildApp({ netbox: fakeNetbox(), apiToken: 'sekret' })
    const ok = await app.inject({ method: 'GET', url: '/api/sites', headers: { authorization: 'Bearer sekret' } })
    expect(ok.statusCode).toBe(200)
  })

  test('health stays open even with apiToken set', async () => {
    const app = buildApp({ netbox: fakeNetbox(), apiToken: 'sekret' })
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
  })
})
