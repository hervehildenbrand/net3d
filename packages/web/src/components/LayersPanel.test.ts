import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { LayersPanel } from './LayersPanel'

function props(overrides: Partial<ComponentProps<typeof LayersPanel>>): ComponentProps<typeof LayersPanel> {
  return {
    level: 'rack',
    racks: [],
    colorMode: 'none',
    onColorMode: vi.fn(),
    highlightedRoles: new Set<string>(),
    onToggleRole: vi.fn(),
    onClearRoles: vi.fn(),
    specsMetric: null,
    onSpecsMetric: vi.fn(),
    hiddenStatuses: new Set<string>(),
    onToggleHiddenStatus: vi.fn(),
    subnets: [],
    cableColorMode: 'medium',
    onCableColorMode: vi.fn(),
    powerVisible: false,
    onTogglePower: vi.fn(),
    connectivityVisible: false,
    onToggleConnectivity: vi.fn(),
    dcLinksVisible: false,
    onToggleDcLinks: vi.fn(),
    ipLabelsVisible: false,
    onToggleIpLabels: vi.fn(),
    ...overrides,
  }
}

test('test_LayersPanel_rack_without_telemetry_offers_medium_and_speed_only', () => {
  const html = renderToStaticMarkup(createElement(LayersPanel, props({ level: 'rack' })))
  expect(html).toContain('>medium<')
  expect(html).toContain('>speed<')
  expect(html).not.toContain('>live<')
})

test('test_LayersPanel_site_with_telemetry_offers_medium_and_live', () => {
  const html = renderToStaticMarkup(createElement(LayersPanel, props({ level: 'site', telemetryAvailable: true })))
  expect(html).toContain('>medium<')
  expect(html).toContain('>live<')
  expect(html).not.toContain('>speed<')
})

test('test_LayersPanel_site_without_telemetry_hides_cables_row', () => {
  const html = renderToStaticMarkup(createElement(LayersPanel, props({ level: 'site' })))
  expect(html).not.toContain('>Cables<')
})

test('test_LayersPanel_site_cableColorMode_speed_renders_medium_active', () => {
  // 'speed' is a rack-only mode; carried over from a rack->site nav it isn't offered
  // here, so the display should fall back to showing 'medium' as active (no store write).
  const html = renderToStaticMarkup(
    createElement(LayersPanel, props({ level: 'site', telemetryAvailable: true, cableColorMode: 'speed' })),
  )
  const mediumButton = html.match(/<button[^>]*>medium<\/button>/)?.[0]
  expect(mediumButton).toContain('background:#0891b2')
})

test('test_LayersPanel_live_mode_shows_utilization_legend', () => {
  const html = renderToStaticMarkup(
    createElement(LayersPanel, props({ level: 'site', telemetryAvailable: true, cableColorMode: 'live' })),
  )
  expect(html).toContain('0.01')
  expect(html).toContain('100 %')
  expect(html).toContain('stale')
})

test('test_LayersPanel_rack_without_telemetry_renders_original_cables_row', () => {
  const html = renderToStaticMarkup(createElement(LayersPanel, props({ level: 'rack' })))
  // exact element from the release before live telemetry existed
  expect(html).toContain(
    '<div style="display:flex;gap:4px;margin-left:auto" title="color rack cables by physical medium or by interface line rate">',
  )
  expect(html).not.toContain('flex-wrap')
})

test('test_LayersPanel_rack_with_telemetry_wraps_three_cable_modes', () => {
  const html = renderToStaticMarkup(createElement(LayersPanel, props({ level: 'rack', telemetryAvailable: true })))
  expect(html).toContain('>live<')
  expect(html).toContain('flex-wrap:wrap')
})
