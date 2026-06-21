import { useEffect } from 'react'
import type { RackPlacement } from '@net3d/shared'
import { useEditStore } from '../store/useEditStore'
import { useLayoutEditable, useSaveLayout } from '../hooks/useSiteLayout'

const bar: React.CSSProperties = {
  position: 'absolute',
  bottom: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 20, // above the R3F canvas (zIndex 2) so the controls receive clicks
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'rgba(255,255,255,0.96)',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  padding: '8px 12px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
  color: '#1e293b',
}

const btn: React.CSSProperties = {
  background: '#ffffff',
  color: '#1e293b',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '6px 12px',
  cursor: 'pointer',
}

const activeBtn: React.CSSProperties = { ...btn, background: '#0891b2', color: '#ffffff', borderColor: '#0891b2' }

const GRID_OPTIONS = [
  { label: 'free', value: 0 },
  { label: '0.25m', value: 0.25 },
  { label: '0.5m', value: 0.5 },
  { label: 'rack', value: 0.75 },
]

/**
 * Floor-plan editor toolbar (site level). Hidden entirely unless the server
 * advertises layoutEditable, so the default read-only deploy shows nothing.
 */
export function EditToolbar({ siteName, placements }: { siteName: string; placements: RackPlacement[] }) {
  const editable = useLayoutEditable()
  const editModeActive = useEditStore((s) => s.editModeActive)
  const enterEditMode = useEditStore((s) => s.enterEditMode)
  const exitEditMode = useEditStore((s) => s.exitEditMode)
  const dirty = useEditStore((s) => s.dirty)
  const gridSnap = useEditStore((s) => s.gridSnap)
  const setGridSnap = useEditStore((s) => s.setGridSnap)
  const topDownView = useEditStore((s) => s.topDownView)
  const toggleTopDownView = useEditStore((s) => s.toggleTopDownView)
  const selectedRackId = useEditStore((s) => s.selectedRackId)
  const rotateSelected = useEditStore((s) => s.rotateSelected)
  const buildLayoutPayload = useEditStore((s) => s.buildLayoutPayload)
  const markSaved = useEditStore((s) => s.markSaved)
  const save = useSaveLayout()

  // 'R' rotates the selected rack while editing (ignored in text inputs).
  useEffect(() => {
    if (!editModeActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      rotateSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editModeActive, rotateSelected])

  if (!editable) return null

  if (!editModeActive) {
    return (
      <button style={{ ...bar, ...btn }} onClick={() => enterEditMode(placements)}>
        ✎ Edit layout
      </button>
    )
  }

  const onSave = () =>
    save.mutate({ siteName, layout: buildLayoutPayload() }, { onSuccess: () => markSaved() })

  return (
    <div style={bar}>
      <strong>edit · {siteName}</strong>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        grid
        <select
          value={gridSnap}
          onChange={(e) => setGridSnap(parseFloat(e.target.value))}
          style={{ ...btn, padding: '4px 6px' }}
        >
          {GRID_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        style={{ ...btn, opacity: selectedRackId ? 1 : 0.5 }}
        onClick={rotateSelected}
        disabled={!selectedRackId}
        title="Rotate the selected rack 90° (R)"
      >
        rotate
      </button>
      <button style={topDownView ? activeBtn : btn} onClick={toggleTopDownView}>
        {topDownView ? 'top-down ✓' : 'top-down'}
      </button>
      <button style={{ ...btn, opacity: !dirty || save.isPending ? 0.5 : 1 }} onClick={onSave} disabled={!dirty || save.isPending}>
        {save.isPending ? 'saving…' : 'save'}
      </button>
      <button style={btn} onClick={exitEditMode}>
        done
      </button>
      {save.isError && <span style={{ color: '#b91c1c' }}>save failed</span>}
    </div>
  )
}
