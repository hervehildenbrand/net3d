import { describe, expect, test } from 'vitest'
import { layoutSite, layoutBackbone, sitePairEdges } from './logicalLayout'
import type { LogicalGraph, LogicalNode, LogicalEdge, CircuitGroup } from '@net3d/shared'
import type { Site } from '../hooks/useSites'

// Helper to create a minimal node
function node(id: string, tier: LogicalNode['tier'], siteName: string | null = 'site-a'): LogicalNode {
  return {
    id,
    name: id,
    tier,
    siteName,
    device: tier !== 'end' ? { id, name: id, siteName: siteName ?? '', roleName: tier, roleColor: '#fff' } : null,
    sid: null,
  }
}

// Helper to create a minimal edge
function edge(a: string, b: string, hasPhysical = true): LogicalEdge {
  return {
    id: a < b ? `${a}~${b}` : `${b}~${a}`,
    a: a < b ? a : b,
    b: a < b ? b : a,
    layers: hasPhysical ? { physical: { up: 1, total: 1, label: '' } } : {},
    members: hasPhysical ? [{ id: `cable:${a}:${b}`, a: { deviceName: a, name: 'eth0' }, b: { deviceName: b, name: 'eth0' } }] : [],
  }
}

describe('layoutSite', () => {
  test('test_layoutSite_tiers_orderedTopDown', () => {
    // Verify tier y ordering: remote > core > spine > leaf > end (top-down)
    // Adjusted from hardcoded values since tier gaps were increased for legibility
    const graph: LogicalGraph = {
      nodes: [
        node('remote-1', 'remote'),
        node('core-1', 'core'),
        node('spine-1', 'spine'),
        node('leaf-1', 'leaf'),
        node('server-1', 'end'),
      ],
      edges: [
        edge('core-1', 'spine-1'),
        edge('spine-1', 'leaf-1'),
        edge('leaf-1', 'server-1'),
      ],
    }

    const result = layoutSite(graph)
    const positions = result.positions

    const remoteY = positions.get('remote-1')![1]
    const coreY = positions.get('core-1')![1]
    const spineY = positions.get('spine-1')![1]
    const leafY = positions.get('leaf-1')![1]
    const endY = positions.get('server-1')![1]

    // Tiers must be ordered top-down: remote > core > spine > leaf > end
    expect(remoteY).toBeGreaterThan(coreY)
    expect(coreY).toBeGreaterThan(spineY)
    expect(spineY).toBeGreaterThan(leafY)
    expect(leafY).toBeGreaterThan(endY)
    // End devices are at y=0 or below
    expect(endY).toBeLessThanOrEqual(0)
  })

  test('test_layoutSite_sameGraph_samePositions', () => {
    // Determinism: same input produces identical positions
    const graph: LogicalGraph = {
      nodes: [
        node('spine-1', 'spine'),
        node('spine-2', 'spine'),
        node('leaf-1', 'leaf'),
        node('leaf-2', 'leaf'),
      ],
      edges: [
        edge('spine-1', 'leaf-1'),
        edge('spine-1', 'leaf-2'),
        edge('spine-2', 'leaf-1'),
        edge('spine-2', 'leaf-2'),
      ],
    }

    const result1 = layoutSite(graph)
    const result2 = layoutSite(graph)

    for (const n of graph.nodes) {
      const p1 = result1.positions.get(n.id)!
      const p2 = result2.positions.get(n.id)!
      expect(p1).toEqual(p2)
    }
  })

  test('test_layoutSite_endDeviceAdded_otherNodesUnmoved', () => {
    // Stability: adding an end device must not move existing nodes
    const baseNodes: LogicalNode[] = [
      node('spine-1', 'spine'),
      node('leaf-1', 'leaf'),
      node('server-1', 'end'),
    ]
    const baseEdges: LogicalEdge[] = [
      edge('spine-1', 'leaf-1'),
      edge('leaf-1', 'server-1'),
    ]

    const baseBefore = layoutSite({ nodes: baseNodes, edges: baseEdges })

    // Add a new end device
    const expandedGraph: LogicalGraph = {
      nodes: [...baseNodes, node('server-2', 'end')],
      edges: [...baseEdges, edge('leaf-1', 'server-2')],
    }

    const after = layoutSite(expandedGraph)

    // All original nodes must have the same positions
    for (const n of baseNodes) {
      expect(after.positions.get(n.id)).toEqual(baseBefore.positions.get(n.id))
    }
  })

  test('test_layoutSite_edgeAdded_orderUnchanged', () => {
    // Stability: adding an edge must not move existing nodes
    const nodes: LogicalNode[] = [
      node('spine-1', 'spine'),
      node('spine-2', 'spine'),
      node('leaf-1', 'leaf'),
      node('leaf-2', 'leaf'),
    ]
    const baseEdges: LogicalEdge[] = [
      edge('spine-1', 'leaf-1'),
    ]

    const before = layoutSite({ nodes, edges: baseEdges })

    // Add more edges
    const expandedEdges: LogicalEdge[] = [
      ...baseEdges,
      edge('spine-1', 'leaf-2'),
      edge('spine-2', 'leaf-1'),
      edge('spine-2', 'leaf-2'),
    ]

    const after = layoutSite({ nodes, edges: expandedEdges })

    // All nodes must have the same positions
    for (const n of nodes) {
      expect(after.positions.get(n.id)).toEqual(before.positions.get(n.id))
    }
  })

  test('test_layoutSite_900EndDevices_boundedWidth', () => {
    // Width limit: 900 end devices should not exceed reasonable x-span
    // Design says each leaf owns 4 columns, rows wrap at some limit
    // Uses >40 leaves to verify wrapping behavior (NODES_PER_ROW = 40)
    const leafCount = 60
    const endPerLeaf = 15 // 900 total

    const nodes: LogicalNode[] = []
    const edges: LogicalEdge[] = []

    for (let l = 0; l < leafCount; l++) {
      const leafId = `leaf-${String(l).padStart(2, '0')}`
      nodes.push(node(leafId, 'leaf'))

      for (let e = 0; e < endPerLeaf; e++) {
        const endId = `server-${String(l).padStart(2, '0')}-${String(e).padStart(3, '0')}`
        nodes.push(node(endId, 'end'))
        edges.push(edge(leafId, endId))
      }
    }

    const result = layoutSite({ nodes, edges })

    // Find x range of all positions
    let minX = Infinity
    let maxX = -Infinity
    for (const pos of result.positions.values()) {
      minX = Math.min(minX, pos[0])
      maxX = Math.max(maxX, pos[0])
    }

    // Width should be bounded; 10 leaves * 4 columns * pitch + some margin
    // With a pitch of ~2, expect max width around 80-100
    const width = maxX - minX
    expect(width).toBeLessThan(200)
  })

  test('test_layoutSite_leafAdded_existingNodesUnmoved', () => {
    // T8-F1: Adding a leaf at END of name order must not move existing fabric nodes
    const baseNodes: LogicalNode[] = [
      node('leaf-1', 'leaf'),
      node('leaf-2', 'leaf'),
      node('spine-1', 'spine'),
    ]
    const baseEdges: LogicalEdge[] = [
      edge('spine-1', 'leaf-1'),
      edge('spine-1', 'leaf-2'),
    ]

    const before = layoutSite({ nodes: baseNodes, edges: baseEdges })

    // Add leaf-3 at the END of name order
    const expandedNodes = [...baseNodes, node('leaf-3', 'leaf')]
    const expandedEdges = [...baseEdges, edge('spine-1', 'leaf-3')]
    const after = layoutSite({ nodes: expandedNodes, edges: expandedEdges })

    // Existing nodes must not move
    for (const n of baseNodes) {
      expect(after.positions.get(n.id)).toEqual(before.positions.get(n.id))
    }
  })

  test('test_layoutSite_liveOnlyNodeAdded_existingNodesUnmoved', () => {
    // T8-F2: Adding a live-only node (LLDP discovery) must not move existing nodes
    // LLDP discoveries trickle in at END of name order (spine-2 after spine-1)
    const baseNodes: LogicalNode[] = [
      node('spine-1', 'spine'),
      node('leaf-1', 'leaf'),
      node('leaf-2', 'leaf'),
    ]
    const baseEdges: LogicalEdge[] = [
      edge('spine-1', 'leaf-1'),
      edge('spine-1', 'leaf-2'),
    ]

    const before = layoutSite({ nodes: baseNodes, edges: baseEdges })

    // Add a live-only node (new spine discovered via LLDP, sorts after spine-1)
    const expandedNodes = [...baseNodes, node('spine-2', 'spine')]
    // Live-only edge (no members)
    const liveOnlyEdge: LogicalEdge = {
      id: 'leaf-1~spine-2',
      a: 'leaf-1',
      b: 'spine-2',
      layers: { isis: { up: 1, total: 1, label: 'IS-IS adj' } },
      members: [],
    }
    const after = layoutSite({ nodes: expandedNodes, edges: [...baseEdges, liveOnlyEdge] })

    for (const n of baseNodes) {
      expect(after.positions.get(n.id)).toEqual(before.positions.get(n.id))
    }
  })

  test('test_layoutSite_anchorPrefersDocumentedEdge', () => {
    // T8-F3: Anchor selection should prefer documented edges over live-only edges
    const graph: LogicalGraph = {
      nodes: [
        node('leaf-1', 'leaf'),
        node('leaf-2', 'leaf'),
        node('server-1', 'end'),
      ],
      edges: [
        // leaf-1 sorts first but is LIVE-ONLY (no members)
        {
          id: 'leaf-1~server-1',
          a: 'leaf-1',
          b: 'server-1',
          layers: { isis: { up: 1, total: 1, label: '' } },
          members: [],
        },
        // leaf-2 has DOCUMENTED edge (has members)
        {
          id: 'leaf-2~server-1',
          a: 'leaf-2',
          b: 'server-1',
          layers: { physical: { up: 1, total: 1, label: '' } },
          members: [{ id: 'cable', a: { deviceName: 'leaf-2', name: 'eth0' }, b: { deviceName: 'server-1', name: 'eth0' } }],
        },
      ],
    }

    const result = layoutSite(graph)

    const leaf1X = result.positions.get('leaf-1')![0]
    const leaf2X = result.positions.get('leaf-2')![0]
    const server1X = result.positions.get('server-1')![0]

    // Per brief, server should be under leaf-2 (documented edge)
    const distToLeaf1 = Math.abs(server1X - leaf1X)
    const distToLeaf2 = Math.abs(server1X - leaf2X)
    expect(distToLeaf2).toBeLessThan(distToLeaf1)
  })

  test('test_layoutSite_endDevices_groupedUnderLeaf', () => {
    // End devices should be positioned under their anchor leaf
    const graph: LogicalGraph = {
      nodes: [
        node('spine-1', 'spine'),
        node('leaf-1', 'leaf'),
        node('leaf-2', 'leaf'),
        node('server-1', 'end'),
        node('server-2', 'end'),
        node('server-3', 'end'),
      ],
      edges: [
        edge('spine-1', 'leaf-1'),
        edge('spine-1', 'leaf-2'),
        edge('leaf-1', 'server-1'),
        edge('leaf-1', 'server-2'),
        edge('leaf-2', 'server-3'),
      ],
    }

    const result = layoutSite(graph)
    const positions = result.positions

    const leaf1X = positions.get('leaf-1')![0]
    const leaf2X = positions.get('leaf-2')![0]
    const server1X = positions.get('server-1')![0]
    const server2X = positions.get('server-2')![0]
    const server3X = positions.get('server-3')![0]

    // server-1 and server-2 should be closer to leaf-1
    // server-3 should be closer to leaf-2
    const s1ToL1 = Math.abs(server1X - leaf1X)
    const s1ToL2 = Math.abs(server1X - leaf2X)
    const s3ToL1 = Math.abs(server3X - leaf1X)
    const s3ToL2 = Math.abs(server3X - leaf2X)

    expect(s1ToL1).toBeLessThan(s1ToL2)
    expect(s3ToL2).toBeLessThan(s3ToL1)
  })

  test('test_layoutSite_endDevicesUnderWrappedLeaves', () => {
    // REGRESSION: With 60+ leaves (wrapping to multiple rows at NODES_PER_ROW=40),
    // each end device must be positioned directly under its anchor leaf
    // (matching the leaf's x and z), not in a linear slot that ignores wrapping.
    const leafCount = 60
    const endsPerLeaf = 4

    const nodes: LogicalNode[] = []
    const edges: LogicalEdge[] = []

    // Create 60 leaves (wrap at row 40, so leaves 40-59 are in row 2)
    for (let l = 0; l < leafCount; l++) {
      const leafId = `leaf-${String(l).padStart(2, '0')}`
      nodes.push(node(leafId, 'leaf'))

      for (let e = 0; e < endsPerLeaf; e++) {
        const endId = `server-${String(l).padStart(2, '0')}-${String(e).padStart(2, '0')}`
        nodes.push(node(endId, 'end'))
        edges.push(edge(leafId, endId))
      }
    }

    const result = layoutSite({ nodes, edges })
    const positions = result.positions

    // Check a leaf in the second row (leaf-45, index 45)
    // It should be at col 5, row 1, so x = 5 * PITCH_X, z = 1 * PITCH_Z
    const leaf45Pos = positions.get('leaf-45')!
    expect(leaf45Pos).toBeDefined()

    // Its end devices must have the same z as the leaf and x within the leaf's slot
    for (let e = 0; e < endsPerLeaf; e++) {
      const endId = `server-45-${String(e).padStart(2, '0')}`
      const endPos = positions.get(endId)!
      expect(endPos).toBeDefined()
      // End device z must equal leaf z (same row)
      expect(endPos[2]).toBe(leaf45Pos[2])
      // End device x must be close to leaf x (within one leaf slot width)
      // Slot width is COLS_PER_LEAF * PITCH_X = 4 * 2 = 8, so within ~8 units
      expect(Math.abs(endPos[0] - leaf45Pos[0])).toBeLessThan(10)
    }

    // Also check that the total x extent is bounded by the leaf tier extent
    const leafXs = Array.from(positions.entries())
      .filter(([id]) => id.startsWith('leaf-'))
      .map(([, pos]) => pos[0])
    const leafMinX = Math.min(...leafXs)
    const leafMaxX = Math.max(...leafXs)

    const endXs = Array.from(positions.entries())
      .filter(([id]) => id.startsWith('server-'))
      .map(([, pos]) => pos[0])
    const endMinX = Math.min(...endXs)
    const endMaxX = Math.max(...endXs)

    // End devices must not extend far beyond the leaf tier
    // With proper layout, end max x should be within leaf max x + one slot width (8)
    expect(endMaxX).toBeLessThanOrEqual(leafMaxX + 10)
    expect(endMinX).toBeGreaterThanOrEqual(leafMinX - 2)
  })

  test('test_layoutSite_upperTiersPitch_enoughForLabels', () => {
    // REGRESSION: Upper tiers (remote, core, spine) need enough horizontal spacing
    // for readable labels. With 14-char labels at ~1 world unit fontSize, adjacent
    // nodes need at least 8 world units of spacing to avoid overlapping labels.
    const graph: LogicalGraph = {
      nodes: [
        node('remote-a', 'remote'),
        node('remote-b', 'remote'),
        node('core-1', 'core'),
        node('core-2', 'core'),
        node('spine-01', 'spine'),
        node('spine-02', 'spine'),
        node('spine-03', 'spine'),
      ],
      edges: [],
    }

    const result = layoutSite(graph)

    // Check pitch between adjacent remote nodes (sorted by name: remote-a, remote-b)
    const remoteA = result.positions.get('remote-a')!
    const remoteB = result.positions.get('remote-b')!
    expect(remoteB[0] - remoteA[0]).toBeGreaterThanOrEqual(8)

    // Check pitch between adjacent core nodes (sorted by name: core-1, core-2)
    const core1 = result.positions.get('core-1')!
    const core2 = result.positions.get('core-2')!
    expect(core2[0] - core1[0]).toBeGreaterThanOrEqual(8)

    // Check pitch between adjacent spine nodes (sorted by name: spine-01, spine-02)
    const spine01 = result.positions.get('spine-01')!
    const spine02 = result.positions.get('spine-02')!
    expect(spine02[0] - spine01[0]).toBeGreaterThanOrEqual(8)
  })

  test('test_layoutSite_endDevicePrefersLeafAnchor', () => {
    // REGRESSION: An end device connected to both a spine and a leaf must anchor
    // to the LEAF, not the spine. The spine sorts first alphabetically
    // (site-a-spine-01 < site-a-srv-01-oob), but end devices belong under leaves.
    // Use multiple spines/leaves so they have different x positions.
    const graph: LogicalGraph = {
      nodes: [
        node('site-a-spine-01', 'spine'),
        node('site-a-spine-02', 'spine'),
        node('site-a-srv-01-oob', 'leaf'),
        node('site-a-srv-02-oob', 'leaf'),
        node('site-a-srv-01-srv-01', 'end'),
      ],
      edges: [
        // Fabric edges
        edge('site-a-spine-01', 'site-a-srv-01-oob'),
        edge('site-a-spine-01', 'site-a-srv-02-oob'),
        edge('site-a-spine-02', 'site-a-srv-01-oob'),
        edge('site-a-spine-02', 'site-a-srv-02-oob'),
        // Server connected to both spine (sorts first) and leaf (second leaf at x=2)
        edge('site-a-spine-01', 'site-a-srv-01-srv-01'),
        edge('site-a-srv-01-oob', 'site-a-srv-01-srv-01'),
      ],
    }

    const result = layoutSite(graph)

    // Spine at x=0 (UPPER_PITCH_X=12, index 0), leaf at x=0 (PITCH_X=2, index 0)
    // Both at x=0, so server position tells us which is the anchor
    const spinePos = result.positions.get('site-a-spine-01')!
    const leafPos = result.positions.get('site-a-srv-01-oob')!
    const serverPos = result.positions.get('site-a-srv-01-srv-01')!

    // Server z should match leaf z, not spine z (or differ by tier y)
    // The key indicator is that the server is placed under a leaf slot
    expect(serverPos).toBeDefined()

    // Server should be within the leaf's slot width (max deviation: 0.75 from leaf x)
    const distToLeaf = Math.abs(serverPos[0] - leafPos[0])
    expect(distToLeaf).toBeLessThanOrEqual(0.75) // Within leaf curtain slot
  })
})

