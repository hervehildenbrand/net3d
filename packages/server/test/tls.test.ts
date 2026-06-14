import { createServer } from 'node:http'
import { describe, expect, test } from 'vitest'
import { netboxFetch } from '../src/netbox'

describe('netboxFetch (scoped TLS verification)', () => {
  test('returns the global fetch unchanged when TLS verification is on', () => {
    // verification on = default safe path, no per-call dispatcher needed
    expect(netboxFetch(true)).toBe(fetch)
  })

  test('returns a distinct wrapper when TLS verification is disabled', () => {
    // disabling verification must be scoped to NetBox calls, not process-wide,
    // so it has to be a wrapper carrying an undici dispatcher — not global fetch
    const f = netboxFetch(false)
    expect(f).not.toBe(fetch)
    expect(typeof f).toBe('function')
  })

  test('the TLS-relaxed wrapper can perform real requests', async () => {
    // regression: the dispatcher and the fetch must come from the same undici,
    // or undici rejects the request with UND_ERR_INVALID_ARG
    const server = createServer((_req, res) => res.end('ok'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    try {
      const res = await netboxFetch(false)(`http://127.0.0.1:${port}/`)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('ok')
    } finally {
      server.close()
    }
  })
})
