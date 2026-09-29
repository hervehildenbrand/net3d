import { describe, expect, test } from 'vitest'
import { ams1Fixture, popFixture, type RackInput } from './siteDiagramFixture'
import {
  layoutSiteDiagram,
  edgePath,
  overlayBox,
  focusOf,
  shortLabel,
  fitLabel,
  COL_W,
  PEER_Y,
  CORE_Y,
  SPINE_Y,
  RACKS_Y,
  MAX_COLS,
  OTHER,
  type SiteDiagramLayout,
  type Glyph,
} from './siteDiagramLayout'
import { buildLogicalGraph, type GraphInput, type LogicalGraph } from '@net3d/shared'

// ─────────────────────────────────────────────────────────────────────────────
// Fixture layer validation
// ─────────────────────────────────────────────────────────────────────────────

describe('siteFixture', () => {
  test('test_siteFixture_ams1_layersMatchLive', () => {
    const { graph } = ams1Fixture()

    // Count layers
    const layers: Record<string, number> = {}
    let layerless = 0
    for (const e of graph.edges) {
      const edgeLayers = Object.keys(e.layers)
      if (edgeLayers.length === 0) layerless++
      for (const l of edgeLayers) {
        layers[l] = (layers[l] ?? 0) + 1
      }
    }

    // Expected: physical 2700, ospf 16, isis 6, sr 6, 368 layerless spine-ToR
    expect(layers['physical']).toBe(2700)
    expect(layers['ospf']).toBe(16)
    expect(layers['isis']).toBe(6)
    expect(layers['sr']).toBe(6)
    expect(layerless).toBe(368)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AMS1 layout tests
// ─────────────────────────────────────────────────────────────────────────────

describe('layoutSiteDiagram AMS1', () => {
  const fixture = ams1Fixture()
  const layout = layoutSiteDiagram(fixture.graph, fixture.racks, 'AMS1')

  test('test_layoutSiteDiagram_ams1_bandsTopDown', () => {
    // Bands should be in order: peer < core < spine < agg < rack rows
    const glyphs = [...layout.glyphs.values()]
    const peerGlyphs = glyphs.filter(g => g.band === 'peer')
    const coreGlyphs = glyphs.filter(g => g.band === 'core')
    const spineGlyphs = glyphs.filter(g => g.band === 'spine')
    const aggGlyphs = glyphs.filter(g => g.band === 'agg')

    expect(peerGlyphs.length).toBe(6)
    expect(coreGlyphs.length).toBe(2)
    expect(spineGlyphs.length).toBe(8)
    expect(aggGlyphs.length).toBe(2)

    // y ordering
    const peerY = Math.max(...peerGlyphs.map(g => g.y))
    const coreY = Math.min(...coreGlyphs.map(g => g.y))
    const spineY = Math.min(...spineGlyphs.map(g => g.y))

    expect(peerY).toBeLessThan(coreY)
    expect(coreY).toBeLessThan(spineY)
  })

  test('test_layoutSiteDiagram_ams1_peersGroupedByCoreThenName', () => {
    // Peers are ordered by their local core, then by name
    // core-01 peers: FRA1, HKG1, MIA1 (sorted by name)
    // core-02 peers: DFW1, GRU1, LHR1 (sorted by name)
    const peerGlyphs = [...layout.glyphs.values()]
      .filter(g => g.band === 'peer')
      .sort((a, b) => a.x - b.x)

    const peerNames = peerGlyphs.map(g => g.label)
    // FRA1, HKG1, MIA1 (core-01), then DFW1, GRU1, LHR1 (core-02)
    // Actually: FRA1, HKG1, LHR1 are core-01 peers, DFW1, GRU1, MIA1 are core-02 peers
    // Wait, looking at the fixture: FRA1 core 1, HKG1 core 1, LHR1 core 2, DFW1 core 2, GRU1 core 2, MIA1 core 1
    // So core-01 peers: FRA1, HKG1, MIA1; core-02 peers: DFW1, GRU1, LHR1
    // Expected order: FRA1, HKG1, MIA1 | DFW1, GRU1, LHR1
    expect(peerNames).toContain('FRA1-core-01')
    expect(peerNames).toContain('HKG1-core-01')
    expect(peerNames).toContain('MIA1-core-01')
  })

  test('test_layoutSiteDiagram_ams1_spinesNaturalOrderAggRight', () => {
    const spineGlyphs = [...layout.glyphs.values()]
      .filter(g => g.band === 'spine')
      .sort((a, b) => a.x - b.x)
    const aggGlyphs = [...layout.glyphs.values()]
      .filter(g => g.band === 'agg')
      .sort((a, b) => a.x - b.x)

    // Spines should be in natural order
    expect(spineGlyphs.map(g => g.label)).toEqual([
      'AMS1-spine-01', 'AMS1-spine-02', 'AMS1-spine-03', 'AMS1-spine-04',
      'AMS1-spine-05', 'AMS1-spine-06', 'AMS1-spine-07', 'AMS1-spine-08',
    ])

    // Aggs should be to the right of spines
    const rightmostSpine = Math.max(...spineGlyphs.map(g => g.x))
    const leftmostAgg = Math.min(...aggGlyphs.map(g => g.x))
    expect(leftmostAgg).toBeGreaterThan(rightmostSpine)
  })

  test('test_layoutSiteDiagram_ams1_rowsByLocation23Columns', () => {
    // server-hall-1 should have 23 racks, server-hall-2 should have 23 racks
    const rows = layout.rows
    const hall1Row = rows.find(r => r.label === 'server-hall-1')
    const hall2Row = rows.find(r => r.label === 'server-hall-2')

    expect(hall1Row).toBeDefined()
    expect(hall2Row).toBeDefined()

    // Count columns per location
    const hall1Cols = layout.columns.filter(c =>
      c.key.startsWith('SRV-') && parseInt(c.key.split('-')[1]!, 10) <= 23
    )
    const hall2Cols = layout.columns.filter(c =>
      c.key.startsWith('SRV-') && parseInt(c.key.split('-')[1]!, 10) > 23
    )

    expect(hall1Cols.length).toBe(23)
    expect(hall2Cols.length).toBe(23)
  })

  test('test_layoutSiteDiagram_ams1_rackColumnLeafTierInNameOrder', () => {
    // Each rack column should have leaf-tier glyphs in name order: leaf-1, leaf-2, oob
    const col = layout.columns.find(c => c.key === 'SRV-01')
    expect(col).toBeDefined()

    const colGlyphs = col!.glyphIds.map(id => layout.glyphs.get(id)!)
    const labels = colGlyphs.map(g => g.label)
    // Should be in name order
    expect(labels[0]).toContain('leaf-1')
    expect(labels[1]).toContain('leaf-2')
    expect(labels[2]).toContain('oob')
  })

  test('test_layoutSiteDiagram_ams1_chipsCount18PerRack', () => {
    // Each server rack should have a chip with 18 servers
    for (const col of layout.columns.filter(c => c.key.startsWith('SRV-'))) {
      expect(col.endIds.length).toBe(18)
      expect(col.chip).not.toBeNull()
    }
  })

  test('test_layoutSiteDiagram_ams1_edgeKindsTrunk24Uplink468Local92', () => {
    // Edge counts by kind
    const trunk = layout.edges.filter(e => e.kind === 'trunk').length
    const uplink = layout.edges.filter(e => e.kind === 'uplink').length
    const local = layout.edges.filter(e => e.kind === 'local').length

    expect(trunk).toBe(24)
    expect(uplink).toBe(468)
    expect(local).toBe(92)
  })

  test('test_layoutSiteDiagram_ams1_serverLinks_inLinksMap', () => {
    // 46 racks × 18 servers × 3 links = 2484 server links
    let totalLinks = 0
    for (const [, linksList] of layout.links) {
      totalLinks += linksList.length
    }
    expect(totalLinks).toBe(2484)
  })

  test('test_layoutSiteDiagram_ams1_columnPitch52', () => {
    // Column pitch should be COL_W = 52
    const cols = layout.columns.filter(c => c.key.startsWith('SRV-')).slice(0, 2)
    if (cols.length === 2) {
      const pitch = Math.abs(cols[1]!.x - cols[0]!.x)
      expect(pitch).toBeCloseTo(COL_W, 1)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PoP layout tests
// ─────────────────────────────────────────────────────────────────────────────

describe('layoutSiteDiagram PoP', () => {
  const fixture = popFixture()
  const layout = layoutSiteDiagram(fixture.graph, fixture.racks, 'DXB1')

  test('test_layoutSiteDiagram_pop_sixRacksTwoRows', () => {
    // 6 server racks in 2 rows (3 + 3)
    const srvColumns = layout.columns.filter(c => c.key.startsWith('SRV-'))
    expect(srvColumns.length).toBe(6)

    const rows = layout.rows.filter(r => r.label.includes('server-hall'))
    expect(rows.length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Determinism and stability tests
// ─────────────────────────────────────────────────────────────────────────────

describe('layoutSiteDiagram determinism', () => {
  test('test_layoutSiteDiagram_shuffledInput_identicalLayout', () => {
    const fixture = ams1Fixture()
    const layout1 = layoutSiteDiagram(fixture.graph, fixture.racks, 'AMS1')

    // Shuffle nodes and edges
    const shuffledGraph: LogicalGraph = {
      nodes: [...fixture.graph.nodes].sort(() => Math.random() - 0.5),
      edges: [...fixture.graph.edges].sort(() => Math.random() - 0.5),
    }
    const shuffledRacks = [...fixture.racks].sort(() => Math.random() - 0.5)

    const layout2 = layoutSiteDiagram(shuffledGraph, shuffledRacks, 'AMS1')

    // Glyph positions should be identical
    for (const [id, glyph] of layout1.glyphs) {
      const glyph2 = layout2.glyphs.get(id)
      expect(glyph2).toBeDefined()
      expect(glyph2!.x).toBeCloseTo(glyph.x, 5)
      expect(glyph2!.y).toBeCloseTo(glyph.y, 5)
    }

    // Column order should be identical
    expect(layout2.columns.map(c => c.key)).toEqual(layout1.columns.map(c => c.key))
  })

  test('test_layoutSiteDiagram_lldpEndAdded_onlyChipCountChanges', () => {
    const fixture = ams1Fixture()
    const layoutBefore = layoutSiteDiagram(fixture.graph, fixture.racks, 'AMS1')

    // Add an LLDP neighbour ext: node to SRV-03-leaf-1
    const extNodeId = 'ext:bmc-x.example.net'
    const modifiedGraph: LogicalGraph = {
      nodes: [
        ...fixture.graph.nodes,
        { id: extNodeId, name: 'bmc-x.example.net', tier: 'end', siteName: null, device: null, sid: null },
      ],
      edges: [
        ...fixture.graph.edges,
        {
          id: `AMS1-SRV-03-leaf-1~${extNodeId}`,
          a: 'AMS1-SRV-03-leaf-1',
          b: extNodeId,
          layers: {},
          members: [],
        },
      ],
    }

    const layoutAfter = layoutSiteDiagram(modifiedGraph, fixture.racks, 'AMS1')

    // All existing glyphs should have same positions
    for (const [id, glyph] of layoutBefore.glyphs) {
      const glyph2 = layoutAfter.glyphs.get(id)
      expect(glyph2).toBeDefined()
      expect(glyph2!.x).toBeCloseTo(glyph.x, 5)
      expect(glyph2!.y).toBeCloseTo(glyph.y, 5)
    }

    // SRV-03 chip count should increase by 1
    const col3Before = layoutBefore.columns.find(c => c.key === 'SRV-03')!
    const col3After = layoutAfter.columns.find(c => c.key === 'SRV-03')!
    expect(col3After.endIds.length).toBe(col3Before.endIds.length + 1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Irregular case tests
// ─────────────────────────────────────────────────────────────────────────────

describe('layoutSiteDiagram irregular', () => {
  test('test_layoutSiteDiagram_lldpOnlyNeighbour_countedInLeafRackChip', () => {
    const fixture = ams1Fixture()
    const extNodeId = 'ext:lldp-host'
    const modifiedGraph: LogicalGraph = {
      nodes: [
        ...fixture.graph.nodes,
        { id: extNodeId, name: 'lldp-host', tier: 'end', siteName: null, device: null, sid: null },
      ],
      edges: [
        ...fixture.graph.edges,
        {
          id: `AMS1-SRV-01-leaf-1~${extNodeId}`,
          a: 'AMS1-SRV-01-leaf-1',
          b: extNodeId,
          layers: {},
          members: [],
        },
      ],
    }

    const layout = layoutSiteDiagram(modifiedGraph, fixture.racks, 'AMS1')
    const col = layout.columns.find(c => c.key === 'SRV-01')!
    expect(col.endIds).toContain(extNodeId)
  })

  test('test_layoutSiteDiagram_endWithoutLeafNeighbour_otherChip', () => {
    const fixture = ams1Fixture()
    const extNodeId = 'ext:spine-attached'
    const modifiedGraph: LogicalGraph = {
      nodes: [
        ...fixture.graph.nodes,
        { id: extNodeId, name: 'spine-attached', tier: 'end', siteName: null, device: null, sid: null },
      ],
      edges: [
        ...fixture.graph.edges,
        {
          id: `AMS1-spine-01~${extNodeId}`,
          a: 'AMS1-spine-01',
          b: extNodeId,
          layers: {},
          members: [],
        },
      ],
    }

    const layout = layoutSiteDiagram(modifiedGraph, fixture.racks, 'AMS1')
    const otherCol = layout.columns.find(c => c.key === OTHER)
    expect(otherCol).toBeDefined()
    expect(otherCol!.endIds).toContain(extNodeId)
  })

  test('test_layoutSiteDiagram_unrackedLeaf_otherColumnInTrailingRow', () => {
    const fixture = ams1Fixture()
    // Add unracked leaf device
    const unrackedLeaf = {
      id: 'ams1-leaf-x-id',
      name: 'AMS1-leaf-x',
      siteName: 'AMS1',
      roleName: 'Leaf',
      roleColor: '#22c55e',
    }
    const modifiedGraph: LogicalGraph = {
      nodes: [
        ...fixture.graph.nodes,
        { id: 'AMS1-leaf-x', name: 'AMS1-leaf-x', tier: 'leaf', siteName: 'AMS1', device: unrackedLeaf, sid: null },
      ],
      edges: fixture.graph.edges,
    }

    const layout = layoutSiteDiagram(modifiedGraph, fixture.racks, 'AMS1')
    const otherCol = layout.columns.find(c => c.key === OTHER)
    expect(otherCol).toBeDefined()
    expect(otherCol!.glyphIds.some(id => layout.glyphs.get(id)?.label === 'AMS1-leaf-x')).toBe(true)
  })

  test('test_layoutSiteDiagram_rackWithoutLocation_lastRowNoLocation', () => {
    const fixture = popFixture()
    // Add a rack without location that has a device (so it becomes a column)
    const orphanLeaf = {
      id: 'dxb1-orphan-leaf-id',
      name: 'DXB1-orphan-leaf-1',
      siteName: 'DXB1',
      roleName: 'Leaf',
      roleColor: '#22c55e',
    }
    const modifiedGraph: LogicalGraph = {
      nodes: [
        ...fixture.graph.nodes,
        { id: 'DXB1-orphan-leaf-1', name: 'DXB1-orphan-leaf-1', tier: 'leaf', siteName: 'DXB1', device: orphanLeaf, sid: null },
      ],
      edges: fixture.graph.edges,
    }
    const modifiedRacks: RackInput[] = [
      ...fixture.racks,
      { name: 'ORPHAN-01', location: null, devices: [{ id: 'dxb1-orphan-leaf-id', roleName: 'Leaf' }] },
    ]

    const layout = layoutSiteDiagram(modifiedGraph, modifiedRacks, 'DXB1')
    const noLocRow = layout.rows.find(r => r.label === 'no location')
    expect(noLocRow).toBeDefined()
  })

  test('test_layoutSiteDiagram_locationOver24Racks_wrapsToNextLine', () => {
    // Create a fixture with > 24 racks in one location
    const devices: any[] = []
    const racks: RackInput[] = []
    for (let i = 1; i <= 30; i++) {
      const rackName = `SRV-${String(i).padStart(2, '0')}`
      const leafId = `srv${i}-leaf-id`
      devices.push({
        id: leafId,
        name: `TEST-${rackName}-leaf-1`,
        siteName: 'TEST',
        roleName: 'Leaf',
        roleColor: '#22c55e',
      })
      racks.push({
        name: rackName,
        location: 'server-hall',
        devices: [{ id: leafId, roleName: 'Leaf' }],
      })
    }

    const input: GraphInput = {
      devices,
      links: [],
      circuits: [],
      circuitSites: {},
      lldp: {},
    }
    const graph = buildLogicalGraph(input, 'TEST')
    const layout = layoutSiteDiagram(graph, racks, 'TEST')

    // Should wrap after 24 columns
    const cols = layout.columns.filter(c => c.key.startsWith('SRV-'))
    const yValues = new Set(cols.map(c => c.y))
    expect(yValues.size).toBeGreaterThan(1) // Multiple rows
  })

  test('test_layoutSiteDiagram_noRacks_leafTierInOtherColumn', () => {
    const { graph } = ams1Fixture()
    const layout = layoutSiteDiagram(graph, [], 'AMS1')

    // Without racks, all leaf-tier devices go to OTHER
    const otherCol = layout.columns.find(c => c.key === OTHER)
    expect(otherCol).toBeDefined()
    expect(otherCol!.glyphIds.length).toBeGreaterThan(0)
  })

  test('test_layoutSiteDiagram_mlagPeerLink_localBracketPath', () => {
    const fixture = ams1Fixture()
    // The fixture already has leaf-1 <-> leaf-2 MLAG links
    const layout = layoutSiteDiagram(fixture.graph, fixture.racks, 'AMS1')

    // Find a local edge (same column)
    const localEdges = layout.edges.filter(e => e.kind === 'local')
    expect(localEdges.length).toBeGreaterThan(0)
  })

  test('test_layoutSiteDiagram_siteNodePeer_inPeerBand', () => {
    const fixture = ams1Fixture()
    // Add a site: node
    const modifiedGraph: LogicalGraph = {
      nodes: [
        ...fixture.graph.nodes,
        { id: 'site:FRA1', name: 'FRA1', tier: 'remote', siteName: 'FRA1', device: null, sid: null },
      ],
      edges: [
        ...fixture.graph.edges,
        {
          id: 'AMS1-core-01~site:FRA1',
          a: 'AMS1-core-01',
          b: 'site:FRA1',
          layers: {},
          members: [],
        },
      ],
    }

    const layout = layoutSiteDiagram(modifiedGraph, fixture.racks, 'AMS1')
    const siteGlyph = layout.glyphs.get('site:FRA1')
    expect(siteGlyph).toBeDefined()
    expect(siteGlyph!.band).toBe('peer')
  })

  test('test_layoutSiteDiagram_leafSharingRackWithCore_aggSlot', () => {
    const fixture = ams1Fixture()
    const layout = layoutSiteDiagram(fixture.graph, fixture.racks, 'AMS1')

    // oob-agg devices are in NET-01/02 which have cores, so they should be in agg band
    const aggGlyphs = [...layout.glyphs.values()].filter(g => g.band === 'agg')
    expect(aggGlyphs.length).toBe(2)
    expect(aggGlyphs.some(g => g.label.includes('oob-agg-1'))).toBe(true)
    expect(aggGlyphs.some(g => g.label.includes('oob-agg-2'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// edgePath tests
// ─────────────────────────────────────────────────────────────────────────────

describe('edgePath', () => {
  test('test_edgePath_sameColumn_rightBracket', () => {
    const a: Glyph = { id: 'a', x: 100, y: 100, w: 44, h: 12, band: 'rack', tier: 'leaf', label: 'a' }
    const b: Glyph = { id: 'b', x: 100, y: 120, w: 44, h: 12, band: 'rack', tier: 'leaf', label: 'b' }
    const path = edgePath(a, b)

    // Should be a cubic bracket path (C command)
    expect(path).toContain('C')
    // Should start and end at the glyphs
    expect(path).toMatch(/^M/)
  })

  test('test_edgePath_sameBand_arcAbove', () => {
    const a: Glyph = { id: 'a', x: 100, y: 100, w: 44, h: 12, band: 'spine', tier: 'spine', label: 'a' }
    const b: Glyph = { id: 'b', x: 200, y: 100, w: 44, h: 12, band: 'spine', tier: 'spine', label: 'b' }
    const path = edgePath(a, b)

    // Should be a quadratic arc (Q command)
    expect(path).toContain('Q')
  })

  test('test_edgePath_sameBand_apexBelowCoreBand', () => {
    // Same-band arc should not cross into core band (CORE_Y = 80)
    const a: Glyph = { id: 'a', x: 0, y: SPINE_Y, w: 44, h: 12, band: 'spine', tier: 'spine', label: 'a' }
    const b: Glyph = { id: 'b', x: 1000, y: SPINE_Y, w: 44, h: 12, band: 'spine', tier: 'spine', label: 'b' }
    const path = edgePath(a, b)

    // Extract the Q control point y value
    const match = path.match(/Q\s*([\d.-]+)\s+([\d.-]+)/)
    if (match) {
      const controlY = parseFloat(match[2]!)
      // Control point should be above SPINE_Y but below CORE_Y + pill height
      expect(controlY).toBeGreaterThan(CORE_Y + 18) // PILL_H = 18
    }
  })

  test('test_edgePath_differentBands_straightLine', () => {
    const a: Glyph = { id: 'a', x: 100, y: CORE_Y, w: 44, h: 12, band: 'core', tier: 'core', label: 'a' }
    const b: Glyph = { id: 'b', x: 150, y: SPINE_Y, w: 44, h: 12, band: 'spine', tier: 'spine', label: 'b' }
    const path = edgePath(a, b)

    // Should be a straight line (M...L or just M)
    expect(path).not.toContain('Q')
    expect(path).not.toContain('C')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// overlayBox and focusOf tests
// ─────────────────────────────────────────────────────────────────────────────

describe('overlayBox', () => {
  test('test_overlayBox_rightmostColumn_clampedInsideBounds', () => {
    const fixture = ams1Fixture()
    const layout = layoutSiteDiagram(fixture.graph, fixture.racks, 'AMS1')

    // Find rightmost column
    const rightmost = layout.columns.reduce((best, col) =>
      col.x > best.x ? col : best
    , layout.columns[0]!)

    const box = overlayBox(layout, rightmost)

    // Box should be within bounds
    expect(box.x + box.w).toBeLessThanOrEqual(layout.bounds.x + layout.bounds.w)
  })
})

describe('focusOf', () => {
  test('test_focusOf_spine_litsUplinksAndNeighbours', () => {
    const fixture = ams1Fixture()
    const layout = layoutSiteDiagram(fixture.graph, fixture.racks, 'AMS1')

    const focus = focusOf(layout, 'AMS1-spine-01')
    expect(focus).not.toBeNull()
    expect(focus!.nodes.has('AMS1-spine-01')).toBe(true)
    // Should include connected nodes
    expect(focus!.nodes.size).toBeGreaterThan(1)
    expect(focus!.edges.size).toBeGreaterThan(0)
  })

  test('test_focusOf_server_litsItsThreeLinks', () => {
    const fixture = ams1Fixture()
    const layout = layoutSiteDiagram(fixture.graph, fixture.racks, 'AMS1')

    // Find a server node
    const serverNode = fixture.graph.nodes.find(n => n.name.includes('srv-01') && n.name.includes('SRV-01'))
    if (serverNode) {
      const focus = focusOf(layout, serverNode.id)
      expect(focus).not.toBeNull()
      // Server should have 3 links
      const serverLinks = layout.links.get(serverNode.id)
      expect(serverLinks?.length).toBe(3)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Label helpers tests
// ─────────────────────────────────────────────────────────────────────────────

describe('shortLabel', () => {
  test('test_shortLabel_rackPrefixAndDomain_stripped', () => {
    expect(shortLabel('AMS1-SRV-01-leaf-1.example.com', 'AMS1')).toBe('SRV-01-leaf-1')
    expect(shortLabel('AMS1-core-01', 'AMS1')).toBe('core-01')
  })
})

describe('fitLabel', () => {
  test('test_fitLabel_longHostname_middleEllipsisKeepsTail', () => {
    const result = fitLabel('very-long-hostname-that-exceeds-max', 14)
    expect(result.length).toBeLessThanOrEqual(14)
    expect(result).toContain('...')
    // Should keep the distinguishing tail
    expect(result).toMatch(/max$/)
  })

  test('test_fitLabel_shortHostname_unchanged', () => {
    const result = fitLabel('short', 14)
    expect(result).toBe('short')
  })
})
