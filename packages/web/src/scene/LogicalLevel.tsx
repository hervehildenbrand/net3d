/**
 * Logical topology view: tiered 3D graph of device relationships.
 * Logic-free: all decisions come from lib/logicalView.ts and lib/logicalLayout.ts.
 * Mounted INSTEAD OF SiteLevel/RackLevel/CameraRig when logical view is active.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { CameraControls, Instances, Instance, Line, Html } from '@react-three/drei'
import type { CameraControls as CameraControlsImpl } from '@react-three/drei'
import * as THREE from 'three'
import type { LogicalGraph, LogicalEdge, LogicalNode, LogicalLayer, CircuitLive, SiteTelemetry } from '@net3d/shared'
import type { ViewLevel } from '../store/useAppStore'
import type { EdgeGeometry, EdgeLive, EdgeStyle, CameraFrame, NodeClickAction, Bounds } from '../lib/logicalView'
import { theme } from '../theme'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Tiers that get permanent labels (remote, core, spine). Leaf and end on hover. */
const PERMANENT_LABEL_TIERS = new Set(['remote', 'core', 'spine'])

/** Node sphere radius. */
const NODE_RADIUS = 0.15

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface LogicalLevelProps {
  level: ViewLevel
  siteName: string | null
  graph: LogicalGraph
  positions: Map<string, [number, number, number]>
  bounds: Bounds
  geometry: EdgeGeometry
  /** Compute live data for an edge. */
  getEdgeLive: (edge: LogicalEdge) => EdgeLive | null
  /** Compute style for an edge. */
  getEdgeStyle: (edge: LogicalEdge, live: EdgeLive | null) => EdgeStyle
  /** Compute tooltip for an edge. */
  getEdgeTooltip: (edge: LogicalEdge, live: EdgeLive | null) => string
  /** Compute camera frame from bounds. */
  getCameraFrame: (bounds: Bounds) => CameraFrame
  /** Compute click action for a node. */
  getNodeClickAction: (node: LogicalNode, level: ViewLevel) => NodeClickAction
  /** Called when a device is selected. */
  onSelectDevice: (deviceId: string) => void
  /** Called when a site cluster is clicked at map level. */
  onSelectSite: (siteName: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip Style
// ─────────────────────────────────────────────────────────────────────────────

const tooltipStyle: React.CSSProperties = {
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  transform: 'translateY(-100%)',
  background: 'rgba(255,255,255,0.96)',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  boxShadow: '0 1px 3px rgba(15,23,42,0.12)',
  padding: '6px 9px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  lineHeight: 1.5,
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LogicalLevel({
  level,
  siteName,
  graph,
  positions,
  bounds,
  geometry,
  getEdgeLive,
  getEdgeStyle,
  getEdgeTooltip,
  getCameraFrame,
  getNodeClickAction,
  onSelectDevice,
  onSelectSite,
}: LogicalLevelProps) {
  const controls = useRef<CameraControlsImpl>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)

  // Camera framing: keyed on level:siteName, fires once per key
  const cameraKey = `${level}:${siteName ?? ''}`
  const lastCameraKey = useRef<string | null>(null)

  useEffect(() => {
    const c = controls.current
    if (!c) return
    if (cameraKey === lastCameraKey.current) return
    lastCameraKey.current = cameraKey

    const frame = getCameraFrame(bounds)
    void c.setLookAt(
      frame.position[0], frame.position[1], frame.position[2],
      frame.target[0], frame.target[1], frame.target[2],
      true, // animate
    )
    c.maxDistance = frame.maxDistance
  }, [cameraKey, bounds, getCameraFrame])

  // Build edge lookup map
  const edgeById = useMemo(() => {
    const map = new Map<string, LogicalEdge>()
    for (const edge of graph.edges) {
      map.set(edge.id, edge)
    }
    return map
  }, [graph.edges])

  // Node click handler
  const handleNodeClick = useCallback(
    (node: LogicalNode) => {
      const action = getNodeClickAction(node, level)
      if (!action) return
      if (action.kind === 'select') {
        onSelectDevice(action.id)
      } else if (action.kind === 'site') {
        onSelectSite(action.name)
      }
    },
    [level, getNodeClickAction, onSelectDevice, onSelectSite],
  )

  // Separate nodes by tier for instancing
  const nodesByTier = useMemo(() => {
    const byTier = new Map<string, LogicalNode[]>()
    for (const node of graph.nodes) {
      const tier = node.tier
      if (!byTier.has(tier)) byTier.set(tier, [])
      byTier.get(tier)!.push(node)
    }
    return byTier
  }, [graph.nodes])

  // Nodes with permanent labels
  // Site level: remote, core, spine tiers
  // Map level: one label per site cluster (first node per siteName)
  const permanentLabelIds = useMemo(() => {
    const ids = new Set<string>()
    if (level === 'map') {
      // Map: one label per site cluster
      const sitesSeen = new Set<string>()
      for (const node of graph.nodes) {
        if (node.siteName && !sitesSeen.has(node.siteName)) {
          sitesSeen.add(node.siteName)
          ids.add(node.id)
        }
      }
    } else {
      // Site: remote, core, spine get labels
      for (const node of graph.nodes) {
        if (PERMANENT_LABEL_TIERS.has(node.tier)) {
          ids.add(node.id)
        }
      }
    }
    return ids
  }, [graph.nodes, level])

  // For map level, map node id -> siteName for cluster labels
  const siteNameById = useMemo(() => {
    const map = new Map<string, string>()
    if (level === 'map') {
      for (const node of graph.nodes) {
        if (node.siteName) {
          map.set(node.id, node.siteName)
        }
      }
    }
    return map
  }, [graph.nodes, level])


  // Hovered edge for tooltip
  const hoveredEdgeObj = hoveredEdge ? edgeById.get(hoveredEdge) : null
  const hoveredEdgeLive = hoveredEdgeObj ? getEdgeLive(hoveredEdgeObj) : null
  const hoveredEdgeTooltip = hoveredEdgeObj ? getEdgeTooltip(hoveredEdgeObj, hoveredEdgeLive) : ''

  // Compute midpoint of hovered edge for tooltip position
  const hoveredEdgeMidpoint = useMemo<[number, number, number] | null>(() => {
    if (!hoveredEdgeObj) return null
    const posA = positions.get(hoveredEdgeObj.a)
    const posB = positions.get(hoveredEdgeObj.b)
    if (!posA || !posB) return null
    return [
      (posA[0] + posB[0]) / 2,
      (posA[1] + posB[1]) / 2 + 0.3,
      (posA[2] + posB[2]) / 2,
    ]
  }, [hoveredEdgeObj, positions])

  // Batch edge points as [x, y, z] tuples for drei Line segments
  const batchPointsTuples = useMemo<[number, number, number][]>(() => {
    const points = geometry.batch.points
    const tuples: [number, number, number][] = []
    for (let i = 0; i < points.length; i += 3) {
      tuples.push([points[i]!, points[i + 1]!, points[i + 2]!])
    }
    return tuples
  }, [geometry.batch.points])

  // Batch edge colors as [r, g, b] tuples
  const batchColors = useMemo<[number, number, number][]>(() => {
    const colors: [number, number, number][] = []
    for (const edgeId of geometry.batch.edgeIds) {
      const edge = edgeById.get(edgeId)
      const c = edge
        ? new THREE.Color(getEdgeStyle(edge, getEdgeLive(edge)).color)
        : new THREE.Color(0.4, 0.4, 0.4)
      // Two vertices per edge segment
      colors.push([c.r, c.g, c.b], [c.r, c.g, c.b])
    }
    return colors
  }, [geometry.batch.edgeIds, edgeById, getEdgeLive, getEdgeStyle])

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />

      {/* Camera controls - no nav signals */}
      <CameraControls
        ref={controls}
        minDistance={1}
        maxDistance={100}
        smoothTime={0.4}
      />

      {/* Nodes by tier - using Instances for performance */}
      {[...nodesByTier.entries()].map(([tier, nodes]) => {
        const color = (theme.tier as Record<string, string>)[tier] ?? '#64748b'
        return (
          <Instances key={tier} limit={nodes.length + 1}>
            <sphereGeometry args={[NODE_RADIUS, 16, 16]} />
            <meshStandardMaterial color={color} />
            {nodes.map((node) => {
              const pos = positions.get(node.id)
              if (!pos) return null
              const isHovered = node.id === hoveredNode
              const scale = isHovered ? 1.3 : 1
              return (
                <Instance
                  key={node.id}
                  position={pos}
                  scale={[scale, scale, scale]}
                  onPointerOver={(e) => {
                    e.stopPropagation()
                    setHoveredNode(node.id)
                    document.body.style.cursor = 'pointer'
                  }}
                  onPointerOut={() => {
                    setHoveredNode(null)
                    document.body.style.cursor = 'auto'
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleNodeClick(node)
                  }}
                />
              )
            })}
          </Instances>
        )
      })}

      {/* Permanent node labels - rendered as DOM to avoid WebGL depth occlusion */}
      {graph.nodes.map((node) => {
        if (!permanentLabelIds.has(node.id)) return null
        const pos = positions.get(node.id)
        if (!pos) return null
        // At map level, show siteName for cluster labels; otherwise device name
        const labelText = level === 'map' && siteNameById.has(node.id)
          ? siteNameById.get(node.id)!
          : node.name.split('.')[0]
        return (
          <Html
            key={`label-${node.id}`}
            position={[pos[0], pos[1] + NODE_RADIUS * 3, pos[2]]}
            center
            zIndexRange={[10, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div style={{
              fontFamily: 'ui-sans-serif, system-ui, sans-serif',
              fontSize: 10,
              fontWeight: 600,
              color: theme.text.primary,
              textShadow: '-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff',
              whiteSpace: 'nowrap',
            }}>
              {labelText}
            </div>
          </Html>
        )
      })}

      {/* Individual hoverable edges */}
      {geometry.lines.map(({ id, points }) => {
        const edge = edgeById.get(id)
        if (!edge) return null
        const live = getEdgeLive(edge)
        const style = getEdgeStyle(edge, live)
        const isHovered = id === hoveredEdge
        return (
          <Line
            key={id}
            points={points}
            color={style.color}
            lineWidth={isHovered ? style.width + 2 : style.width}
            dashed={style.dashed}
            dashSize={0.1}
            gapSize={0.05}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHoveredEdge(id)
              document.body.style.cursor = 'pointer'
            }}
            onPointerOut={() => {
              setHoveredEdge(null)
              document.body.style.cursor = 'auto'
            }}
          />
        )
      })}

      {/* Batched edges (not individually hoverable) */}
      {batchPointsTuples.length > 0 && (
        <Line
          points={batchPointsTuples}
          vertexColors={batchColors}
          lineWidth={1}
          segments
        />
      )}

      {/* Edge tooltip */}
      {hoveredEdgeObj && hoveredEdgeMidpoint && (
        <Html
          position={hoveredEdgeMidpoint}
          center
          zIndexRange={[100, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div style={tooltipStyle}>
            <div style={{ color: theme.text.primary }}>{hoveredEdgeTooltip}</div>
          </div>
        </Html>
      )}

      {/* Node tooltip for hovered node without permanent label (leaf and end tiers) */}
      {hoveredNode && !permanentLabelIds.has(hoveredNode) && (() => {
        const node = graph.nodes.find((n) => n.id === hoveredNode)
        const pos = node ? positions.get(node.id) : null
        if (!node || !pos) return null
        return (
          <Html
            position={[pos[0], pos[1] + NODE_RADIUS * 2, pos[2]]}
            center
            zIndexRange={[100, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div style={tooltipStyle}>
              <div style={{ fontWeight: 600, color: theme.text.primary }}>{node.name}</div>
              {node.device && (
                <div style={{ color: theme.text.secondary }}>{node.device.roleName}</div>
              )}
            </div>
          </Html>
        )
      })()}
    </>
  )
}
