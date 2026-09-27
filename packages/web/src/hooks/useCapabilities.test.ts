import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { capabilitiesQueryOptions } from './useCapabilities'

afterEach(() => vi.unstubAllGlobals())

// /api/meta as served without a telemetry collector: the key is absent, not false.
const META_WITHOUT_TELEMETRY = {
  backend: 'netbox',
  version: '4.6.0',
  napalmAvailable: true,
  layoutEditable: false,
  layoutPreview: false,
  liveUpdatesAvailable: false,
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

test('test_capabilitiesQueryOptions_meta_without_telemetry_key_reads_false', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response(META_WITHOUT_TELEMETRY)))
  const client = new QueryClient()
  const caps = await client.fetchQuery(capabilitiesQueryOptions('netbox'))
  expect(caps.telemetryAvailable).toBe(false)
  expect(caps.napalmAvailable).toBe(true)
  client.clear()
})

test('test_capabilitiesQueryOptions_meta_with_telemetry_reads_true', async () => {
  const fetchMock = vi.fn(async () => response({ ...META_WITHOUT_TELEMETRY, telemetryAvailable: true }))
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient()
  const caps = await client.fetchQuery(capabilitiesQueryOptions('infrahub'))
  expect(fetchMock).toHaveBeenCalledWith('/api-infrahub/meta')
  expect(caps.telemetryAvailable).toBe(true)
  client.clear()
})