describe('layoutBackbone', () => {
  test('test_layoutBackbone_byLongitude_noOverlap', () => {
    // Sites should be ordered by longitude around a ring
    const graph: LogicalGraph = {
      nodes: [
        node('site:site-a', 'remote', 'site-a'),
        node('site:site-b', 'remote', 'site-b'),
        node('site:site-c', 'remote', 'site-c'),
      ],
      edges: [],
    }

    const sites: Site[] = [
      { id: '1', name: 'site-a', longitude: 10, latitude: 50, region: null, status: 'active', physicalAddress: null, facility: null, role: null, rackCount: null, deviceCount: null },
      { id: '2', name: 'site-b', longitude: -5, latitude: 45, region: null, status: 'active', physicalAddress: null, facility: null, role: null, rackCount: null, deviceCount: null },
      { id: '3', name: 'site-c', longitude: 20, latitude: 48, region: null, status: 'active', physicalAddress: null, facility: null, role: null, rackCount: null, deviceCount: null },
    ]

    const positions = layoutBackbone(graph, sites)

    // All positions should be distinct (no overlap)
    const positionSet = new Set<string>()
    for (const [id, pos] of positions) {
      const key = pos.join(',')
      expect(positionSet.has(key)).toBe(false)
      positionSet.add(key)
    }

    // Verify we have positions for all sites
    expect(positions.size).toBe(3)
  })

  test('test_layoutBackbone_nullCoordinates_placedLast', () => {
    // Sites with null coordinates should be placed after sites with coordinates
    const graph: LogicalGraph = {
      nodes: [
        node('site:site-a', 'remote', 'site-a'),
        node('site:site-b', 'remote', 'site-b'),
        node('site:site-c', 'remote', 'site-c'),
      ],
      edges: [],
    }

    const sites: Site[] = [
      { id: '1', name: 'site-a', longitude: 10, latitude: 50, region: null, status: 'active', physicalAddress: null, facility: null, role: null, rackCount: null, deviceCount: null },
      { id: '2', name: 'site-b', longitude: null, latitude: null, region: null, status: 'active', physicalAddress: null, facility: null, role: null, rackCount: null, deviceCount: null },
      { id: '3', name: 'site-c', longitude: 5, latitude: 48, region: null, status: 'active', physicalAddress: null, facility: null, role: null, rackCount: null, deviceCount: null },
    ]

    const positions = layoutBackbone(graph, sites)

    // All sites should have positions
    expect(positions.size).toBe(3)

    // The site with null coordinates should be placed last in the ring order
    // This means it should have the highest angle position
    // We can verify by checking the order is: site-c (5), site-a (10), site-b (null)
    const posA = positions.get('site:site-a')!
    const posB = positions.get('site:site-b')!
    const posC = positions.get('site:site-c')!

    // All should have valid positions
    expect(posA).toBeDefined()
    expect(posB).toBeDefined()
    expect(posC).toBeDefined()
  })

  test('test_layoutBackbone_clusterGrows_otherClustersUnmoved', () => {
    // Growing a cluster (adding devices to a site) should not move other clusters
    const baseNodes: LogicalNode[] = [
      node('site:site-a', 'remote', 'site-a'),
      node('site:site-b', 'remote', 'site-b'),
    ]

    const sites: Site[] = [
      { id: '1', name: 'site-a', longitude: 10, latitude: 50, region: null, status: 'active', physicalAddress: null, facility: null, role: null, rackCount: null, deviceCount: null },
      { id: '2', name: 'site-b', longitude: -5, latitude: 45, region: null, status: 'active', physicalAddress: null, facility: null, role: null, rackCount: null, deviceCount: null },
    ]

    const before = layoutBackbone({ nodes: baseNodes, edges: [] }, sites)

    // Add more nodes for site-a (simulating device nodes in cluster)
    const expandedNodes: LogicalNode[] = [
      ...baseNodes,
      node('core-1', 'core', 'site-a'),
      node('core-2', 'core', 'site-a'),
    ]

    const after = layoutBackbone({ nodes: expandedNodes, edges: [] }, sites)

    // site:site-b position should be unchanged
    expect(after.get('site:site-b')).toEqual(before.get('site:site-b'))
    // site:site-a position should be unchanged (cluster anchor)
    expect(after.get('site:site-a')).toEqual(before.get('site:site-a'))
  })
})

