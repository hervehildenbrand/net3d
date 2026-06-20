import { useMemo } from 'react'
import { availableMetrics, type SpecMetric } from '../lib/specsHeatmap'
import { collectSiteRoles } from '../lib/roleHighlight'
import { collectStatuses, statusColor } from '../lib/statusColors'
import { subnetColor } from '../lib/subnetColoring'
import type { SiteRack } from '../hooks/useSiteDetail'
import type { CableColorMode, ColorMode, ViewLevel } from '../store/useAppStore'
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

const clearBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: theme.hud.accent,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
  padding: 0,
}

const swatchBox: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 3,
  flexShrink: 0,
  display: 'inline-block',
}

const segBtn: React.CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${theme.hud.border}`,
  borderRadius: 6,
  color: theme.text.secondary,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '2px 8px',
}

const segOn: React.CSSProperties = {
  background: theme.hud.accent,
  color: '#ffffff',
  borderColor: theme.hud.accent,
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
  hiddenStatuses,
  onToggleHiddenStatus,
  subnets,
  cableColorMode,
  onCableColorMode,
  powerVisible,
  onTogglePower,
  connectivityVisible,
  onToggleConnectivity,
  dcLinksVisible,
  onToggleDcLinks,
  ipLabelsVisible,
  onToggleIpLabels,
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
  hiddenStatuses: Set<string>
  onToggleHiddenStatus: (status: string) => void
  /** Site-wide subnets (network/prefix) present, for the Subnet color mode + legend. */
  subnets: string[]
  cableColorMode: CableColorMode
  onCableColorMode: (mode: CableColorMode) => void
  powerVisible: boolean
  onTogglePower: () => void
  connectivityVisible: boolean
  onToggleConnectivity: () => void
  dcLinksVisible: boolean
  onToggleDcLinks: () => void
  ipLabelsVisible: boolean
  onToggleIpLabels: () => void
}) {
  const specsRacks = metricRacks ?? racks
  const roles = useMemo(() => collectSiteRoles(racks), [racks])
  const metrics = useMemo(() => availableMetrics(specsRacks), [specsRacks])
  const statuses = useMemo(() => collectStatuses(racks), [racks])

  // Only offer dimensions whose data is present at this level.
  const colorOptions: ColorOption[] = [{ mode: 'none', label: 'None' }]
  if (roles.length > 0) colorOptions.push({ mode: 'role', label: 'Role' })
  if (metrics.length > 0) colorOptions.push({ mode: 'specs', label: 'Specs' })
  colorOptions.push({ mode: 'capacity', label: 'Capacity' })
  // Status is per-device (rack view only); Subnet works at both levels (room view
  // tints racks by their dominant subnet, rack view tints each device box).
  if (level === 'rack' && statuses.length > 0) colorOptions.push({ mode: 'status', label: 'Status' })
  if (subnets.length > 0) colorOptions.push({ mode: 'subnet', label: 'Subnet' })

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
      {colorMode === 'capacity' && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              height: 10,
              borderRadius: 3,
              background: `linear-gradient(to right, ${theme.heatmap.low}, ${theme.heatmap.mid}, ${theme.heatmap.high})`,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: theme.text.muted, fontSize: 11, marginTop: 2 }}>
            <span>empty</span>
            <span>full</span>
          </div>
          <div style={{ color: theme.text.muted, fontSize: 11, marginTop: 6 }}>
            {level === 'rack' ? 'free U spans marked in the rack' : 'racks tinted by U-fill'}
          </div>
        </div>
      )}
      {colorMode === 'status' && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: theme.text.muted, fontSize: 11 }}>click to hide a status</span>
            {hiddenStatuses.size > 0 && (
              <button onClick={() => statuses.forEach((s) => hiddenStatuses.has(s) && onToggleHiddenStatus(s))} style={clearBtn}>
                show all
              </button>
            )}
          </div>
          {statuses.map((s) => {
            const hidden = hiddenStatuses.has(s)
            return (
              <button key={s} onClick={() => onToggleHiddenStatus(s)} style={{ ...optionRow, opacity: hidden ? 0.4 : 1 }}>
                <span style={{ ...swatchBox, background: statusColor(s) }} />
                <span style={{ flex: 1, color: theme.text.primary, textDecoration: hidden ? 'line-through' : 'none' }}>{s}</span>
              </button>
            )
          })}
        </div>
      )}
      {colorMode === 'subnet' && (
        <div style={{ marginTop: 6, maxHeight: 180, overflowY: 'auto' }}>
          {subnets.map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px' }}>
              <span style={{ ...swatchBox, background: subnetColor(s, subnets) }} />
              <span style={{ flex: 1, color: theme.text.primary }}>{s}</span>
            </div>
          ))}
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
      {level === 'rack' && (
        <button onClick={onToggleIpLabels} style={optionRow} title="label each device with its primary IP">
          <span style={check(ipLabelsVisible)} />
          <span style={{ flex: 1, color: theme.text.primary }}>IP labels</span>
        </button>
      )}
      {level === 'rack' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, padding: '3px 2px' }}>
          <span style={{ color: theme.text.primary }}>Cables</span>
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }} title="color rack cables by physical medium or by interface line rate">
            {(['medium', 'speed'] as CableColorMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onCableColorMode(m)}
                style={{ ...segBtn, ...(cableColorMode === m ? segOn : {}) }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
