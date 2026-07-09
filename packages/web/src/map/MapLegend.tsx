import { theme } from '../theme'
import { markerColorsForRole } from './markerColors'
import { useAppStore } from '../store/useAppStore'
import { SITES_MENU_WIDTH } from '../components/SitesMenu'

const box: React.CSSProperties = {
  position: 'absolute',
  bottom: 18,
  left: 12,
  zIndex: 500,
  background: theme.hud.background,
  border: `1px solid ${theme.hud.border}`,
  borderRadius: 8,
  boxShadow: theme.hud.shadow,
  padding: '8px 10px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  color: theme.text.primary,
  pointerEvents: 'none',
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }

function Dot({ role }: { role: 'compute' | 'pop' | null }) {
  const c = markerColorsForRole(role)
  return (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: c.fill,
        border: `2px solid ${c.color}`,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
}

/** Static key for the world-map markers and inter-DC links. */
export function MapLegend() {
  // Clear the sites menu when it's open (the collapsed ☰ only occupies the top-left).
  const sitesMenuOpen = useAppStore((s) => s.sitesMenuOpen)
  return (
    <div style={{ ...box, left: sitesMenuOpen ? SITES_MENU_WIDTH + 12 : 12 }}>
      <div style={row}>
        <Dot role="compute" />
        <span>Compute</span>
      </div>
      <div style={row}>
        <Dot role="pop" />
        <span>PoP</span>
      </div>
      <div style={row}>
        <Dot role={null} />
        <span>Other</span>
      </div>
      <div style={{ ...row, marginTop: 2 }}>
        <span
          style={{ width: 14, height: 3, background: theme.map.circuit, display: 'inline-block', flexShrink: 0 }}
        />
        <span style={{ color: theme.text.secondary }}>DC link</span>
      </div>
    </div>
  )
}
