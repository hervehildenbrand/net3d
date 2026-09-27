import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CableLive } from '@net3d/shared'
import { beforeEach, expect, test, vi } from 'vitest'
import { CircuitPolylines } from './CircuitPolylines'

// leaflet needs `window` at import and react-leaflet hooks need a MapContainer: neither exists in the node env.
const { useMapEvents } = vi.hoisted(() => ({ useMapEvents: vi.fn() }))
vi.mock('leaflet', () => ({ divIcon: vi.fn() }))
vi.mock('react-leaflet', () => ({
  Marker: () => null,
  Polyline: () => null,
  Tooltip: () => null,
  useMap: () => ({}),
  useMapEvents,
}))

beforeEach(() => {
  useMapEvents.mockClear()
})

test('test_CircuitPolylines_without_live_data_does_not_subscribe_map_events', () => {
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: [], groups: [], live: undefined }))
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: [], groups: [], live: new Map() }))
  expect(useMapEvents).not.toHaveBeenCalled()
})

test('test_CircuitPolylines_with_live_data_subscribes_map_events', () => {
  const live = new Map<string, CableLive>([['C1', { pct: 1, bps: 1e9, stale: false }]])
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: [], groups: [], live }))
  expect(useMapEvents).toHaveBeenCalledOnce()
})
