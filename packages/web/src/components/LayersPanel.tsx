import { useMemo } from 'react'
import { availableMetrics, type SpecMetric } from '../lib/specsHeatmap'
import { collectSiteRoles } from '../lib/roleHighlight'
import type { SiteRack } from '../hooks/useSiteDetail'
import type { ColorMode, ViewLevel } from '../store/useAppStore'
import { theme } from '../theme'
import { RoleLegend } from './RoleLegend'
import { SpecsHeatmapLegend } from './SpecsHeatmapLegend'

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  zIndex: 20,
  width: 210,
  background: theme.hud.background,
  border: `1px solid ${theme.hud.border}`,
  borderRadius: 8,
  boxShadow: theme.hud.shadow,
  padding: 10,
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
}

const sectionLabel: React.CSSProperties = {
  fontWeight: 600,
  color: theme.text.primary,
  marginBottom: 6,
}

const optionRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '3px 2px',
  fontFamily: 'inherit',
  fontSize: 13,
  textAlign: 'left',
}

const dot = (on: boolean): React.CSSProperties => ({
  width: 12,
  height: 12,
  borderRadius: '50%',
  flexShrink: 0,
  border: `2px solid ${on ? theme.hud.accent : theme.text.muted}`,
  background: on ? theme.hud.accent : 'transparent',
  boxSizing: 'border-box',
})

const check = (on: boolean): React.CSSProperties => ({
  width: 12,
  height: 12,
  borderRadius: 3,
  flexShrink: 0,
  border: `2px solid ${on ? theme.hud.accent : theme.text.muted}`,
  background: on ? theme.hud.accent : 'transparent',
  boxSizing: 'border-box',
})

const divider: React.CSSProperties = {
  borderTop: `1px solid ${theme.hud.border}`,
  margin: '8px 0',
}

interface ColorOption {
  mode: ColorMode
  label: string
}

/**
 * The unified Layers control (top-right at site/rack level): a single-select
 * "Color by" dimension plus independent overlay toggles. Replaces the formerly
 * separate Role/Specs legends and the floating power/connectivity/DC-links
 * buttons. Each color dimension keeps its own sub-control, shown only when active.
 */
export function LayersPanel({
  level,
  racks,
  metricRacks,
  colorMode,
  onColorMode,
  highlightedRoles,
  onToggleRole,
  onClearRoles,
  specsMetric,
  onSpecsMetric,
  powerVisible,
  onTogglePower,
  connectivityVisible,
  onToggleConnectivity,
  dcLinksVisible,
  onToggleDcLinks,
}: {
  level: ViewLevel
  /** Role-list scope: the rack(s) currently in view (per-level). */
  racks: SiteRack[]
  /** Specs-range scope: site-wide racks, so the gradient stays consistent across levels. */
  metricRacks?: SiteRack[]
  colorMode: ColorMode
  onColorMode: (mode: ColorMode) => void
  highlightedRoles: Set<string>
  onToggleRole: (name: string) => void
  onClearRoles: () => void
  specsMetric: SpecMetric | null
  onSpecsMetric: (metric: SpecMetric | null) => void
  powerVisible: boolean
  onTogglePower: () => void
  connectivityVisible: boolean
  onToggleConnectivity: () => void
  dcLinksVisible: boolean
  onToggleDcLinks: () => void
}) {
  const specsRacks = metricRacks ?? racks
  const roles = useMemo(() => collectSiteRoles(racks), [racks])
  const metrics = useMemo(() => availableMetrics(specsRacks), [specsRacks])

  // Only offer dimensions whose data is present in this site.
  const colorOptions: ColorOption[] = [{ mode: 'none', label: 'None' }]
  if (roles.length > 0) colorOptions.push({ mode: 'role', label: 'Role' })
  if (metrics.length > 0) colorOptions.push({ mode: 'specs', label: 'Specs' })

  const selectColor = (mode: ColorMode) => {
    // Entering Specs with no metric chosen yet lands on the first available one,
    // so the radio selection visibly colors something immediately.
    if (mode === 'specs' && !specsMetric && metrics.length > 0) onSpecsMetric(metrics[0]!)
    onColorMode(mode)
  }

  return (
    <div style={panelStyle}>
      <div style={sectionLabel}>Color by</div>
      {colorOptions.map((opt) => {
        const on = colorMode === opt.mode
        return (
          <button key={opt.mode} onClick={() => selectColor(opt.mode)} style={optionRow}>
            <span style={dot(on)} />
            <span style={{ flex: 1, color: theme.text.primary }}>{opt.label}</span>
          </button>
        )
      })}

      {colorMode === 'role' && (
        <div style={{ marginTop: 6 }}>
          <RoleLegend
            racks={racks}
            highlighted={highlightedRoles}
            onToggle={onToggleRole}
            onClear={onClearRoles}
            embedded
          />
        </div>
      )}
      {colorMode === 'specs' && (
        <div style={{ marginTop: 6 }}>
          <SpecsHeatmapLegend racks={specsRacks} metric={specsMetric} onSelect={onSpecsMetric} embedded />
        </div>
      )}

      <div style={divider} />
      <div style={sectionLabel}>Overlays</div>
      <button onClick={onTogglePower} style={optionRow} title="A/B power: PDU rails + cords (rack), strips + panels (room)">
        <span style={check(powerVisible)} />
        <span style={{ flex: 1, color: theme.text.primary }}>Power</span>
      </button>
      {level === 'rack' && (
        <button onClick={onToggleConnectivity} style={optionRow} title="server↔leaf and OOB cabling">
          <span style={check(connectivityVisible)} />
          <span style={{ flex: 1, color: theme.text.primary }}>Connectivity</span>
        </button>
      )}
      {level === 'site' && (
        <button onClick={onToggleDcLinks} style={optionRow} title="labelled inter-DC circuit links toward peer sites">
          <span style={check(dcLinksVisible)} />
          <span style={{ flex: 1, color: theme.text.primary }}>DC links</span>
        </button>
      )}
    </div>
  )
}
