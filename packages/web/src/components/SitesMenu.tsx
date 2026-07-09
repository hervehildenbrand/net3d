import type { Site } from '../hooks/useSites'
import { useAppStore } from '../store/useAppStore'
import { theme } from '../theme'

/** Group label for sites whose backend has no region set. */
export const NO_REGION = '(no region)'

/** Group sites by region; regions alphabetical (NO_REGION last), sites alphabetical within. */
export function groupSitesByRegion(sites: Site[]): Map<string, Site[]> {
  const groups = new Map<string, Site[]>()
  for (const s of sites) {
    const key = s.region ?? NO_REGION
    const arr = groups.get(key)
    if (arr) arr.push(s)
    else groups.set(key, [s])
  }
  const keys = [...groups.keys()].sort((a, b) =>
    a === NO_REGION ? 1 : b === NO_REGION ? -1 : a.localeCompare(b),
  )
  const sorted = new Map<string, Site[]>()
  for (const k of keys)
    sorted.set(k, groups.get(k)!.sort((a, b) => a.name.localeCompare(b.name)))
  return sorted
}

/** Panel width; App offsets its left-stacked HUD elements by this when open. */
export const SITES_MENU_WIDTH = 220
/** Left offset clearing the collapsed ☰ button (8 + 28 + 20). */
export const SITES_MENU_COLLAPSED_OFFSET = 56

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  width: SITES_MENU_WIDTH,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  background: theme.hud.background,
  borderRight: `1px solid ${theme.hud.border}`,
  boxShadow: theme.hud.shadow,
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 12px 8px',
  borderBottom: `1px solid ${theme.hud.border}`,
  fontWeight: 600,
  color: theme.text.primary,
}

const regionStyle: React.CSSProperties = {
  padding: '8px 12px 3px',
  color: theme.text.muted,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const siteRowStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px 4px 20px',
  cursor: 'pointer',
  color: active ? theme.hud.accent : theme.text.primary,
  background: active ? '#e0f2fe' : 'transparent',
})

const openBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 8,
  width: 28,
  height: 28,
  zIndex: 20,
  background: theme.hud.background,
  border: `1px solid ${theme.hud.border}`,
  borderRadius: 6,
  boxShadow: theme.hud.shadow,
  cursor: 'pointer',
  color: theme.text.primary,
  fontSize: 14,
  lineHeight: 1,
}

/** Left sidebar: all sites grouped by region; clicking one flies into its floor plan. */
export function SitesMenu({ sites }: { sites: Site[] }) {
  const open = useAppStore((s) => s.sitesMenuOpen)
  const toggle = useAppStore((s) => s.toggleSitesMenu)
  const zoomToSite = useAppStore((s) => s.zoomToSite)
  const selectedSiteName = useAppStore((s) => s.selectedSiteName)

  if (!open) {
    return (
      <button onClick={toggle} style={openBtnStyle} title="Show sites menu" aria-label="Show sites menu">
        ☰
      </button>
    )
  }

  return (
    <div style={menuStyle}>
      <div style={headerStyle}>
        <span>sites</span>
        <button
          onClick={toggle}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.text.muted, fontSize: 15, lineHeight: 1, padding: 2 }}
          title="Hide sites menu"
          aria-label="Hide sites menu"
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 8px' }}>
        {[...groupSitesByRegion(sites).entries()].map(([region, group]) => (
          <div key={region}>
            <div style={regionStyle}>{region}</div>
            {group.map((s) => (
              <div
                key={s.id}
                onClick={() => zoomToSite(s.name)}
                style={siteRowStyle(selectedSiteName === s.name)}
                onMouseEnter={(e) => {
                  if (selectedSiteName !== s.name) e.currentTarget.style.background = '#f1f5f9'
                }}
                onMouseLeave={(e) => {
                  if (selectedSiteName !== s.name) e.currentTarget.style.background = 'transparent'
                }}
              >
                {s.name}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
