import type { Site } from '../hooks/useSites'
import { theme } from '../theme'

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
      <span style={{ color: theme.text.muted }}>{k}</span>
      <span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  )
}

/** Structured hover card for a site marker on the world map. */
export function SiteTooltip({ site }: { site: Site }) {
  return (
    <div
      style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        lineHeight: 1.5,
        minWidth: 200,
        maxWidth: 280,
        color: theme.text.secondary,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <strong style={{ color: theme.text.primary, fontSize: 12 }}>{site.name}</strong>
        {site.role && (
          <span
            style={{
              fontSize: 9,
              padding: '1px 6px',
              borderRadius: 4,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              background: site.role === 'pop' ? '#ffedd5' : '#e0f2fe',
              color: site.role === 'pop' ? '#c2410c' : '#0369a1',
            }}
          >
            {site.role === 'pop' ? 'PoP' : 'Compute'}
          </span>
        )}
      </div>
      {site.region && <Row k="region" v={site.region} />}
      {site.facility && <Row k="facility" v={site.facility} />}
      {site.physicalAddress && (
        <div style={{ color: theme.text.muted, whiteSpace: 'normal', margin: '2px 0' }}>
          {site.physicalAddress}
        </div>
      )}
      {(site.rackCount !== null || site.deviceCount !== null) && (
        <div style={{ borderTop: `1px solid ${theme.hud.border}`, marginTop: 4, paddingTop: 4 }}>
          {site.rackCount !== null && <Row k="racks" v={site.rackCount} />}
          {site.deviceCount !== null && <Row k="devices" v={site.deviceCount} />}
        </div>
      )}
    </div>
  )
}
