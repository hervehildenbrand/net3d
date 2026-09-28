import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CircuitGroup, CircuitLive } from '@net3d/shared'
import { beforeEach, expect, test, vi } from 'vitest'
import type { Site } from '../hooks/useSites'
import { theme } from '../theme'
import { utilColor } from '../lib/liveTelemetry'
import { CircuitPolylines } from './CircuitPolylines'

// leaflet needs `window` at import and react-leaflet hooks need a MapContainer: neither exists in the node env.
const { useMapEvents, Polyline } = vi.hoisted(() => ({ useMapEvents: vi.fn(), Polyline: vi.fn((_: unknown) => null) }))
vi.mock('leaflet', () => ({ divIcon: vi.fn() }))
vi.mock('react-leaflet', () => ({
  Marker: () => null,
  Pane: ({ children }: { children: React.ReactNode }) => children,
  Polyline,
  Tooltip: () => null,
  useMap: () => ({ latLngToContainerPoint: () => ({ x: 0, y: 0 }) }),
  useMapEvents,
}))

const site = (name: string, latitude: number, longitude: number) => ({ name, latitude, longitude }) as Site
const SITES = [site('AMS1', 52.37, 4.89), site('FRA1', 50.11, 8.68)]
const GROUPS: CircuitGroup[] = [
  {
    siteA: 'AMS1',
    siteZ: 'FRA1',
    count: 1,
    circuitIds: ['C1'],
    circuits: [{ id: '1', cid: 'C1', provider: null, siteA: 'AMS1', siteZ: 'FRA1', commitRate: 100_000_000, status: 'active', description: null }],
    maxCommitRate: 100_000_000,
  },
]
const pathColor = (i: number) => (Polyline.mock.calls[i]![0] as { pathOptions: { color: string } }).pathOptions.color

beforeEach(() => {
  useMapEvents.mockClear()
  Polyline.mockClear()
})

test('test_CircuitPolylines_without_live_data_does_not_subscribe_map_events', () => {
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: [], groups: [], live: undefined }))
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: [], groups: [], live: new Map() }))
  expect(useMapEvents).not.toHaveBeenCalled()
})

test('test_CircuitPolylines_with_live_data_subscribes_map_events', () => {
  const live = new Map<string, CircuitLive>([['C1', { pct: 1, bps: 1e9, stale: false }]])
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: [], groups: [], live }))
  expect(useMapEvents).toHaveBeenCalledOnce()
})

test('test_CircuitPolylines_without_live_data_draws_one_static_arc_per_link', () => {
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: SITES, groups: GROUPS, live: undefined }))
  expect(Polyline).toHaveBeenCalledTimes(1)
  expect(pathColor(0)).toBe(theme.map.circuit)
})

test('test_CircuitPolylines_with_directions_draws_two_halves_coloured_by_leaving_site', () => {
  const live = new Map<string, CircuitLive>([
    ['C1', { pct: 70, bps: 7e9, stale: false, dirs: { AMS1: { bps: 7e9, pct: 70 }, FRA1: { bps: 2e8, pct: 0.2 } } }],
  ])
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: SITES, groups: GROUPS, live }))
  expect(Polyline).toHaveBeenCalledTimes(2)
  expect(pathColor(0)).toBe(utilColor(70)) // AMS1 half: AMS1 → FRA1
  expect(pathColor(1)).toBe(utilColor(0.2)) // FRA1 half: FRA1 → AMS1
  const a = (Polyline.mock.calls[0]![0] as { positions: [number, number][] }).positions
  const z = (Polyline.mock.calls[1]![0] as { positions: [number, number][] }).positions
  expect(a.at(-1)).toEqual(z[0]) // halves meet at the midpoint
})

test('test_CircuitPolylines_link_without_telemetry_keeps_one_static_arc_when_live', () => {
  const live = new Map<string, CircuitLive>([['OTHER', { pct: 1, bps: 1e9, stale: false }]])
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: SITES, groups: GROUPS, live }))
  expect(Polyline).toHaveBeenCalledTimes(1)
  expect(pathColor(0)).toBe(theme.map.circuit)
})
