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
          background: '#ffffff',
          color: '#1e293b',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          padding: '7px 10px',
          outline: 'none',
        }}
      />
      {open && (
        <div
          style={{
            marginTop: 4,
            background: 'rgba(255, 255, 255, 0.97)',
            border: '1px solid #cbd5e1',
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
                color: '#1e293b',
                borderBottom: '1px solid #e2e8f0',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>
                {s.name}
                {s.latitude === null && <span style={{ color: '#cbd5e1', marginLeft: 6 }}>⌀ geo</span>}
              </span>
              <span style={{ color: '#64748b' }}>{s.region ?? ''}</span>
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
