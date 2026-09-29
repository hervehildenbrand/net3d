import { describe, expect, test } from 'vitest'
import { buildLogicalGraph, type CircuitGroup, type LogicalEdge, type LogicalGraph, type LogicalLayer, type LogicalNode } from '@net3d/shared'
import type { Site } from '../hooks/useSites'
import { graphInput } from '../lib/logicalView'
import { circuitLines, logicalLines, type ArcLine, type LatLng } from './arcLines'
import { nodeAnchors, sitePills } from './sitePills'
import { FIXTURE_DEVICES, FIXTURE_TOPOLOGY, FIXTURE_CIRCUIT_GROUPS } from './backboneFixture'

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const site = (name: string, latitude: number | null, longitude: number | null): Site =>
  ({ name, latitude, longitude } as Site)

const SITES: Site[] = [
  site('AMS1', 52.37, 4.89),
  site('FRA1', 50.11, 8.68),
  site('PAR1', 48.86, 2.35),
  site('MEL1', -37.8136, 144.9631),
  site('MIA1', 25.7617, -80.1918),
  site('NULL_SITE', null, null),
]

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
// circuitLines tests
// ─────────────────────────────────────────────────────────────────────────────

describe('circuitLines', () => {
  test('test_circuitLines_geocodedPair_oneArcKeyedBySitePairWith49Points', () => {
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'C1', commitRate: 100_000_000 }])]
    const lines = circuitLines(SITES, groups)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.key).toBe('AMS1|FRA1')
    // greatCircleLatLngs with 48 segments produces 49 points
    expect(lines[0]!.positions).toHaveLength(49)
  })

  test('test_circuitLines_siteWithoutCoordinates_skipped', () => {
    const groups = [circuitGroup('AMS1', 'NULL_SITE', [{ id: '1', cid: 'C1', commitRate: null }])]
    const lines = circuitLines(SITES, groups)
    expect(lines).toHaveLength(0)
  })

  test('test_circuitLines_commitRateKbps_setsWeightAndOpacity', () => {
    // 400G = 400_000_000 kbps
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'C1', commitRate: 400_000_000 }])]
    const lines = circuitLines(SITES, groups)
    expect(lines[0]!.weight).toBeGreaterThan(2) // 400G gets higher weight
    expect(lines[0]!.opacity).toBeCloseTo(0.9, 1) // 400G opacity
  })

  test('test_circuitLines_physical_onePiecePerHalfNotDashedNotStaleNoRows', () => {
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'C1', commitRate: 100_000_000 }])]
    const lines = circuitLines(SITES, groups)
    expect(lines[0]!.dashed).toBe(false)
    expect(lines[0]!.stale).toBe(false)
    expect(lines[0]!.rows).toEqual([])
    // paths has whole, a, and z (each as array of pieces)
    expect(lines[0]!.paths.whole).toHaveLength(1) // One piece (no antimeridian crossing)
    expect(lines[0]!.paths.a).toHaveLength(1)
    expect(lines[0]!.paths.z).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// logicalLines fixtures
// ─────────────────────────────────────────────────────────────────────────────

