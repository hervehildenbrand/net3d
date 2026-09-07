import { useId, useMemo, useState } from 'react'
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
  const [activeIndex, setActiveIndex] = useState(-1)
  const listId = useId()

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? sites.filter(
          (s) => s.name.toLowerCase().includes(q) || s.region?.toLowerCase().includes(q),
        )
      : sites
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12)
  }, [sites, query])

  const select = (name: string) => {
    onSelect(name)
    setQuery('')
    setOpen(false)
    setActiveIndex(-1)
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 56,
        right: 16,
        width: 230,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
        zIndex: 20,
      }}
    >
      <input
        role="combobox"
        aria-label="Find site"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        value={query}
        placeholder={`find site… (${sites.length} sites)`}
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
          } else if (e.key === 'Enter' && open && matches[activeIndex]) {
            e.preventDefault()
            select(matches[activeIndex]!.name)
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
        }}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Sites"
          style={{
            marginTop: 4,
            background: 'rgba(255, 255, 255, 0.97)',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {matches.map((s, index) => (
            <div
              key={s.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => { e.preventDefault(); select(s.name) }}
              style={{
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                color: '#1e293b',
                borderBottom: '1px solid #e2e8f0',
                background: index === activeIndex ? '#f1f5f9' : 'transparent',
              }}
              onMouseEnter={() => setActiveIndex(index)}
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
