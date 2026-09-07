import { useId, useMemo, useState } from 'react'
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
  indexedSites,
  totalSites,
  prewarmEnabled,
  isLoading,
  isError,
  onSelect,
}: {
  devices: DeviceIndexEntry[]
  indexedSites: number
  totalSites: number
  prewarmEnabled: boolean
  isLoading: boolean
  isError: boolean
  onSelect: (entry: DeviceIndexEntry) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listId = useId()

  const matches = useMemo(() => filterDevices(devices, query), [devices, query])
  const showDropdown = open && query.trim().length > 0
  const partial = indexedSites < totalSites
  const status = isError
    ? devices.length > 0
      ? 'refresh failed; showing cached results'
      : 'device index unavailable'
    : partial
      ? `${indexedSites} of ${totalSites} sites indexed${prewarmEnabled ? '' : '; prewarm disabled'}`
      : null

  const select = (device: DeviceIndexEntry) => {
    onSelect(device)
    setQuery('')
    setOpen(false)
    setActiveIndex(-1)
  }

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
        role="combobox"
        aria-label="Find device"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listId : undefined}
        aria-activedescendant={showDropdown && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        aria-busy={isLoading}
        value={query}
        placeholder={isLoading ? 'loading device index…' : `find device… (${devices.length} indexed)`}
        onChange={(e) => { setQuery(e.target.value); setActiveIndex(-1); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActiveIndex(-1) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            setActiveIndex((index) => matches.length === 0 ? -1 :
              index < 0 ? (e.key === 'ArrowDown' ? 0 : matches.length - 1) :
                (index + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
          } else if (e.key === 'Enter' && showDropdown && matches[activeIndex]) {
            e.preventDefault()
            select(matches[activeIndex]!)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
            setActiveIndex(-1)
          }
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#ffffff',
          color: '#1e293b',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          padding: '7px 10px',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.1)',
        }}
      />
      {status && (
        <div role="status" style={{ padding: '4px 10px 0', color: isError ? '#b91c1c' : '#64748b' }}>{status}</div>
      )}
      {showDropdown && (
        <div
          id={listId}
          role="listbox"
          aria-label="Devices"
          style={{
            marginTop: 4,
            background: 'rgba(255, 255, 255, 0.97)',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
          }}
        >
          {matches.map((d, index) => (
            <div
              key={`${d.siteName}/${d.id}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => { e.preventDefault(); select(d) }}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                color: '#1e293b',
                borderBottom: '1px solid #e2e8f0',
                background: index === activeIndex ? '#f1f5f9' : 'transparent',
              }}
              onMouseEnter={() => setActiveIndex(index)}
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