const mkNode = (id: string, site: string, sid: number | null = null, tier: LogicalNode['tier'] = 'remote'): LogicalNode => ({
  id,
  name: id,
  tier,
  siteName: site,
  device: tier === 'remote' ? { id: `dev-${id}`, name: id, siteName: site, roleName: 'router', roleColor: '#ccc' } : null,
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

// ─────────────────────────────────────────────────────────────────────────────
// logicalLines tests
// ─────────────────────────────────────────────────────────────────────────────

describe('logicalLines', () => {
  const tierOf = (nodes: LogicalNode[]) => new Map(nodes.map((n) => [n.id, n.tier]))

  test('test_logicalLines_routerEdge_endsAtBothSegmentAnchors', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1', 16001), mkNode('FRA1-core-01', 'FRA1', 16002)]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', { physical: { up: 1, total: 1, label: '' } }, [
      { id: 'ARELION-AMS1-FRA1-025', a: { deviceName: 'AMS1-core-01', name: 'et-0/0/0' }, b: { deviceName: 'FRA1-core-01', name: 'et-0/0/0' } },
    ])
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '101', cid: 'ARELION-AMS1-FRA1-025', commitRate: 100_000_000 }])]
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    const lines = logicalLines(graph, anchors, SITES, groups, new Set())
    expect(lines).toHaveLength(1)
    // Endpoints match anchors (using toBeCloseTo for floating point)
    expect(lines[0]!.positions[0]![0]).toBeCloseTo(52.37, 9)
    expect(lines[0]!.positions[0]![1]).toBeCloseTo(4.89, 9)
    expect(lines[0]!.positions.at(-1)![0]).toBeCloseTo(50.11, 9)
    expect(lines[0]!.positions.at(-1)![1]).toBeCloseTo(8.68, 9)
  })

  test('test_logicalLines_routerEdge_widthFromCidCommitRateNotCircuitIds', () => {
    // Edge member uses cid, circuit group id differs
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', { physical: { up: 1, total: 1, label: '' } }, [
      { id: 'PROVIDER-AMS1-FRA1-001', a: { deviceName: 'AMS1-core-01', name: 'et-0/0/0' }, b: { deviceName: 'FRA1-core-01', name: 'et-0/0/0' } },
    ])
    const graph: LogicalGraph = { nodes, edges: [edge] }
    // CircuitGroup.circuitIds holds numeric id '999', but cid is 'PROVIDER-AMS1-FRA1-001'
    const groups: CircuitGroup[] = [{
      siteA: 'AMS1',
      siteZ: 'FRA1',
      count: 1,
      circuitIds: ['999'], // Numeric NetBox id
      circuits: [{ id: '999', cid: 'PROVIDER-AMS1-FRA1-001', provider: 'test', siteA: 'AMS1', siteZ: 'FRA1', commitRate: 400_000_000, status: 'active', description: null }],
      maxCommitRate: 400_000_000,
    }]
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    const lines = logicalLines(graph, anchors, SITES, groups, new Set())
    // Width should be set by the 400G commit rate
    expect(lines[0]!.weight).toBeGreaterThan(2)
    expect(lines[0]!.opacity).toBeCloseTo(0.9, 1)
  })

  test('test_logicalLines_routerEdge_siteNamesAndCidsForDirLive', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', { physical: { up: 1, total: 1, label: '' } }, [
      { id: 'CID-001', a: { deviceName: 'AMS1-core-01', name: 'et-0/0/0' }, b: { deviceName: 'FRA1-core-01', name: 'et-0/0/0' } },
    ])
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'CID-001', commitRate: 100_000_000 }])]
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    const lines = logicalLines(graph, anchors, SITES, groups, new Set())
    expect(lines[0]!.siteA).toBe('AMS1')
    expect(lines[0]!.siteZ).toBe('FRA1')
    expect(lines[0]!.cids).toContain('CID-001')
  })

  test('test_logicalLines_isisAdjacencyDown_dashed', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
      physical: { up: 1, total: 1, label: '' },
      isis: { up: 0, total: 1, label: 'L2 DOWN' },
    })
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    const lines = logicalLines(graph, anchors, SITES, [], new Set())
    expect(lines[0]!.dashed).toBe(true)
  })

  test('test_logicalLines_downLayerHidden_notDashed', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
      physical: { up: 1, total: 1, label: '' },
      isis: { up: 0, total: 1, label: 'L2 DOWN' },
    })
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    // ISIS is hidden
    const lines = logicalLines(graph, anchors, SITES, [], new Set(['isis']))
    expect(lines[0]!.dashed).toBe(false)
  })

  test('test_logicalLines_staleAdjacencyLabel_dashedWithStaleRow', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
      physical: { up: 1, total: 1, label: '' },
      isis: { up: 1, total: 2, label: 'L2 stale' },
    })
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    const lines = logicalLines(graph, anchors, SITES, [], new Set())
    // stale label means dashed (up < total)
    expect(lines[0]!.dashed).toBe(true)
    // The row should include 'stale'
    expect(lines[0]!.rows.join(' ')).toContain('stale')
  })

  test('test_logicalLines_allLayersHidden_edgeOmittedAndNoSiteArc', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', { physical: { up: 1, total: 1, label: '' } })
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'C1', commitRate: 100_000_000 }])]
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    // All layers hidden
    const lines = logicalLines(graph, anchors, SITES, groups, new Set<LogicalLayer | 'end'>(['physical', 'isis', 'sr', 'ospf']))
    expect(lines).toHaveLength(0)
  })

  test('test_logicalLines_tooltipRows_visibleLayersUpTotalAndLabel', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
      physical: { up: 1, total: 1, label: '' },
      isis: { up: 2, total: 2, label: 'L2 UP' },
      sr: { up: 1, total: 1, label: 'adj-SID 24001/24002' },
    })
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    const lines = logicalLines(graph, anchors, SITES, [], new Set())
    expect(lines[0]!.rows).toContain('Physical 1/1')
    expect(lines[0]!.rows).toContain('IS-IS 2/2 · L2 UP')
    expect(lines[0]!.rows).toContain('SR 1/1 · adj-SID 24001/24002')
  })

  test('test_logicalLines_emptyGraph_everyGroupAsSiteArcWithCids', () => {
    const graph: LogicalGraph = { nodes: [], edges: [] }
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'C1', commitRate: 100_000_000 }])]
    const anchors = new Map<string, LatLng>()
    const lines = logicalLines(graph, anchors, SITES, groups, new Set())
    // Falls back to site-centre arcs
    expect(lines).toHaveLength(1)
    expect(lines[0]!.key).toBe('AMS1|FRA1') // site-pair key
    expect(lines[0]!.cids).toContain('C1')
  })

  test('test_logicalLines_endpointWithoutNode_cidFallsBackToSiteArc', () => {
    // Edge references AMS1-core-99 which doesn't exist in the anchor map
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-99', 'FRA1-core-01', { physical: { up: 1, total: 1, label: '' } }, [
      { id: 'C1', a: { deviceName: 'AMS1-core-99', name: 'et-0/0/0' }, b: { deviceName: 'FRA1-core-01', name: 'et-0/0/0' } },
    ])
    const graph: LogicalGraph = { nodes: [...nodes, mkNode('AMS1-core-99', 'AMS1')], edges: [edge] }
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'C1', commitRate: 100_000_000 }])]
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
      // AMS1-core-99 missing from anchors
    ])
    const lines = logicalLines(graph, anchors, SITES, groups, new Set())
    // Should fall back to site arc since anchor is missing
    expect(lines.some((l) => l.key === 'AMS1|FRA1')).toBe(true)
  })

  test('test_logicalLines_routerToSiteNode_endsAtPeerSiteCentre', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), { id: 'site:MIA1', name: 'MIA1', tier: 'remote' as const, siteName: 'MIA1', device: null, sid: null }]
    const edge = mkEdge('AMS1-core-01', 'site:MIA1', { physical: { up: 1, total: 1, label: '' } }, [
      { id: 'C1', a: { deviceName: 'AMS1-core-01', name: 'et-0/0/0' }, b: null },
    ])
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['site:MIA1', [25.7617, -80.1918]],
    ])
    const lines = logicalLines(graph, anchors, SITES, [], new Set())
    expect(lines).toHaveLength(1)
    // Ends at site:MIA1 centre
    const lastPos = lines[0]!.positions.at(-1)!
    expect(lastPos[0]).toBeCloseTo(25.7617, 4)
    expect(lastPos[1]).toBeCloseTo(-80.1918, 4)
  })

  test('test_logicalLines_physicalHidden_noFallbackSiteArcs', () => {
    const graph: LogicalGraph = { nodes: [], edges: [] }
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'C1', commitRate: 100_000_000 }])]
    const anchors = new Map<string, LatLng>()
    // Physical hidden: no fallback site arcs
    const lines = logicalLines(graph, anchors, SITES, groups, new Set(['physical']))
    expect(lines).toHaveLength(0)
  })

  test('test_logicalLines_physicalHidden_routerArcHasNoCidsNoCircuitRows', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
      physical: { up: 1, total: 1, label: '' },
      isis: { up: 2, total: 2, label: 'L2 UP' },
    }, [
      { id: 'C1', a: { deviceName: 'AMS1-core-01', name: 'et-0/0/0' }, b: { deviceName: 'FRA1-core-01', name: 'et-0/0/0' } },
    ])
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const groups = [circuitGroup('AMS1', 'FRA1', [{ id: '1', cid: 'C1', commitRate: 400_000_000 }])]
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    // Physical hidden: router arc keeps drawing but has no cids or circuit rows
    const lines = logicalLines(graph, anchors, SITES, groups, new Set(['physical']))
    expect(lines).toHaveLength(1)
    expect(lines[0]!.cids).toEqual([])
    expect(lines[0]!.circuits).toEqual([])
    // No Physical row in tooltip
    expect(lines[0]!.rows.some((r) => r.startsWith('Physical'))).toBe(false)
    // Weight is arcWeight(null) - minimum
    expect(lines[0]!.weight).toBe(2)
  })

  test('test_logicalLines_mel1Mia1_splitIntoTwoPiecesTouchingAnchors', () => {
    const nodes = [mkNode('MEL1-core-01', 'MEL1'), mkNode('MIA1-core-01', 'MIA1')]
    const edge = mkEdge('MEL1-core-01', 'MIA1-core-01', { physical: { up: 1, total: 1, label: '' } })
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const anchors = new Map<string, LatLng>([
      ['MEL1-core-01', [-37.8136, 144.9631]],
      ['MIA1-core-01', [25.7617, -80.1918]],
    ])
    const lines = logicalLines(graph, anchors, SITES, [], new Set())
    expect(lines).toHaveLength(1)
    // Should be split (2 pieces in paths.whole)
    expect(lines[0]!.paths.whole.length).toBeGreaterThan(1)
    // First piece starts at MEL1 anchor
    expect(lines[0]!.paths.whole[0]![0]![0]).toBeCloseTo(-37.8136, 6)
    expect(lines[0]!.paths.whole[0]![0]![1]).toBeCloseTo(144.9631, 6)
    // Last piece ends at MIA1 anchor
    const lastPiece = lines[0]!.paths.whole.at(-1)!
    expect(lastPiece.at(-1)![0]).toBeCloseTo(25.7617, 6)
    expect(lastPiece.at(-1)![1]).toBeCloseTo(-80.1918, 6)
  })

  test('test_logicalLines_sameSiteEdge_skipped', () => {
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('AMS1-core-02', 'AMS1')]
    const edge = mkEdge('AMS1-core-01', 'AMS1-core-02', { physical: { up: 1, total: 1, label: '' } })
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['AMS1-core-02', [52.37, 4.89]],
    ])
    const lines = logicalLines(graph, anchors, SITES, [], new Set())
    expect(lines).toHaveLength(0)
  })

  test('test_logicalLines_parallelCircuitsOnDifferentRouters_oneLinePerRouterPairNoSiteArc', () => {
    // Two router pairs on the same site pair
    const nodes = [
      mkNode('AMS1-core-01', 'AMS1'),
      mkNode('AMS1-core-02', 'AMS1'),
      mkNode('FRA1-core-01', 'FRA1'),
      mkNode('FRA1-core-02', 'FRA1'),
    ]
    const edge1 = mkEdge('AMS1-core-01', 'FRA1-core-01', { physical: { up: 1, total: 1, label: '' } }, [
      { id: 'C1', a: { deviceName: 'AMS1-core-01', name: 'et-0/0/0' }, b: { deviceName: 'FRA1-core-01', name: 'et-0/0/0' } },
    ])
    const edge2 = mkEdge('AMS1-core-02', 'FRA1-core-02', { physical: { up: 1, total: 1, label: '' } }, [
      { id: 'C2', a: { deviceName: 'AMS1-core-02', name: 'et-0/0/0' }, b: { deviceName: 'FRA1-core-02', name: 'et-0/0/0' } },
    ])
    const graph: LogicalGraph = { nodes, edges: [edge1, edge2] }
    const groups = [
      circuitGroup('AMS1', 'FRA1', [
        { id: '1', cid: 'C1', commitRate: 100_000_000 },
        { id: '2', cid: 'C2', commitRate: 100_000_000 },
      ]),
    ]
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['AMS1-core-02', [52.38, 4.90]],
      ['FRA1-core-01', [50.11, 8.68]],
      ['FRA1-core-02', [50.12, 8.69]],
    ])
    const lines = logicalLines(graph, anchors, SITES, groups, new Set())
    // 2 router arcs
    expect(lines).toHaveLength(2)
    // Keys are router-pair ids (contain ~)
    expect(lines.every((l) => l.key.includes('~'))).toBe(true)
    // Distinct keys
    expect(new Set(lines.map((l) => l.key)).size).toBe(2)
    // No site-pair arc
    expect(lines.some((l) => l.key === 'AMS1|FRA1')).toBe(false)
  })

  test('test_logicalLines_igpOnlyMember_noCircuitRowsAndMinimumWidth', () => {
    // Edge with only an igp: member (no physical cable)
    const nodes = [mkNode('AMS1-core-01', 'AMS1'), mkNode('FRA1-core-01', 'FRA1')]
    const edge = mkEdge('AMS1-core-01', 'FRA1-core-01', {
      isis: { up: 2, total: 2, label: 'L2 UP' },
    }, [
      { id: 'igp:AMS1-core-01:et-0/0/9.0', a: { deviceName: 'AMS1-core-01', name: 'et-0/0/9.0' }, b: { deviceName: 'FRA1-core-01', name: 'et-0/0/9.0' } },
    ])
    const graph: LogicalGraph = { nodes, edges: [edge] }
    const groups: CircuitGroup[] = []
    const anchors = new Map<string, LatLng>([
      ['AMS1-core-01', [52.37, 4.89]],
      ['FRA1-core-01', [50.11, 8.68]],
    ])
    const lines = logicalLines(graph, anchors, SITES, groups, new Set())
    expect(lines).toHaveLength(1)
    // igp: member is not a circuit
    expect(lines[0]!.circuits).toEqual([])
    expect(lines[0]!.cids).toEqual([])
    // Minimum weight (arcWeight(null))
    expect(lines[0]!.weight).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Real pipeline test
// ─────────────────────────────────────────────────────────────────────────────

describe('real pipeline', () => {
  test('test_realPipeline_graphInputAndBuildLogicalGraph_feedsLogicalLines', () => {
    // Run the real pipeline: graphInput('map') + buildLogicalGraph
    // Use fixture data with id != cid
    const fixtureInput = graphInput('map', null, [], FIXTURE_CIRCUIT_GROUPS, FIXTURE_TOPOLOGY)
    const graph = buildLogicalGraph(
      {
        devices: FIXTURE_DEVICES,
        links: [],
        circuits: fixtureInput.circuits,
        circuitSites: fixtureInput.circuitSites,
        lldp: {},
        topology: FIXTURE_TOPOLOGY,
      },
      null, // backbone mode
    )

    // Graph should have 4 nodes (2 routers at AMS1, 2 at FRA1)
    expect(graph.nodes).toHaveLength(4)
    // Graph should have 2 edges (one per router pair)
    expect(graph.edges).toHaveLength(2)

    // Build anchors
    const fixturesSites: Site[] = [
      { name: 'AMS1', latitude: 52.37, longitude: 4.89 } as Site,
      { name: 'FRA1', latitude: 50.11, longitude: 8.68 } as Site,
    ]
    const pills = sitePills(graph, fixturesSites)
    const anchors = nodeAnchors(pills, fixturesSites, 4)

    // Feed into logicalLines
    const lines = logicalLines(graph, anchors, fixturesSites, FIXTURE_CIRCUIT_GROUPS, new Set())

    // Should get 2 router arcs
    expect(lines).toHaveLength(2)

    // Each line should have router-pair key (containing ~)
    expect(lines.every((l) => l.key.includes('~'))).toBe(true)

    // Lines should have correct cids (not numeric ids)
    const allCids = lines.flatMap((l) => l.cids)
    expect(allCids).toContain('ARELION-AMS1-FRA1-025')
    expect(allCids).toContain('COGENT-AMS1-FRA1-017')
    // Should NOT contain numeric ids
    expect(allCids).not.toContain('101')
    expect(allCids).not.toContain('102')

    // Lines should have tooltip rows with layer info
    for (const line of lines) {
      expect(line.rows.some((r) => r.includes('Physical'))).toBe(true)
      expect(line.rows.some((r) => r.includes('IS-IS'))).toBe(true)
      expect(line.rows.some((r) => r.includes('SR'))).toBe(true)
    }
  })
})
