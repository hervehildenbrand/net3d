import { useMemo, useState } from 'react'
import type { Site } from '../hooks/useSites'

export function SiteSearch({
  sites,
  onSelect,
}: {
  sites: Site[]
  onSelect: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? sites.filter(
          (s) => s.name.toLowerCase().includes(q) || s.region?.toLowerCase().includes(q),
        )
      : sites
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12)
  }, [sites, query])

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: 230,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
      }}
    >
      <input
        value={query}
        placeholder="find site… (79 total)"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#0d1b2a',
          color: '#cfe8ff',
          border: '1px solid #2a4a6a',
          borderRadius: 6,
          padding: '7px 10px',
          outline: 'none',
        }}
      />
      {open && (
        <div
          style={{
            marginTop: 4,
            background: 'rgba(10, 20, 32, 0.97)',
            border: '1px solid #2a4a6a',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {matches.map((s) => (
            <div
              key={s.id}
              onMouseDown={() => {
                onSelect(s.name)
                setQuery('')
                setOpen(false)
              }}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                color: '#cfe8ff',
                borderBottom: '1px solid #16293d',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#16314d')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>
                {s.name}
                {s.latitude === null && <span style={{ color: '#557', marginLeft: 6 }}>⌀ geo</span>}
              </span>
              <span style={{ color: '#6f93b4' }}>{s.region ?? ''}</span>
            </div>
          ))}
          {matches.length === 0 && (
            <div style={{ padding: '6px 10px', color: '#5d83a6' }}>no match</div>
          )}
        </div>
      )}
    </div>
  )
}
