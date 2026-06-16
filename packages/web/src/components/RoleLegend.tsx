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
 * Role legend: lists the device roles (with placeable counts) and their colors.
 *
 * Two modes:
 * - interactive (room view): each row toggles highlighting of that role across
 *   the racks; a "clear" button resets.
 * - readOnly (rack view): a plain color key — swatch + name + count — so a user
 *   looking at a single rack can tell what the device colors mean.
 *
 * Empty when the given racks hold no rack-mounted devices.
 */
export function RoleLegend({
  racks,
  highlighted,
  onToggle,
  onClear,
  readOnly = false,
  title = 'Highlight role',
}: {
  racks: SiteRack[]
  highlighted?: Set<string>
  onToggle?: (name: string) => void
  onClear?: () => void
  /** Render a non-interactive color key (no toggle/clear/dimming). */
  readOnly?: boolean
  title?: string
}) {
  const roles = useMemo(() => collectSiteRoles(racks), [racks])
  if (roles.length === 0) return null

  const active = !readOnly && (highlighted?.size ?? 0) > 0

  return (
    <div style={panelStyle}>
      <div style={headerRow}>
        <span style={{ fontWeight: 600, color: theme.text.primary }}>{title}</span>
        {active && (
          <button onClick={onClear} style={clearBtn}>
            clear
          </button>
        )}
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {roles.map((r) => {
          const on = !readOnly && (highlighted?.has(r.name) ?? false)
          const rowContent = (
            <>
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
            </>
          )
          if (readOnly) {
            return (
              <div
                key={r.name}
                title={`${r.count} ${r.name} device${r.count === 1 ? '' : 's'}`}
                style={{ ...rowStyle, cursor: 'default' }}
              >
                {rowContent}
              </div>
            )
          }
          return (
            <button
              key={r.name}
              onClick={() => onToggle?.(r.name)}
              title={`${r.count} ${r.name} device${r.count === 1 ? '' : 's'}`}
              style={{ ...rowStyle, opacity: active && !on ? 0.45 : 1 }}
            >
              {rowContent}
            </button>
          )
        })}
      </div>
    </div>
  )
}
