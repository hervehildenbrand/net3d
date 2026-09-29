import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { LogicalEdge, LogicalLayer } from '@net3d/shared'
import { ams1Fixture } from '../lib/siteDiagramFixture'
import { layoutSiteDiagram, type RackInput } from '../lib/siteDiagramLayout'
import SiteDiagram, { RackOverlay, type SiteDiagramProps } from './SiteDiagram'

// ─────────────────────────────────────────────────────────────────────────────
// Props helper
// ─────────────────────────────────────────────────────────────────────────────

const { graph: ams1Graph, racks: ams1Racks } = ams1Fixture()

function diagramProps(
  overrides: Partial<SiteDiagramProps> = {},
): SiteDiagramProps {
  return {
    siteName: 'AMS1',
    graph: ams1Graph,
    racks: ams1Racks,
    telemetry: undefined,
    hidden: new Set<LogicalLayer | 'end'>(),
    selectedDeviceId: null,
    insets: { top: 280, right: 16, bottom: 16, left: 252 },
    onSelectDevice: vi.fn(),
    onSelectSite: vi.fn(),
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading and empty states
// ─────────────────────────────────────────────────────────────────────────────

describe('SiteDiagram states', () => {
  test('test_SiteDiagram_racksNotLoaded_showsLoadingOnly', () => {
    const html = renderToStaticMarkup(
      createElement(SiteDiagram, diagramProps({ racks: undefined })),
    )
    expect(html).toContain('Loading AMS1')
    expect(html).not.toContain('<svg')
  })

  test('test_SiteDiagram_noNodes_showsEmptyState', () => {
    const html = renderToStaticMarkup(
      createElement(SiteDiagram, diagramProps({ graph: { nodes: [], edges: [] }, racks: [] })),
    )
    expect(html).toContain('No network devices documented at AMS1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AMS1 full diagram tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SiteDiagram AMS1', () => {
  test('test_SiteDiagram_ams1_aggNodesHaveDataTierAgg', () => {
    const html = renderToStaticMarkup(createElement(SiteDiagram, diagramProps()))

    // oob-agg nodes should have data-tier="agg" (not "leaf")
    // Count nodes with data-tier="agg"
    const aggTierMatches = html.match(/data-tier="agg"/g)
    expect(aggTierMatches).toHaveLength(2) // oob-agg-1 and oob-agg-2
  })

  test('test_SiteDiagram_ams1_dataLocationIsHallName', () => {
    const html = renderToStaticMarkup(createElement(SiteDiagram, diagramProps()))

    // data-location should be the hall name, not rack name
    // First 23 racks have server-hall-1, rest have server-hall-2
    const hall1Matches = html.match(/data-location="server-hall-1"/g)
    const hall2Matches = html.match(/data-location="server-hall-2"/g)

    expect(hall1Matches).toHaveLength(23)
    expect(hall2Matches).toHaveLength(23)
  })

  test('test_SiteDiagram_ams1_transcribesEveryBandAndRackLabel', () => {
    const html = renderToStaticMarkup(createElement(SiteDiagram, diagramProps()))

    // Peer band: 6 remote routers (keep full names — they belong to other sites)
    expect(html).toContain('>FRA1-core-01<')
    expect(html).toContain('>HKG1-core-01<')
    expect(html).toContain('>LHR1-core-02<')
    expect(html).toContain('>DFW1-core-02<')
    expect(html).toContain('>GRU1-core-02<')
    expect(html).toContain('>MIA1-core-01<')

    // Core band: 2 cores (short labels: strip site prefix)
    expect(html).toContain('>core-01<')
    expect(html).toContain('>core-02<')

    // Spine band: 8 spines (short labels: strip site prefix)
    for (let i = 1; i <= 8; i++) {
      expect(html).toContain(`>spine-0${i}<`)
    }

    // Agg band: 2 oob-aggs (short labels: strip site prefix)
    expect(html).toContain('>oob-agg-1<')
    expect(html).toContain('>oob-agg-2<')

    // Row labels
    expect(html).toContain('>server-hall-1<')
    expect(html).toContain('>server-hall-2<')

    // Rack labels: SRV-01 to SRV-46 (site prefix stripped since AMS1- is the prefix)
    for (let i = 1; i <= 46; i++) {
      const rackName = `SRV-${String(i).padStart(2, '0')}`
      expect(html).toContain(`>${rackName}<`)
    }
  })

  test('test_SiteDiagram_ams1_fortySixChips18', () => {
    const html = renderToStaticMarkup(createElement(SiteDiagram, diagramProps()))

    // Each rack has a chip showing "18▸"
    const matches = html.match(/>18▸</g)
    expect(matches).toHaveLength(46)
  })

  test('test_SiteDiagram_endDevicesHidden_noChipsNoServerRows', () => {
    const hidden = new Set<LogicalLayer | 'end'>(['end'])
    const html = renderToStaticMarkup(createElement(SiteDiagram, diagramProps({ hidden })))

    // No chips (no ▸ or ▾)
    expect(html).not.toContain('▸')
    expect(html).not.toContain('▾')

    // No server names (srv-01, srv-02, etc.)
    expect(html).not.toMatch(/>srv-\d/)
  })

  test('test_SiteDiagram_isisDown_trunkDashed', () => {
    // Create a graph with an IS-IS fact that has up < total
    const modifiedGraph = {
      nodes: [...ams1Graph.nodes],
      edges: ams1Graph.edges.map((e) => {
        // Find the peer edge for FRA1
        if (e.a.includes('FRA1') || e.b.includes('FRA1')) {
          return {
            ...e,
            layers: {
              ...e.layers,
              isis: { up: 0, total: 1, label: 'L2 DOWN' },
            },
          } satisfies LogicalEdge
        }
        return e
      }),
    }

    const html = renderToStaticMarkup(
      createElement(SiteDiagram, diagramProps({ graph: modifiedGraph })),
    )

    // The FRA1 edge should have stroke-dasharray
    expect(html).toMatch(/stroke-dasharray/)
  })

  test('test_SiteDiagram_allLayersHidden_noEdgePaths', () => {
    const hidden = new Set<LogicalLayer | 'end'>(['physical', 'isis', 'ospf', 'sr'])
    const html = renderToStaticMarkup(createElement(SiteDiagram, diagramProps({ hidden })))

    // No edge paths should be rendered (paths in the edges group)
    // The diagram still renders glyphs, but not edges
    // Looking for path elements with edge data attributes
    expect(html).not.toMatch(/<path[^>]+data-edge/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RackOverlay
// ─────────────────────────────────────────────────────────────────────────────

describe('SiteDiagram accessibility', () => {
  test('test_SiteDiagram_glyphButtons_haveFullDeviceNameAriaLabel', () => {
    const html = renderToStaticMarkup(createElement(SiteDiagram, diagramProps()))

    // Glyphs should have aria-label with full device name
    // Check for a leaf glyph aria-label
    expect(html).toContain('aria-label="AMS1-SRV-01-leaf-1"')
    expect(html).toContain('aria-label="AMS1-spine-01"')
    expect(html).toContain('aria-label="AMS1-core-01"')
  })

  test('test_SiteDiagram_chips_areButtonsWithAriaLabel', () => {
    const html = renderToStaticMarkup(createElement(SiteDiagram, diagramProps()))

    // Chips should have role="button" and aria-label
    expect(html).toContain('role="button"')
    expect(html).toContain('aria-label="SRV-01: 18 servers"')
  })
})

describe('RackOverlay', () => {
  test('test_RackOverlay_ams1Rack_eighteenRowsWithThreeLinks', () => {
    const layout = layoutSiteDiagram(ams1Graph, ams1Racks, 'AMS1')
    const column = layout.columns.find((c) => c.label === 'SRV-01')!
    const colors = new Map<string, { color: string; width: number; dashed: boolean }>()

    const html = renderToStaticMarkup(
      createElement(RackOverlay, {
        column,
        layout,
        graph: ams1Graph,
        colors,
        onSelectDevice: vi.fn(),
      }),
    )

    // 18 server rows
    for (let i = 1; i <= 18; i++) {
      expect(html).toContain(`>srv-${String(i).padStart(2, '0')}<`)
    }

    // Each row has 3 link stubs: leaf-1, leaf-2, oob
    const leaf1Matches = html.match(/>leaf-1</g)
    const leaf2Matches = html.match(/>leaf-2</g)
    const oobMatches = html.match(/>oob</g)

    expect(leaf1Matches).toHaveLength(18)
    expect(leaf2Matches).toHaveLength(18)
    expect(oobMatches).toHaveLength(18)
  })
})
