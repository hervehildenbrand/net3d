import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CircuitGroup, CircuitLive } from '@net3d/shared'
import { beforeEach, expect, test, vi } from 'vitest'
import type { Site } from '../hooks/useSites'
import { theme } from '../theme'
import { utilColor } from '../lib/liveTelemetry'
import { CircuitPolylines } from './CircuitPolylines'

// leaflet needs `window` at import and react-leaflet hooks need a MapContainer: neither exists in the node env.
const tooltipChildren: React.ReactNode[] = []
const { useMapEvents, Polyline, Tooltip } = vi.hoisted(() => ({
  useMapEvents: vi.fn(),
  Polyline: vi.fn((props: { children?: React.ReactNode }) => props.children ?? null),
  Tooltip: vi.fn(({ children }: { children?: React.ReactNode }) => {
    if (children) tooltipChildren.push(children)
    return null
  }),
}))
vi.mock('leaflet', () => ({ divIcon: vi.fn() }))
vi.mock('react-leaflet', () => ({
  Marker: () => null,
  Pane: ({ children }: { children: React.ReactNode }) => children,
  Polyline,
  Tooltip,
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

// ─────────────────────────────────────────────────────────────────────────────
// ArcLayer tests
// ─────────────────────────────────────────────────────────────────────────────

// Re-import components after mocks - ArcLayer is new
import type { LogicalGraph, LogicalNode, LogicalLayer, LogicalEdge } from '@net3d/shared'
import { logicalLines } from './arcLines'
import { sitePills, nodeAnchors } from './sitePills'
import { ArcLayer } from './CircuitPolylines'

const mkNode = (id: string, siteName: string, sid: number | null = null, tier: LogicalNode['tier'] = 'remote'): LogicalNode => ({
  id,
  name: id,
  tier,
  siteName,
  device: tier === 'remote' ? { id: `dev-${id}`, name: id, siteName, roleName: 'router', roleColor: 'cccccc' } : null,
  sid,
})

const mkEdge = (
  a: string,
  b: string,
  layers: Partial<Record<LogicalLayer, { up: number; total: number; label: string }>>,
): LogicalEdge => ({
  id: `${a < b ? a : b}~${a < b ? b : a}`,
  a: a < b ? a : b,
  b: a < b ? b : a,
  layers,
  members: [],
})

test('test_ArcLayer_dashedLine_passesDashArray', () => {
  Polyline.mockClear()
  // Build a dashed line (IS-IS down)
  const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
  const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
    physical: { up: 1, total: 1, label: '' },
    isis: { up: 0, total: 1, label: 'L2 DOWN' },
  })
  const graph: LogicalGraph = { nodes, edges: [edge] }
  const anchors = new Map<string, [number, number]>([
    ['AMS1-core-01', [52.37, 4.89]],
    ['FRA1-core-01', [50.11, 8.68]],
  ])
  const lines = logicalLines(graph, anchors, SITES, [], new Set())
  expect(lines[0]!.dashed).toBe(true)

  // Render ArcLayer
  renderToStaticMarkup(createElement(ArcLayer, { lines, live: undefined, circles: [], boxes: [] }))

  // Should have dashArray in pathOptions
  const call = Polyline.mock.calls[0]![0] as { pathOptions: { dashArray?: string } }
  expect(call.pathOptions.dashArray).toBe('6 5')
})

test('test_ArcLayer_staleAdjacency_dashedButNotGrey', () => {
  Polyline.mockClear()
  // Build a line with stale adjacency label (isis up < total + 'stale' label)
  const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
  const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
    physical: { up: 1, total: 1, label: '' },
    isis: { up: 1, total: 2, label: 'L2 stale' },
  })
  const graph: LogicalGraph = { nodes, edges: [edge] }
  const anchors = new Map<string, [number, number]>([
    ['AMS1-core-01', [52.37, 4.89]],
    ['FRA1-core-01', [50.11, 8.68]],
  ])
  const lines = logicalLines(graph, anchors, SITES, [], new Set())
  // Plan default: grey = circuit telemetry stale only; stale adjacency = dashed + 'stale' row
  expect(lines[0]!.stale).toBe(false)
  expect(lines[0]!.dashed).toBe(true) // up < total
  expect(lines[0]!.rows.join(' ')).toContain('stale') // row includes stale label

  // No live data: default color (not grey)
  renderToStaticMarkup(createElement(ArcLayer, { lines, live: undefined, circles: [], boxes: [] }))
  const call = Polyline.mock.calls[0]![0] as { pathOptions: { color: string; dashArray?: string } }
  // Should be the default circuit color, not grey
  expect(call.pathOptions.color).toBe(theme.map.circuit)
  // Should be dashed
  expect(call.pathOptions.dashArray).toBeDefined()
})

