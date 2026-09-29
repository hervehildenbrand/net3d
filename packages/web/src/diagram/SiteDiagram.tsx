/**
 * Site diagram: 2D SVG view of the logical site topology.
 * Lazy loaded, owns its loading/empty states so the physical room never flashes.
 */
import { useState, useRef, useMemo, useEffect, useCallback, memo, type CSSProperties } from 'react'
import type { LogicalGraph, LogicalLayer, SiteTelemetry } from '@net3d/shared'
import type { RackInput } from '../lib/siteDiagramLayout'
import type { Box, Insets } from '../lib/viewBox'
import {
  layoutSiteDiagram,
  focusOf,
  shortLabel,
  overlayBox,
  type SiteDiagramLayout,
  type RackColumn,
  CHIP_H,
  OVERLAY_ROW_H,
  OVERLAY_NAME_W,
  OVERLAY_LINK_W,
} from '../lib/siteDiagramLayout'
import {
  fitView,
  scaleOf,
  zoomAt,
  panBy,
  revealBox,
  wheelFactor,
  glyphLabelsVisible,
} from '../lib/viewBox'
import {
  siteEdgeLive,
  edgeStyle,
  edgeTooltip,
  nodeTooltipRows,
  nodeClickAction,
  isEdgeHidden,
  type EdgeStyle,
} from '../lib/logicalView'
import { theme } from '../theme'

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface SiteDiagramProps {
  siteName: string
  graph: LogicalGraph | null
  racks: RackInput[] | undefined
  telemetry: SiteTelemetry | undefined
  hidden: ReadonlySet<LogicalLayer | 'end'>
  selectedDeviceId: string | null
  insets: Insets
  onSelectDevice: (id: string | null) => void
  onSelectSite: (name: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MIN_ZOOM_FACTOR = 0.5 // fitScale / 2
const MAX_SCALE = 12
const DRAG_THRESHOLD = 3

const EMPTY_GRAPH: LogicalGraph = { nodes: [], edges: [] }
const EMPTY_RACKS: RackInput[] = []

// ─────────────────────────────────────────────────────────────────────────────
// Tier colors from theme
// ─────────────────────────────────────────────────────────────────────────────

const TIER_COLOR: Record<string, string> = {
  remote: theme.tier.remote,
  core: theme.tier.core,
  spine: theme.tier.spine,
  leaf: theme.tier.leaf,
  end: theme.tier.end,
}

// ─────────────────────────────────────────────────────────────────────────────
// SiteDiagram component
// ─────────────────────────────────────────────────────────────────────────────

export default function SiteDiagram({
  siteName,
  graph,
  racks,
  telemetry,
  hidden,
  selectedDeviceId,
  insets,
  onSelectDevice,
  onSelectSite,
}: SiteDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() =>
    typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : { w: 1280, h: 800 },
  )
  const [view, setView] = useState<Box | null>(null) // null = auto-fit
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [expandedRack, setExpandedRack] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; rows: string[] } | null>(null)

  // Drag state
  const dragRef = useRef<{ startX: number; startY: number; startView: Box; moved: boolean } | null>(null)
  const clickSuppressed = useRef(false)

  // Use safe defaults for hooks when data is not ready
  const safeGraph = graph ?? EMPTY_GRAPH
  const safeRacks = racks ?? EMPTY_RACKS

  // Memoised layout: only recomputes when graph, racks, or site change
  const layout = useMemo(
    () => layoutSiteDiagram(safeGraph, safeRacks, siteName),
    [safeGraph, safeRacks, siteName],
  )

  // Build tier map for edge hiding
  const tierOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of safeGraph.nodes) {
      map.set(node.id, node.tier)
    }
    return map
  }, [safeGraph])

  // Colours: recompute on telemetry change
  const colors = useMemo(() => {
    const map = new Map<string, EdgeStyle>()
    for (const edge of safeGraph.edges) {
      const live = telemetry ? siteEdgeLive(edge, telemetry) : null
      map.set(edge.id, edgeStyle(edge, live, hidden))
    }
    return map
  }, [safeGraph, telemetry, hidden])

  // Computed view: auto-fit or manual
  const computedView = useMemo(() => {
    if (view) return view
    return fitView(layout.bounds, viewport, insets)
  }, [view, layout.bounds, viewport, insets])

  const scale = scaleOf(computedView, viewport)
  const fitScale = scaleOf(fitView(layout.bounds, viewport, insets), viewport)
  const minScale = fitScale * MIN_ZOOM_FACTOR
  const showLabels = glyphLabelsVisible(scale)

  // Focus: hovered or selected device
  const focusId = hoveredId ?? (selectedDeviceId ? safeGraph.nodes.find((n) => n.device?.id === selectedDeviceId)?.id ?? null : null)
  const focus = focusOf(layout, focusId)

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      setView(null) // Reset to auto-fit on resize
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Non-passive wheel listener for zoom
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = wheelFactor(e.deltaY, e.deltaMode)
      const rect = svg.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const currentView = view ?? fitView(layout.bounds, viewport, insets)
      const newView = zoomAt(currentView, viewport, factor, px, py, minScale, MAX_SCALE)
      setView(newView)
    }

    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => svg.removeEventListener('wheel', handleWheel)
  }, [view, layout.bounds, viewport, insets, minScale])

  // Drag handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const currentView = view ?? fitView(layout.bounds, viewport, insets)
      dragRef.current = { startX: e.clientX, startY: e.clientY, startView: currentView, moved: false }
      clickSuppressed.current = false
      ;(e.target as Element).setPointerCapture(e.pointerId)
    },
    [view, layout.bounds, viewport, insets],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      if (!dragRef.current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      dragRef.current.moved = true
      clickSuppressed.current = true
      const newView = panBy(dragRef.current.startView, viewport, dx, dy)
      setView(newView)
    },
    [viewport],
  )

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  // Double-click to fit
  const handleDoubleClick = useCallback(() => {
    setView(null)
  }, [])

  // Node click handler
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (clickSuppressed.current) return
      const node = safeGraph.nodes.find((n) => n.id === nodeId)
      if (!node) return
      const action = nodeClickAction(node, 'site')
      if (action?.kind === 'select') {
        onSelectDevice(action.id)
      } else if (action?.kind === 'site') {
        onSelectSite(action.name)
      }
    },
    [safeGraph, onSelectDevice, onSelectSite],
  )

  // Chip click handler
  const handleChipClick = useCallback(
    (rackKey: string) => {
      if (clickSuppressed.current) return
      if (expandedRack === rackKey) {
        setExpandedRack(null)
      } else {
        setExpandedRack(rackKey)
        // Reveal the overlay
        const column = layout.columns.find((c) => c.key === rackKey)
        if (column) {
          const overlay = overlayBox(layout, column)
          const currentView = view ?? fitView(layout.bounds, viewport, insets)
          const revealed = revealBox(currentView, viewport, overlay, insets)
          if (revealed.x !== currentView.x || revealed.y !== currentView.y) {
            setView(revealed)
          }
        }
      }
    },
    [expandedRack, layout, view, viewport, insets],
  )

  // Background click closes overlay
  const handleBackgroundClick = useCallback(() => {
    if (clickSuppressed.current) return
    setExpandedRack(null)
  }, [])

  // Node hover handlers
  const handleNodeEnter = useCallback(
    (nodeId: string, e: React.PointerEvent) => {
      setHoveredId(nodeId)
      const node = safeGraph.nodes.find((n) => n.id === nodeId)
      if (node) {
        setTooltip({ x: e.clientX, y: e.clientY, rows: nodeTooltipRows(node) })
      }
    },
    [safeGraph],
  )

  const handleNodeLeave = useCallback(() => {
    setHoveredId(null)
    setTooltip(null)
  }, [])

  // Edge hover handlers
  const handleEdgeEnter = useCallback(
    (edgeId: string, e: React.PointerEvent) => {
      const edge = safeGraph.edges.find((ed) => ed.id === edgeId)
      if (edge) {
        const live = telemetry ? siteEdgeLive(edge, telemetry) : null
        setTooltip({ x: e.clientX, y: e.clientY, rows: [edgeTooltip(edge, live)] })
      }
    },
    [safeGraph, telemetry],
  )

  const handleEdgeLeave = useCallback(() => {
    setTooltip(null)
  }, [])

  // Hide chips when 'end' is hidden
  const showChips = !hidden.has('end')

  // Loading state: racks not yet loaded
  if (!racks) {
    return (
      <div style={centerStyle}>
        <span style={{ color: theme.text.secondary }}>Loading {siteName}...</span>
      </div>
    )
  }

  // Empty state: no graph or no nodes
  if (!graph || graph.nodes.length === 0) {
    return (
      <div style={centerStyle}>
        <span style={{ color: theme.text.secondary }}>No network devices documented at {siteName}</span>
      </div>
    )
  }

  // viewBox string
  const viewBoxStr = `${computedView.x} ${computedView.y} ${computedView.w} ${computedView.h}`

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <svg
        ref={svgRef}
        data-diagram
        width="100%"
        height="100%"
        viewBox={viewBoxStr}
        style={{ touchAction: 'none', cursor: 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* Background click target */}
        <rect
          x={layout.bounds.x}
          y={layout.bounds.y}
          width={layout.bounds.w}
          height={layout.bounds.h}
          fill="transparent"
          onClick={handleBackgroundClick}
        />

        {/* Edges */}
        <Edges
          layout={layout}
          graph={graph}
          colors={colors}
          hidden={hidden}
          tierOf={tierOf}
          focus={focus}
          onEdgeEnter={handleEdgeEnter}
          onEdgeLeave={handleEdgeLeave}
        />

        {/* Glyphs */}
        <Glyphs
          layout={layout}
          focus={focus}
          showLabels={showLabels}
          onNodeClick={handleNodeClick}
          onNodeEnter={handleNodeEnter}
          onNodeLeave={handleNodeLeave}
        />

        {/* Row labels */}
        <RowLabels layout={layout} />

        {/* Rack labels */}
        <RackLabels layout={layout} />

        {/* Chips */}
        {showChips && (
          <Chips
            layout={layout}
            expandedRack={expandedRack}
            onChipClick={handleChipClick}
          />
        )}

        {/* Overlay */}
        {showChips && expandedRack && (
          <RackOverlay
            column={layout.columns.find((c) => c.key === expandedRack)!}
            layout={layout}
            graph={graph}
            colors={colors}
            onSelectDevice={onSelectDevice}
          />
        )}
      </svg>

      {/* Tooltip */}
      {tooltip && <Tooltip x={tooltip.x} y={tooltip.y} rows={tooltip.rows} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Edges component (memoised)
// ─────────────────────────────────────────────────────────────────────────────

interface EdgesProps {
  layout: SiteDiagramLayout
  graph: LogicalGraph
  colors: Map<string, EdgeStyle>
  hidden: ReadonlySet<LogicalLayer | 'end'>
  tierOf: Map<string, string>
  focus: ReturnType<typeof focusOf>
  onEdgeEnter: (id: string, e: React.PointerEvent) => void
  onEdgeLeave: () => void
}

const Edges = memo(function Edges({
  layout,
  graph,
  colors,
  hidden,
  tierOf,
  focus,
  onEdgeEnter,
  onEdgeLeave,
}: EdgesProps) {
  // Filter visible edges
  const visibleEdges = layout.edges.filter((edge) => {
    const graphEdge = graph.edges.find((e) => e.id === edge.id)
    if (!graphEdge) return false
    return !isEdgeHidden(graphEdge, tierOf, hidden)
  })

  return (
    <g>
      {visibleEdges.map((edge) => {
        const style = colors.get(edge.id)
        const isFocus = focus?.edges.has(edge.id)
        const isLocal = edge.kind === 'local'
        const isUplink = edge.kind === 'uplink'

        // Local edges only when in focus
        if (isLocal && !isFocus) return null

        // Opacity: with focus, incident edges full, non-incident dimmed (trunks 0.35, uplinks 0.15)
        // Without focus: uplinks faint (0.15), trunks full (1)
        const opacity = focus
          ? (isFocus ? 1 : (isUplink ? 0.15 : 0.35))
          : (isUplink ? 0.15 : 1)
        const width = isFocus ? (style?.width ?? 1) + 1 : style?.width ?? 1

        return (
          <g key={edge.id}>
            {/* Hit area for non-faint edges */}
            {!isUplink && (
              <path
                d={edge.d}
                fill="none"
                stroke="transparent"
                strokeWidth={8}
                style={{ cursor: 'pointer' }}
                onPointerEnter={(e) => onEdgeEnter(edge.id, e)}
                onPointerLeave={onEdgeLeave}
              />
            )}
            {/* Visible path */}
            <path
              data-edge={edge.id}
              data-kind={edge.kind}
              d={edge.d}
              fill="none"
              stroke={style?.color ?? theme.cable.up}
              strokeWidth={width}
              strokeOpacity={opacity}
              strokeDasharray={style?.dashed ? '4 2' : undefined}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        )
      })}
    </g>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Glyphs component (memoised)
// ─────────────────────────────────────────────────────────────────────────────

interface GlyphsProps {
  layout: SiteDiagramLayout
  focus: ReturnType<typeof focusOf>
  showLabels: boolean
  onNodeClick: (id: string) => void
  onNodeEnter: (id: string, e: React.PointerEvent) => void
  onNodeLeave: () => void
}

const Glyphs = memo(function Glyphs({
  layout,
  focus,
  showLabels,
  onNodeClick,
  onNodeEnter,
  onNodeLeave,
}: GlyphsProps) {
  return (
    <g>
      {[...layout.glyphs.values()].map((glyph) => {
        const isUpper = glyph.band === 'peer' || glyph.band === 'core'
        const isSpineOrAgg = glyph.band === 'spine' || glyph.band === 'agg'
        const isFocus = !focus || focus.nodes.has(glyph.id)
        const opacity = isFocus ? 1 : 0.35
        const tierColor = TIER_COLOR[glyph.tier] ?? theme.tier.leaf

        // Upper bands (peer, core): pill style (white fill + tier stroke)
        // Lower bands: tier fill at 0.18 opacity + stroke
        const fillColor = isUpper ? '#ffffff' : tierColor
        const fillOpacity = isUpper ? 1 : 0.18

        // Labels: always for upper bands and spine/agg; rack-column glyphs only when zoomed
        const showLabel = isUpper || isSpineOrAgg || showLabels

        // data-tier: use 'agg' for agg band (DOM verification), else the node's tier
        const dataTier = glyph.band === 'agg' ? 'agg' : glyph.tier

        return (
          <g
            key={glyph.id}
            data-node={glyph.id}
            data-tier={dataTier}
            role="button"
            tabIndex={0}
            aria-label={glyph.id}
            style={{ cursor: 'pointer', opacity }}
            onClick={() => onNodeClick(glyph.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNodeClick(glyph.id)
              }
            }}
            onPointerEnter={(e) => onNodeEnter(glyph.id, e)}
            onPointerLeave={onNodeLeave}
          >
            <rect
              x={glyph.x}
              y={glyph.y}
              width={glyph.w}
              height={glyph.h}
              rx={3}
              fill={fillColor}
              fillOpacity={fillOpacity}
              stroke={tierColor}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {/* Label for upper bands, spine/agg, or when zoomed in */}
            {showLabel && (
              <text
                x={glyph.x + glyph.w / 2}
                y={glyph.y + glyph.h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={theme.text.primary}
                fontSize={12}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                paintOrder="stroke"
                stroke="#ffffff"
                strokeWidth={3}
              >
                {glyph.label}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// RowLabels component
// ─────────────────────────────────────────────────────────────────────────────

const RowLabels = memo(function RowLabels({ layout }: { layout: SiteDiagramLayout }) {
  return (
    <g>
      {layout.rows.map((row, i) => (
        <text
          key={i}
          x={row.x}
          y={row.y + 10}
          textAnchor="start"
          fill={theme.text.secondary}
          fontSize={12}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          paintOrder="stroke"
          stroke="#ffffff"
          strokeWidth={3}
        >
          {row.label}
        </text>
      ))}
    </g>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// RackLabels component
// ─────────────────────────────────────────────────────────────────────────────

const RackLabels = memo(function RackLabels({ layout }: { layout: SiteDiagramLayout }) {
  return (
    <g>
      {layout.columns.map((col) => (
        <text
          key={col.key}
          data-rack={col.key}
          data-location={col.location ?? ''}
          x={col.x + 22}
          y={col.y + 9}
          textAnchor="middle"
          dominantBaseline="central"
          fill={theme.text.secondary}
          fontSize={12}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          paintOrder="stroke"
          stroke="#ffffff"
          strokeWidth={3}
        >
          {col.label}
        </text>
      ))}
    </g>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Chips component
// ─────────────────────────────────────────────────────────────────────────────

interface ChipsProps {
  layout: SiteDiagramLayout
  expandedRack: string | null
  onChipClick: (rackKey: string) => void
}

const Chips = memo(function Chips({ layout, expandedRack, onChipClick }: ChipsProps) {
  return (
    <g>
      {layout.columns.map((col) => {
        if (!col.chip || col.endIds.length === 0) return null
        const isExpanded = col.key === expandedRack
        const label = `${col.endIds.length}${isExpanded ? '▾' : '▸'}`
        const ariaLabel = `${col.label}: ${col.endIds.length} servers`

        return (
          <g
            key={col.key}
            data-chip
            role="button"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-expanded={isExpanded}
            style={{ cursor: 'pointer' }}
            onClick={() => onChipClick(col.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onChipClick(col.key)
              }
            }}
          >
            <rect
              x={col.chip.x}
              y={col.chip.y}
              width={44}
              height={CHIP_H}
              rx={3}
              fill={theme.tier.end}
              fillOpacity={0.18}
              stroke={theme.tier.end}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={col.chip.x + 22}
              y={col.chip.y + CHIP_H / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill={theme.text.secondary}
              fontSize={12}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// RackOverlay component (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

export interface RackOverlayProps {
  column: RackColumn
  layout: SiteDiagramLayout
  graph: LogicalGraph
  colors: Map<string, EdgeStyle>
  onSelectDevice: (id: string | null) => void
}

export const RackOverlay = memo(function RackOverlay({
  column,
  layout,
  graph,
  colors,
  onSelectDevice,
}: RackOverlayProps) {
  if (!column || column.endIds.length === 0) return null

  const box = overlayBox(layout, column)
  const maxLinks = 3

  return (
    <g>
      {/* Background */}
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={4}
        fill="#ffffff"
        stroke={theme.hud.border}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      {/* Server rows */}
      {column.endIds.map((endId, idx) => {
        const node = graph.nodes.find((n) => n.id === endId)
        if (!node) return null

        const rowY = box.y + 4 + idx * OVERLAY_ROW_H
        // Extract just the server part (e.g., "srv-01" from "AMS1-SRV-01-srv-01")
        // Split by the rack name (column.label) to get the suffix
        const parts = node.name.split(`${column.label}-`)
        const shortName = parts.length > 1 ? parts[parts.length - 1]! : shortLabel(node.name, '')

        // Get links for this end node
        const nodeLinks = layout.links.get(endId) ?? []
        const linkPeers = nodeLinks.slice(0, maxLinks).map((link) => {
          const peerNode = graph.nodes.find((n) => n.id === link.peer)
          if (!peerNode) return { edgeId: link.edgeId, label: 'unknown' }
          // Extract just the role part (e.g., "leaf-1" from "AMS1-SRV-01-leaf-1")
          // Split by the rack name (column.label) to get the suffix
          const peerParts = peerNode.name.split(`${column.label}-`)
          const shortPeer = peerParts.length > 1 ? peerParts[peerParts.length - 1]! : peerNode.name.split('-').pop() ?? peerNode.name
          return { edgeId: link.edgeId, label: shortPeer }
        })

        return (
          <g
            key={endId}
            style={{ cursor: 'pointer' }}
            onClick={() => {
              if (node.device) onSelectDevice(node.device.id)
            }}
          >
            {/* Server name */}
            <text
              x={box.x + 4}
              y={rowY + OVERLAY_ROW_H / 2}
              dominantBaseline="central"
              fill={theme.text.primary}
              fontSize={12}
              fontFamily="ui-monospace, monospace"
            >
              {shortName}
            </text>

            {/* Link stubs */}
            {linkPeers.map((link, linkIdx) => (
              <text
                key={link.edgeId}
                x={box.x + OVERLAY_NAME_W + linkIdx * OVERLAY_LINK_W}
                y={rowY + OVERLAY_ROW_H / 2}
                dominantBaseline="central"
                fill={colors.get(link.edgeId)?.color ?? theme.text.muted}
                fontSize={12}
                fontFamily="ui-monospace, monospace"
              >
                {link.label}
              </text>
            ))}
          </g>
        )
      })}
    </g>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip component
// ─────────────────────────────────────────────────────────────────────────────

function Tooltip({ x, y, rows }: { x: number; y: number; rows: string[] }) {
  return (
    <div
      style={{
        position: 'fixed',
        left: x + 12,
        top: y - 8,
        background: theme.hud.background,
        border: `1px solid ${theme.hud.border}`,
        borderRadius: 6,
        padding: '6px 10px',
        boxShadow: theme.hud.shadow,
        zIndex: 100,
        pointerEvents: 'none',
        whiteSpace: 'pre-line',
        fontSize: 12,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        color: theme.text.primary,
      }}
    >
      {rows.join('\n')}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const centerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 14,
}