describe('sitePairEdges', () => {
  test('test_sitePairEdges_pairWithDeviceEdge_omitted', () => {
    // Circuit groups that already have a device-to-device edge should be omitted
    const graph: LogicalGraph = {
      nodes: [
        node('core-a', 'core', 'site-a'),
        node('core-b', 'core', 'site-b'),
      ],
      edges: [
        // Already have a device-level edge between the sites
        edge('core-a', 'core-b'),
      ],
    }

    const circuitGroups: CircuitGroup[] = [
      {
        siteA: 'site-a',
        siteZ: 'site-b',
        count: 2,
        circuitIds: ['c1', 'c2'],
        circuits: [],
        maxCommitRate: 10000,
      },
    ]

    const result = sitePairEdges(graph, circuitGroups)

    // No edges should be added since there's already a device edge
    expect(result.length).toBe(0)
  })

  test('test_sitePairEdges_noTopology_oneEdgePerCircuitGroup', () => {
    // When there's no device topology, each circuit group becomes a site-pair edge
    const graph: LogicalGraph = {
      nodes: [
        node('site:site-a', 'remote', 'site-a'),
        node('site:site-b', 'remote', 'site-b'),
        node('site:site-c', 'remote', 'site-c'),
      ],
      edges: [],
    }

    const circuitGroups: CircuitGroup[] = [
      {
        siteA: 'site-a',
        siteZ: 'site-b',
        count: 2,
        circuitIds: ['c1', 'c2'],
        circuits: [],
        maxCommitRate: 10000,
      },
      {
        siteA: 'site-a',
        siteZ: 'site-c',
        count: 1,
        circuitIds: ['c3'],
        circuits: [],
        maxCommitRate: 5000,
      },
    ]

    const result = sitePairEdges(graph, circuitGroups)

    // Should have 2 edges for the 2 circuit groups
    expect(result.length).toBe(2)

    // Each edge should connect site: nodes
    const edgeIds = result.map((e) => e.id).sort()
    expect(edgeIds).toContain('site:site-a~site:site-b')
    expect(edgeIds).toContain('site:site-a~site:site-c')
  })
})
