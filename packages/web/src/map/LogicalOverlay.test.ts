import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test, vi } from 'vitest'
import type { LogicalGraph, LogicalLayer, LogicalNode, LogicalEdge, CircuitGroup } from '@net3d/shared'
import type { Site } from '../hooks/useSites'

// ─────────────────────────────────────────────────────────────────────────────
// Mock setup — hoisted
// ─────────────────────────────────────────────────────────────────────────────

// Capture Marker and Tooltip props
const markerInstances: { position: [number, number]; eventHandlers?: Record<string, () => void>; props: Record<string, unknown> }[] = []
const tooltipInstances: { permanent?: boolean; pane?: string; className?: string }[] = []
let mockZoom = 5

const { useMap, useMapEvents, Marker, Tooltip } = vi.hoisted(() => ({
  useMap: vi.fn(() => ({
    getZoom: () => mockZoom,
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
  })),
  useMapEvents: vi.fn(() => null),
  Marker: vi.fn((props: Record<string, unknown>) => {
    markerInstances.push({
      position: props.position as [number, number],
      eventHandlers: props.eventHandlers as Record<string, () => void>,
      props,
    })
    if (props.children) return props.children
    return null
  }),
  Tooltip: vi.fn((props: Record<string, unknown>) => {
    tooltipInstances.push({
      permanent: props.permanent as boolean | undefined,
      pane: props.pane as string | undefined,
      className: props.className as string | undefined,
    })
    return null
  }),
}))

// Mock setMapView
const mockSetMapView = vi.fn()
const mockOnSiteSelect = vi.fn()

vi.mock('leaflet', () => ({ divIcon: vi.fn((_: unknown) => ({})) }))
vi.mock('react-leaflet', () => ({
  Marker,
  Pane: ({ children }: { children: React.ReactNode }) => children,
  Polyline: vi.fn((_: unknown) => null),
  Tooltip,
  useMap,
  useMapEvents,
}))
vi.mock('../store/useAppStore', () => ({
  useAppStore: (sel: (s: { setMapView: typeof mockSetMapView }) => unknown) =>
    sel({ setMapView: mockSetMapView }),
}))
vi.mock('../hooks/useSitePrefetch', () => ({
  useSitePrefetch: () => vi.fn(),
}))

// Import after mocks
import { SitePills, LogicalArcs, sitePills } from './LogicalOverlay'
import { nodeAnchors } from './sitePills'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const site = (name: string, latitude: number, longitude: number, role: 'compute' | 'pop' | null = 'compute'): Site =>
  ({ name, latitude, longitude, role } as Site)

const SITES: Site[] = [
  site('AMS1', 52.37, 4.89),
  site('FRA1', 50.11, 8.68),
]

/** Single-site fixture for tests that verify specific pill behavior. */
const SINGLE_SITE: Site[] = [site('AMS1', 52.37, 4.89)]

const mkNode = (id: string, siteName: string, sid: number | null = null, tier: LogicalNode['tier'] = 'remote'): LogicalNode => ({
  id,
  name: id,
  tier,
  siteName,
  device: tier === 'remote' ? { id: `dev-${id}`, name: id, siteName, roleName: 'router', roleColor: '#ccc' } : null,
  sid,
})

const mkEdge = (
  a: string,
  b: string,
  layers: Partial<Record<LogicalLayer, { up: number; total: number; label: string }>>,
  members: { id: string; a: { deviceName: string; name: string } | null; b: { deviceName: string; name: string } | null }[] = [],
): LogicalEdge => ({
  id: `${a < b ? a : b}~${a < b ? b : a}`,
  a: a < b ? a : b,
  b: a < b ? b : a,
  layers,
  members,
})

const circuitGroup = (
  siteA: string,
  siteZ: string,
  circuits: { id: string; cid: string; commitRate: number | null }[],
): CircuitGroup => ({
  siteA,
  siteZ,
  count: circuits.length,
  circuitIds: circuits.map((c) => c.id),
  circuits: circuits.map((c) => ({
    id: c.id,
    cid: c.cid,
    provider: 'test-provider',
    siteA,
    siteZ,
    commitRate: c.commitRate,
    status: 'active',
    description: null,
  })),
  maxCommitRate: circuits.reduce((max, c) => Math.max(max, c.commitRate ?? 0), 0) || null,
})

// ─────────────────────────────────────────────────────────────────────────────
// SitePills tests
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  markerInstances.length = 0
  tooltipInstances.length = 0
  mockSetMapView.mockClear()
  mockOnSiteSelect.mockClear()
  useMap.mockClear()
  mockZoom = 5
})

