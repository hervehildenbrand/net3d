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
    getStatus: async () => ({ backend: 'netbox', version: '4.x', napalmAvailable: false }),
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

  // Regression: the 3D UI renders labels via @react-three/drei <Text>, which uses
  // troika-worker-utils. Troika spawns a Web Worker from a blob and then calls
  // importScripts(blob:) INSIDE it — and importScripts is governed by `script-src`,
  // not `worker-src`. If script-src omits blob:, that import is blocked, the worker
  // dies ("failed to rehydrate"), the R3F room subtree crashes, and no racks render.
  // (Only bites in the production/self-host build, where this server sends the CSP;
  // the Vite dev server doesn't, which is why it passed locally.)
  test("script-src allows 'blob:' so drei/troika text workers can importScripts blob URLs", async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    const csp = String(res.headers['content-security-policy'])
    const scriptSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d === 'script-src' || d.startsWith('script-src '))
    expect(scriptSrc, `script-src directive missing in CSP: ${csp}`).toBeDefined()
    expect(scriptSrc).toContain('blob:')
  })
})

describe('rate limiting', () => {
  test('emits x-ratelimit-* headers on API responses', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/sites' })
    expect(res.headers['x-ratelimit-limit']).toBeDefined()
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

describe('frame embedding (frameAncestors)', () => {
  function frameAncestorsOf(csp: string): string | undefined {
    return csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d === 'frame-ancestors' || d.startsWith('frame-ancestors '))
  }

  test('default → same-origin only: X-Frame-Options set and CSP frame-ancestors is self', async () => {
    const app = buildApp({ netbox: fakeNetbox() })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.headers['x-frame-options']).toBeDefined()
    expect(frameAncestorsOf(String(res.headers['content-security-policy']))).toBe("frame-ancestors 'self'")
  })

  test('frameAncestors set → drops X-Frame-Options and allows the configured origin', async () => {
    const app = buildApp({ netbox: fakeNetbox(), frameAncestors: ['http://localhost:8080'] })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    // X-Frame-Options can't express an arbitrary allowed origin; modern browsers
    // honor CSP frame-ancestors, so the legacy header is dropped when embedding.
    expect(res.headers['x-frame-options']).toBeUndefined()
    expect(frameAncestorsOf(String(res.headers['content-security-policy'])))
      .toBe("frame-ancestors 'self' http://localhost:8080")
  })
})