test('test_ArcLayer_splitPaths_onePolylinePerPiece', () => {
  Polyline.mockClear()
  // MEL1-MIA1 crosses the antimeridian: paths.whole has 2 pieces
  const nodes = [mkNode('MEL1-core-01', 'MEL1'), mkNode('MIA1-core-01', 'MIA1')]
  const edge = mkEdge('MEL1-core-01', 'MIA1-core-01', { physical: { up: 1, total: 1, label: '' } })
  const graph: LogicalGraph = { nodes, edges: [edge] }
  const sitesWithMelMia = [
    ...SITES,
    site('MEL1', -37.8136, 144.9631),
    site('MIA1', 25.7617, -80.1918),
  ]
  const anchors = new Map<string, [number, number]>([
    ['MEL1-core-01', [-37.8136, 144.9631]],
    ['MIA1-core-01', [25.7617, -80.1918]],
  ])
  const lines = logicalLines(graph, anchors, sitesWithMelMia, [], new Set())
  // paths.whole should have 2 pieces
  expect(lines[0]!.paths.whole.length).toBeGreaterThan(1)

  // Render without live (draws paths.whole)
  renderToStaticMarkup(createElement(ArcLayer, { lines, live: undefined, circles: [], boxes: [] }))

  // Should draw one polyline per piece
  expect(Polyline).toHaveBeenCalledTimes(lines[0]!.paths.whole.length)
})

test('test_ArcLayer_logicalLine_polylineHasLvArcClass', () => {
  Polyline.mockClear()
  // Logical line key contains ~ (router pair)
  const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
  const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', { physical: { up: 1, total: 1, label: '' } })
  const graph: LogicalGraph = { nodes, edges: [edge] }
  const anchors = new Map<string, [number, number]>([
    ['AMS1-core-01', [52.37, 4.89]],
    ['FRA1-core-01', [50.11, 8.68]],
  ])
  const lines = logicalLines(graph, anchors, SITES, [], new Set())
  expect(lines[0]!.key).toContain('~')

  renderToStaticMarkup(createElement(ArcLayer, { lines, live: undefined, circles: [], boxes: [] }))

  // Polyline should have className 'lv-arc' for logical lines
  const call = Polyline.mock.calls[0]![0] as { className?: string }
  expect(call.className).toBe('lv-arc')
})

test('test_ArcLayer_physicalLine_polylineHasNoLvArcClass', () => {
  Polyline.mockClear()
  // Physical line key uses | not ~
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: SITES, groups: GROUPS, live: undefined }))

  // Polyline should NOT have className 'lv-arc' for physical lines
  const call = Polyline.mock.calls[0]![0] as { className?: string }
  expect(call.className).toBeUndefined()
})

test('test_ArcTooltip_logicalLineWithRows_rendersRowsInTooltip', () => {
  tooltipChildren.length = 0
  Polyline.mockClear()
  Tooltip.mockClear()

  // Build a logical line with rows
  const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
  const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
    physical: { up: 1, total: 1, label: '' },
    isis: { up: 2, total: 2, label: 'L2 UP' },
    sr: { up: 1, total: 1, label: 'adj-SID 24001/24002' },
  })
  const graph: LogicalGraph = { nodes, edges: [edge] }
  const anchors = new Map<string, [number, number]>([
    ['AMS1-core-01', [52.37, 4.89]],
    ['FRA1-core-01', [50.11, 8.68]],
  ])
  const lines = logicalLines(graph, anchors, SITES, [], new Set())
  expect(lines[0]!.rows).toHaveLength(3)

  // Render ArcLayer
  renderToStaticMarkup(createElement(ArcLayer, { lines, live: undefined, circles: [], boxes: [] }))

  // Tooltip should have been called with children containing the rows
  expect(tooltipChildren.length).toBeGreaterThan(0)
  const tooltipHtml = renderToStaticMarkup(createElement('div', null, tooltipChildren[0]))
  expect(tooltipHtml).toContain('Physical 1/1')
  expect(tooltipHtml).toContain('IS-IS 2/2')
  expect(tooltipHtml).toContain('L2 UP')
  expect(tooltipHtml).toContain('SR 1/1')
  expect(tooltipHtml).toContain('adj-SID 24001/24002')
})

test('test_ArcLayer_logicalLineTooltip_usesTooltipPane', () => {
  Polyline.mockClear()
  Tooltip.mockClear()

  // Build a logical line (key contains ~)
  const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
  const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', { physical: { up: 1, total: 1, label: '' } })
  const graph: LogicalGraph = { nodes, edges: [edge] }
  const anchors = new Map<string, [number, number]>([
    ['AMS1-core-01', [52.37, 4.89]],
    ['FRA1-core-01', [50.11, 8.68]],
  ])
  const lines = logicalLines(graph, anchors, SITES, [], new Set())
  expect(lines[0]!.key).toContain('~')

  renderToStaticMarkup(createElement(ArcLayer, { lines, live: undefined, circles: [], boxes: [] }))

  // Logical tooltip should use 'tooltipPane' to render above beads
  const tooltipCall = Tooltip.mock.calls[0]![0] as { pane?: string }
  expect(tooltipCall.pane).toBe('tooltipPane')
})

test('test_ArcLayer_physicalLineTooltip_noTooltipPaneProp', () => {
  Polyline.mockClear()
  Tooltip.mockClear()

  // Physical lines (CircuitPolylines) don't set a pane prop
  renderToStaticMarkup(createElement(CircuitPolylines, { sites: SITES, groups: GROUPS, live: undefined }))

  // Physical tooltip should NOT have pane prop (stays in parent circuits pane)
  const tooltipCall = Tooltip.mock.calls[0]![0] as { pane?: string }
  expect(tooltipCall.pane).toBeUndefined()
})
