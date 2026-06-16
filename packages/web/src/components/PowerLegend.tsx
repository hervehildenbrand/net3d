import { useMemo } from 'react'
import { collectSitePower, railColor } from '../lib/powerOverlay'
import type { SitePower, SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  right: 16,
  zIndex: 20,
  width: 230,
  background: theme.hud.background,
  border: `1px solid ${theme.hud.border}`,
  borderRadius: 8,
  boxShadow: theme.hud.shadow,
  padding: 10,
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
}

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '2px 0',
  color: theme.text.secondary,
}

const swatch = (color: string): React.CSSProperties => ({
  width: 12,
  height: 12,
  borderRadius: 3,
  flexShrink: 0,
  display: 'inline-block',
  background: color,
})

/**
 * Room-view power legend (shown while the power overlay is on): the A/B feeds,
 * their electrical spec, and the PDU/feed/rack counts. When a panel is selected
 * it also shows the traced chain's impact (racks + devices) with a clear action.
 */
export function PowerLegend({
  racks,
  power,
  chain = null,
  onClearChain,
}: {
  racks: SiteRack[]
  power?: SitePower
  /** Active power-chain trace: the impact set of the selected panel. */
  chain?: { sourceName: string; rackCount: number; deviceCount: number } | null
  onClearChain?: () => void
}) {
  const s = useMemo(() => collectSitePower(racks, power), [racks, power])
  if (s.pduCount === 0) return null

  const spec =
    s.voltage != null
      ? `${s.voltage}V${s.phase ? ` ${s.phase}` : ''}${s.amperage != null ? ` · ${s.amperage}A` : ''}`
      : null

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, color: theme.text.primary, marginBottom: 8 }}>Power (A/B redundant)</div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={swatch(railColor('A'))} /> Feed A
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={swatch(railColor('B'))} /> Feed B
        </span>
      </div>
      {spec && (
        <div style={{ ...row, color: theme.text.primary }}>
          <span>feed spec</span>
          <span>{spec}</span>
        </div>
      )}
      <div style={row}>
        <span>panels</span>
        <span>{s.panelCount}</span>
      </div>
      <div style={row}>
        <span>feeds</span>
        <span>{s.feedCount}</span>
      </div>
      <div style={row}>
        <span>vertical PDUs</span>
        <span>{s.pduCount}</span>
      </div>
      <div style={{ borderTop: `1px solid ${theme.hud.border}`, marginTop: 8, paddingTop: 8 }}>
        {chain ? (
          <>
            <div style={{ ...row, color: theme.text.primary, fontWeight: 600 }}>
              <span>⚡ {chain.sourceName}</span>
              {onClearChain && (
                <button
                  onClick={onClearChain}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: theme.hud.accent,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    padding: 0,
                  }}
                >
                  clear
                </button>
              )}
            </div>
            <div style={row}>
              <span>racks fed</span>
              <span>{chain.rackCount}</span>
            </div>
            <div style={row}>
              <span>devices affected</span>
              <span>{chain.deviceCount}</span>
            </div>
          </>
        ) : (
          <div style={{ color: theme.text.muted, fontSize: 12 }}>click a panel to trace its power chain</div>
        )}
      </div>
    </div>
  )
}
