import { useMemo } from 'react'
import { availableMetrics, computeSpecsRange, type SpecMetric } from '../lib/specsHeatmap'
import type { SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'

const METRIC_LABEL: Record<SpecMetric, { label: string; unit: string }> = {
  cpuCores: { label: 'CPU cores', unit: '' },
  ramGb: { label: 'RAM', unit: ' GB' },
  storageTb: { label: 'Storage', unit: ' TB' },
  powerDrawW: { label: 'Power', unit: ' W' },
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
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

/** Embedded inside the Layers panel: inherit the host panel's chrome, just flow. */
const embeddedStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
}

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
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

const metricBtn: React.CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${theme.hud.border}`,
  borderRadius: 6,
  color: theme.text.secondary,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '3px 8px',
}

/**
 * Specs-heatmap control + legend. Lists the metrics any device populates; clicking
 * one activates the gradient (clicking the active one turns it off). Mirrors the
 * RoleLegend toggle pattern, so it doubles as the on/off control. Renders nothing
 * when no device in the site carries hardware specs.
 */
export function SpecsHeatmapLegend({
  racks,
  metric,
  onSelect,
  top = 16,
  embedded = false,
}: {
  racks: SiteRack[]
  metric: SpecMetric | null
  onSelect: (metric: SpecMetric | null) => void
  /** Top offset (px) so it can stack below the role legend at site level. */
  top?: number
  /** Render inline (no absolute panel chrome) for hosting inside the Layers panel. */
  embedded?: boolean
}) {
  const metrics = useMemo(() => availableMetrics(racks), [racks])
  const range = useMemo(() => (metric ? computeSpecsRange(racks, metric) : null), [racks, metric])
  if (metrics.length === 0) return null

  const unit = metric ? METRIC_LABEL[metric].unit : ''

  return (
    <div style={embedded ? embeddedStyle : { ...panelStyle, top }}>
      <div style={headerRow}>
        <span style={{ fontWeight: 600, color: theme.text.primary }}>Specs heatmap</span>
        {metric && (
          <button onClick={() => onSelect(null)} style={clearBtn}>
            off
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: metric ? 10 : 0 }}>
        {metrics.map((m) => {
          const on = m === metric
          return (
            <button
              key={m}
              onClick={() => onSelect(on ? null : m)}
              style={{
                ...metricBtn,
                ...(on
                  ? { background: theme.hud.accent, color: '#ffffff', borderColor: theme.hud.accent }
                  : {}),
              }}
            >
              {METRIC_LABEL[m].label}
            </button>
          )
        })}
      </div>
      {metric && range && (
        <div>
          <div
            style={{
              height: 10,
              borderRadius: 3,
              background: `linear-gradient(to right, ${theme.heatmap.low}, ${theme.heatmap.mid}, ${theme.heatmap.high})`,
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              color: theme.text.muted,
              fontSize: 11,
              marginTop: 2,
            }}
          >
            <span>{`${range.min}${unit}`}</span>
            <span>{`${range.max}${unit}`}</span>
          </div>
        </div>
      )}
    </div>
  )
}
