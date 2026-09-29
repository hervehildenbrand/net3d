import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { LogicalLayer } from '@net3d/shared'
import { ViewModeSwitch, LogicalLayers } from './LogicalControls'

// -----------------------------------------------------------------------------
// ViewModeSwitch props helper
// -----------------------------------------------------------------------------

function switchProps(
  overrides: Partial<ComponentProps<typeof ViewModeSwitch>> = {},
): ComponentProps<typeof ViewModeSwitch> {
  return {
    available: true,
    viewMode: 'physical',
    level: 'site',
    leftOffset: 46,
    inEditMode: false,
    onSwitch: vi.fn(),
    onMouseEnter: vi.fn(),
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// LogicalLayers props helper
// -----------------------------------------------------------------------------

function layersProps(
  overrides: Partial<ComponentProps<typeof LogicalLayers>> = {},
): ComponentProps<typeof LogicalLayers> {
  return {
    level: 'site',
    layers: ['physical', 'isis'],
    hidden: new Set<LogicalLayer | 'end'>(),
    onToggle: vi.fn(),
    hasLive: false,
    isError: false,
    ...overrides,
  }
}

// -----------------------------------------------------------------------------
// ViewModeSwitch tests
// -----------------------------------------------------------------------------

test('test_ViewModeSwitch_unavailable_rendersNothing', () => {
  const html = renderToStaticMarkup(createElement(ViewModeSwitch, switchProps({ available: false })))
  expect(html).toBe('')
})

test('test_ViewModeSwitch_logical_marksLogicalPressed', () => {
  const html = renderToStaticMarkup(createElement(ViewModeSwitch, switchProps({ viewMode: 'logical' })))
  // Physical button should have aria-pressed=false
  expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Physical<\/button>/)
  // Logical button should have aria-pressed=true
  expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Logical<\/button>/)
})

// -----------------------------------------------------------------------------
// LogicalLayers tests
// -----------------------------------------------------------------------------

test('test_LogicalLayers_offersOnlyLayersPresent', () => {
  // Pass only 'physical' and 'isis' layers; 'ospf' and 'sr' should not appear
  const html = renderToStaticMarkup(createElement(LogicalLayers, layersProps({ layers: ['physical', 'isis'] })))
  expect(html).toContain('>physical<')
  expect(html).toContain('>IS-IS<')
  expect(html).not.toContain('>OSPF<')
  expect(html).not.toContain('>SR<')
  expect(html).toContain('>End devices<')
})

test('test_LogicalLayers_collectorError_showsStatusLine', () => {
  const html = renderToStaticMarkup(createElement(LogicalLayers, layersProps({ isError: true })))
  expect(html).toContain('collector unreachable')
})

test('test_LogicalLayers_noLive_hidesLegend', () => {
  // Without hasLive, UtilLegend should not appear
  const html = renderToStaticMarkup(createElement(LogicalLayers, layersProps({ hasLive: false })))
  expect(html).not.toContain('0.01')
  expect(html).not.toContain('100 %')
  expect(html).not.toContain('stale')
})

test('test_LogicalLayers_mapLevel_clearsAttribution', () => {
  // At map level, position is { bottom: 32, right: 16, top: 'auto' }
  // The top:auto clears any inherited positioning that might cover attribution
  const html = renderToStaticMarkup(createElement(LogicalLayers, layersProps({ level: 'map' })))
  expect(html).toContain('bottom:32')
  expect(html).toContain('right:16')
  expect(html).toContain('top:auto')
})

test('test_LogicalLayers_mapLevel_omitsEndDevices', () => {
  // At map level, the "End devices" row should not be rendered
  const html = renderToStaticMarkup(createElement(LogicalLayers, layersProps({ level: 'map' })))
  expect(html).not.toContain('End devices')
})

test('test_LogicalLayers_noTopology_showsNoRoutingDataYet', () => {
  // When layers is empty and no error, show "no routing data yet"
  const html = renderToStaticMarkup(createElement(LogicalLayers, layersProps({ layers: [], isError: false })))
  expect(html).toContain('no routing data yet')
})

test('test_LogicalLayers_mapLevel_hidesUtilLegend', () => {
  // Brief: 'no UtilLegend (MapLegend has one)' at map level
  const html = renderToStaticMarkup(
    createElement(LogicalLayers, layersProps({ level: 'map', hasLive: true })),
  )
  // UtilLegend shows '0.01' through '100 %' scale text; neither should appear at map
  expect(html).not.toContain('0.01')
  expect(html).not.toContain('100 %')
})
