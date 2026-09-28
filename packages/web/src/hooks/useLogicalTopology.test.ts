import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import { siteTopologyQueryOptions, backboneTopologyQueryOptions } from './useLogicalTopology'

afterEach(() => vi.unstubAllGlobals())

const TOPOLOGY = {
  facts: [{ layer: 'isis', device: 'r1', iface: 'et-0/0/0', remote: 'r2', remoteIface: 'et-0/0/1', up: true, label: 'L2' }],
  nodeSids: { r1: 16001 },
  circuits: [],
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

test('test_siteTopologyQueryOptions_polls_every_30_seconds', () => {
  const opts = siteTopologyQueryOptions('netbox', 'site-a')
  expect(opts.refetchInterval).toBe(30_000)
  expect(opts.refetchIntervalInBackground).toBe(false)
  expect(opts.retry).toBe(false)
})

test('test_siteTopologyQueryOptions_key_never_starts_with_site', () => {
  const opts = siteTopologyQueryOptions('netbox', 'site-a')
  expect(opts.queryKey[0]).not.toBe('site')
  expect(opts.queryKey).toEqual(['topology', 'netbox', 'site', 'site-a'])
})

test('test_backboneTopologyQueryOptions_fetches_backend_prefixed_url', async () => {
  const fetchMock = vi.fn(async () => response(TOPOLOGY))
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient()
  await client.fetchQuery(backboneTopologyQueryOptions('infrahub'))
  expect(fetchMock).toHaveBeenCalledWith('/api-infrahub/telemetry/topology/backbone', expect.any(Object))
  client.clear()
})

test('test_backboneTopologyQueryOptions_http_error_rejects', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
  const client = new QueryClient()
  await expect(client.fetchQuery(backboneTopologyQueryOptions('netbox'))).rejects.toThrow('topology backbone: HTTP 503')
  client.clear()
})