test('test_SitePills_click_storesMapViewAndSelectsSite', () => {
  const nodes = [mkNode('AMS1-core-01', 'AMS1', 16001)]
  const graph: LogicalGraph = { nodes, edges: [] }
  const pills = sitePills(graph, SINGLE_SITE)

  renderToStaticMarkup(
    createElement(SitePills, {
      pills,
      showSid: true,
      onSiteSelect: mockOnSiteSelect,
    }),
  )

  // Should have 1 marker for AMS1
  expect(markerInstances).toHaveLength(1)

  // Simulate click
  const ams1Marker = markerInstances[0]!
  ams1Marker.eventHandlers?.click?.()

  // Should call setMapView with site lat/lng and zoom 13
  expect(mockSetMapView).toHaveBeenCalledWith({
    center: [52.37, 4.89],
    zoom: 13,
  })

  // Should call onSiteSelect with site name
  expect(mockOnSiteSelect).toHaveBeenCalledWith('AMS1')
})

test('test_SitePills_atLabelZoom_tooltipPermanent', () => {
  // Mock useMap to return zoom 5 (LABEL_ZOOM)
  mockZoom = 5

  const nodes = [mkNode('AMS1-core-01', 'AMS1', 16001)]
  const graph: LogicalGraph = { nodes, edges: [] }
  const pills = sitePills(graph, SINGLE_SITE)

  renderToStaticMarkup(
    createElement(SitePills, {
      pills,
      showSid: true,
      onSiteSelect: mockOnSiteSelect,
    }),
  )

  // Tooltip should be permanent at zoom 5
  expect(tooltipInstances).toHaveLength(1)
  expect(tooltipInstances[0]!.permanent).toBe(true)
})

test('test_SitePills_belowLabelZoom_tooltipOnHoverOnly', () => {
  // Mock useMap to return zoom 4 (below LABEL_ZOOM)
  mockZoom = 4
  useMap.mockReturnValue({
    getZoom: () => 4,
    latLngToContainerPoint: () => ({ x: 0, y: 0 }),
  })

  const nodes = [mkNode('AMS1-core-01', 'AMS1', 16001)]
  const graph: LogicalGraph = { nodes, edges: [] }
  const pills = sitePills(graph, SINGLE_SITE)

  renderToStaticMarkup(
    createElement(SitePills, {
      pills,
      showSid: true,
      onSiteSelect: mockOnSiteSelect,
    }),
  )

  // Tooltip should NOT be permanent below LABEL_ZOOM
  expect(tooltipInstances).toHaveLength(1)
  expect(tooltipInstances[0]!.permanent).toBe(false)
})

test('test_SitePills_tooltip_hasTranslucentClassAndArcLabelsPane', () => {
  mockZoom = 5

  const nodes = [mkNode('AMS1-core-01', 'AMS1', 16001)]
  const graph: LogicalGraph = { nodes, edges: [] }
  const pills = sitePills(graph, SINGLE_SITE)

  renderToStaticMarkup(
    createElement(SitePills, {
      pills,
      showSid: true,
      onSiteSelect: mockOnSiteSelect,
    }),
  )

  // Tooltip should have pane="arcLabels" (below sites pane)
  expect(tooltipInstances).toHaveLength(1)
  expect(tooltipInstances[0]!.pane).toBe('arcLabels')
  // Tooltip should have className for translucent styling
  expect(tooltipInstances[0]!.className).toContain('lv-label')
})

// ─────────────────────────────────────────────────────────────────────────────
// LogicalArcs tests
// ─────────────────────────────────────────────────────────────────────────────

// Capture Polyline calls
const polylineCalls: { positions: unknown; pathOptions: unknown }[] = []
vi.mock('react-leaflet', async () => {
  return {
    Marker,
    Pane: ({ children }: { children: React.ReactNode }) => children,
    Polyline: vi.fn((props: Record<string, unknown>) => {
      polylineCalls.push({ positions: props.positions, pathOptions: props.pathOptions })
      return null
    }),
    Tooltip,
    useMap,
    useMapEvents,
  }
})

test('test_LogicalArcs_backboneGraph_passesRouterLinesToArcLayer', () => {
  polylineCalls.length = 0
  markerInstances.length = 0

  const nodes = [
    mkNode('AMS1-core-01', 'AMS1', 16001),
    mkNode('FRA1-core-01', 'FRA1', 16002),
  ]
  const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
    physical: { up: 1, total: 1, label: '' },
  }, [
    { id: 'CID-001', a: { deviceName: 'AMS1-core-01', name: 'et-0/0/0' }, b: { deviceName: 'FRA1-core-01', name: 'et-0/0/0' } },
  ])
  const graph: LogicalGraph = { nodes, edges: [edge] }
  const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'CID-001', commitRate: 100_000_000 }])]
  const pills = sitePills(graph, SITES)

  renderToStaticMarkup(
    createElement(LogicalArcs, {
      graph,
      sites: SITES,
      groups,
      circuitLive: undefined,
      hidden: new Set<LogicalLayer | 'end'>(),
      pills,
      dotSites: [],
    }),
  )

  // Should have at least one polyline drawn (one whole arc)
  expect(polylineCalls.length).toBeGreaterThan(0)
})
