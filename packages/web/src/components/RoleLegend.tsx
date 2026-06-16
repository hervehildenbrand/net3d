import { useMemo } from 'react'
import { collectSiteRoles } from '../lib/roleHighlight'
import type { SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'

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

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 2px',
  fontFamily: 'inherit',
  fontSize: 13,
}

const swatch: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 3,
  flexShrink: 0,
  display: 'inline-block',
}

/**
 * Role legend: lists the device roles (with placeable counts) and toggles which
 * ones are highlighted — across the racks in the room view, or within the single
 * rack in the rack view. Multiple roles can be selected at once. Empty when the
 * given racks hold no rack-mounted devices.
 */
export function RoleLegend({
  racks,
  highlighted,
  onToggle,
  onClear,
}: {
  racks: SiteRack[]
  highlighted: Set<string>
  onToggle: (name: string) => void
  onClear: () => void
}) {
  const roles = useMemo(() => collectSiteRoles(racks), [racks])
  if (roles.length === 0) return null

  return (
    <div style={panelStyle}>
      <div style={headerRow}>
        <span style={{ fontWeight: 600, color: theme.text.primary }}>Highlight role</span>
        {highlighted.size > 0 && (
          <button onClick={onClear} style={clearBtn}>
            clear
          </button>
        )}
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {roles.map((r) => {
          const on = highlighted.has(r.name)
          return (
            <button
              key={r.name}
              onClick={() => onToggle(r.name)}
              title={`${r.count} ${r.name} device${r.count === 1 ? '' : 's'}`}
              style={{ ...rowStyle, opacity: highlighted.size === 0 || on ? 1 : 0.45 }}
            >
              <span
                style={{
                  ...swatch,
                  background: `#${r.color}`,
                  outline: on ? `2px solid ${theme.hud.accent}` : 'none',
                  outlineOffset: 1,
                }}
              />
              <span style={{ flex: 1, textAlign: 'left', color: theme.text.primary }}>{r.name}</span>
              <span style={{ color: theme.text.muted }}>{r.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
