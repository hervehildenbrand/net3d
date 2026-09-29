import type { LogicalLayer } from '@net3d/shared'
import type { ViewLevel, ViewMode } from '../store/useAppStore'
import { theme } from '../theme'
import { panelStyle, sectionLabel, optionRow, check, divider } from './LayersPanel'
import { UtilLegend } from './UtilLegend'

// -----------------------------------------------------------------------------
// Layer display labels
// -----------------------------------------------------------------------------

const LAYER_LABELS: Record<LogicalLayer, string> = {
  physical: 'physical',
  isis: 'IS-IS',
  ospf: 'OSPF',
  sr: 'SR',
}

// -----------------------------------------------------------------------------
// ViewModeSwitch
// -----------------------------------------------------------------------------

interface ViewModeSwitchProps {
  available: boolean
  viewMode: ViewMode
  level: ViewLevel
  leftOffset: number
  inEditMode: boolean
  onSwitch: (mode: ViewMode) => void
  onMouseEnter: () => void
}

/**
 * Physical | Logical segmented switch (top-left HUD).
 * Hidden when: unavailable, at rack level, or in edit mode.
 */
export function ViewModeSwitch({
  available,
  viewMode,
  level,
  leftOffset,
  inEditMode,
  onSwitch,
  onMouseEnter,
}: ViewModeSwitchProps) {
  // Hidden when unavailable, at rack level, or in edit mode
  if (!available || level === 'rack' || inEditMode) return null

  const top = level === 'map' ? 56 : 96

  return (
    <div
      role="group"
      aria-label="view mode"
      onMouseEnter={onMouseEnter}
      style={{
        position: 'absolute',
        top,
        left: leftOffset,
        zIndex: 20,
        display: 'flex',
        gap: 2,
        padding: 3,
        background: theme.hud.background,
        border: `1px solid ${theme.hud.border}`,
        borderRadius: 8,
        boxShadow: theme.hud.shadow,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 13,
      }}
    >
      {(['physical', 'logical'] as const).map((mode) => {
        const active = viewMode === mode
        return (
          <button
            key={mode}
            onClick={() => onSwitch(mode)}
            aria-pressed={active}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 10px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: active ? theme.hud.accent : 'transparent',
              color: active ? '#ffffff' : theme.text.primary,
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        )
      })}
    </div>
  )
}

// -----------------------------------------------------------------------------
// LogicalLayers
// -----------------------------------------------------------------------------

interface LogicalLayersProps {
  level: ViewLevel
  /** Layers present in the data; only these appear as checkboxes. */
  layers: LogicalLayer[]
  /** Layers (and 'end') currently hidden. */
  hidden: Set<LogicalLayer | 'end'>
  onToggle: (layer: LogicalLayer | 'end') => void
  /** Whether live telemetry data exists (shows UtilLegend). */
  hasLive: boolean
  /** Whether the topology query is in error state. */
  isError: boolean
}

/**
 * Logical-view layers panel (right side).
 * Site level: top 16, right 16. Map level: bottom 32, right 16, top auto (clears attribution).
 */
export function LogicalLayers({
  level,
  layers,
  hidden,
  onToggle,
  hasLive,
  isError,
}: LogicalLayersProps) {
  // Position: site = top-right, map = bottom-right with top:auto to clear attribution
  const positionStyle: React.CSSProperties =
    level === 'map' ? { bottom: 32, right: 16, top: 'auto' } : { top: 16, right: 16 }

  // "no routing data yet" line when layers is empty and no error
  const noTopology = layers.length === 0 && !isError

  return (
    <div style={{ ...panelStyle, ...positionStyle }}>
      <div style={sectionLabel}>Layers</div>
      {layers.map((layer) => {
        const on = !hidden.has(layer)
        return (
          <button key={layer} onClick={() => onToggle(layer)} style={optionRow}>
            <span style={check(on)} />
            <span style={{ flex: 1, color: theme.text.primary }}>{LAYER_LABELS[layer]}</span>
          </button>
        )
      })}

      {/* End devices row: only at site level */}
      {level !== 'map' && (
        <>
          <div style={divider} />
          <button onClick={() => onToggle('end')} style={optionRow}>
            <span style={check(!hidden.has('end'))} />
            <span style={{ flex: 1, color: theme.text.primary }}>End devices</span>
          </button>
        </>
      )}

      {hasLive && level !== 'map' && (
        <div style={{ marginTop: 8 }}>
          <UtilLegend />
        </div>
      )}

      {noTopology && (
        <div style={{ marginTop: 8, color: theme.text.muted, fontSize: 11 }}>
          no routing data yet
        </div>
      )}

      {isError && (
        <div style={{ marginTop: 8, color: theme.text.muted, fontSize: 11 }}>
          collector unreachable
        </div>
      )}
    </div>
  )
}
