import { useMemo, useState } from 'react'
import { filterDevices, type DeviceIndexEntry } from '../lib/deviceSearch'

/**
 * Global device finder. Type a device name (or site/rack/role/model) to get a
 * ranked autocomplete; selecting an entry asks the app to zoom to that device in
 * its rack. Persistent and top-center so it's reachable at every level without
 * colliding with the HUD (top-left), switcher/legends (top-right), or the device
 * panel (right). zIndex must clear the canvas (z2); 20 matches the other HUD.
 */
export function DeviceSearch({
  devices,
  onSelect,
}: {
  devices: DeviceIndexEntry[]
  onSelect: (entry: DeviceIndexEntry) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => filterDevices(devices, query), [devices, query])
  const showDropdown = open && query.trim().length > 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 320,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
        zIndex: 20,
      }}
    >
      <input
        value={query}
        placeholder={`find device… (${devices.length} total)`}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#ffffff',
          color: '#1e293b',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          padding: '7px 10px',
          outline: 'none',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.1)',
        }}
      />
      {showDropdown && (
        <div
          style={{
            marginTop: 4,
            background: 'rgba(255, 255, 255, 0.97)',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
          }}
        >
          {matches.map((d) => (
            <div
              key={`${d.siteName}/${d.id}`}
              onMouseDown={() => {
                onSelect(d)
                setQuery('')
                setOpen(false)
              }}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                color: '#1e293b',
                borderBottom: '1px solid #e2e8f0',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: `#${d.roleColor}`,
                    flex: '0 0 auto',
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.name}
                </span>
              </span>
              <span style={{ color: '#64748b', flex: '0 0 auto' }}>
                {d.siteName} / {d.rackName}
              </span>
            </div>
          ))}
          {matches.length === 0 && (
            <div style={{ padding: '6px 10px', color: '#94a3b8' }}>no match</div>
          )}
        </div>
      )}
    </div>
  )
}
