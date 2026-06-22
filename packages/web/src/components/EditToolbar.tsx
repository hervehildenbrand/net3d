import { useEffect, useRef } from 'react'
import {
  SITE_LAYOUT_VERSION,
  validateLayoutInput,
  type FloorDimensions,
  type LayoutRoom,
  type RackPlacement,
  type SiteLayout,
} from '@net3d/shared'
import { useEditStore } from '../store/useEditStore'
import { useLayoutCapability, useSaveLayout } from '../hooks/useSiteLayout'

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

// Drawing affordance banner — top-center, click-through so it never eats the drag.
const hint: React.CSSProperties = {
  position: 'absolute',
  top: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 20,
  background: 'rgba(8,145,178,0.95)',
  color: '#ffffff',
  borderRadius: 8,
  padding: '8px 14px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
  boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
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
export function EditToolbar({
  siteName,
  placements,
  rooms,
  floor,
}: {
  siteName: string
  placements: RackPlacement[]
  rooms: LayoutRoom[]
  floor: FloorDimensions | null
}) {
  const { canEdit, canSave } = useLayoutCapability()
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
  const addRoomMode = useEditStore((s) => s.addRoomMode)
  const setAddRoomMode = useEditStore((s) => s.setAddRoomMode)
  const selectedRoomId = useEditStore((s) => s.selectedRoomId)
  const deleteSelectedRoom = useEditStore((s) => s.deleteSelectedRoom)
  const workingFloor = useEditStore((s) => s.floor)
  const setFloor = useEditStore((s) => s.setFloor)
  const buildLayoutPayload = useEditStore((s) => s.buildLayoutPayload)
  const markSaved = useEditStore((s) => s.markSaved)
  const revert = useEditStore((s) => s.revert)
  const importLayout = useEditStore((s) => s.importLayout)
  const save = useSaveLayout()
  const fileInput = useRef<HTMLInputElement>(null)

  // Keyboard while editing (ignored in text inputs): 'R' rotates the selected rack,
  // 'Esc' cancels add-room mode (unmounting RoomDrawer, which re-enables orbit).
  useEffect(() => {
    if (!editModeActive) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'r' || e.key === 'R') rotateSelected()
      else if (e.key === 'Escape' && addRoomMode) setAddRoomMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editModeActive, rotateSelected, addRoomMode, setAddRoomMode])

  // Warn before a tab close / reload drops unsaved layout edits (only when saving
  // is possible — in sandbox mode edits are ephemeral by design, no warning).
  useEffect(() => {
    if (!editModeActive || !dirty || !canSave) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [editModeActive, dirty, canSave])

  if (!canEdit) return null

  if (!editModeActive) {
    return (
      <button style={{ ...bar, ...btn }} onClick={() => enterEditMode(placements, rooms, floor)}>
        ✎ Edit layout
      </button>
    )
  }

  const onFloorChange = (key: 'width' | 'depth', raw: string) => {
    const v = parseFloat(raw)
    const base = workingFloor ?? { width: 20, depth: 20 }
    if (!Number.isFinite(v) || v <= 0) return
    setFloor({ ...base, [key]: v })
  }

  const onSave = () =>
    save.mutate({ siteName, layout: buildLayoutPayload() }, { onSuccess: () => markSaved() })

  const onDone = () => {
    if (canSave && dirty && !window.confirm('Discard unsaved layout changes?')) return
    exitEditMode()
  }

  const onRevert = () => {
    if (!dirty || !window.confirm('Discard unsaved layout changes?')) return
    revert()
  }

  const onExport = () => {
    const layout: SiteLayout = {
      version: SITE_LAYOUT_VERSION,
      updatedAt: new Date().toISOString(),
      ...buildLayoutPayload(),
    }
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${siteName}-layout.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Partial<SiteLayout>
      const payload = {
        racks: parsed.racks,
        rooms: parsed.rooms,
        floor: parsed.floor ?? null,
      }
      const invalid = validateLayoutInput(payload)
      if (invalid) {
        window.alert(`Could not import: ${invalid}.`)
        return
      }
      importLayout({
        version: SITE_LAYOUT_VERSION,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        racks: payload.racks!,
        rooms: payload.rooms!,
        floor: payload.floor,
      })
    } catch {
      window.alert('Could not import: not a valid layout JSON file.')
    }
  }

  return (
    <>
      {addRoomMode && <div style={hint}>Drag on the floor to draw a room · Esc to cancel</div>}
      <div style={bar}>
      <strong style={{ whiteSpace: 'nowrap' }}>edit · {siteName}</strong>
      {!canSave && (
        <span
          style={{ color: '#0891b2', fontStyle: 'italic', whiteSpace: 'nowrap' }}
          title="Try it out — your changes are local and won't be saved"
        >
          sandbox · not saved
        </span>
      )}
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
      <button
        style={addRoomMode ? activeBtn : btn}
        onClick={() => setAddRoomMode(!addRoomMode)}
        title="Draw a room/zone rectangle on the floor"
      >
        {addRoomMode ? 'drawing…' : 'add room'}
      </button>
      {selectedRoomId && (
        <button style={btn} onClick={deleteSelectedRoom} title="Delete the selected room">
          delete room
        </button>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Explicit floor size (blank = auto-fit)">
        floor
        <input
          type="number"
          min={1}
          step={1}
          placeholder="W"
          value={workingFloor?.width ?? ''}
          onChange={(e) => onFloorChange('width', e.target.value)}
          style={{ ...btn, width: 52, padding: '4px 6px' }}
        />
        ×
        <input
          type="number"
          min={1}
          step={1}
          placeholder="D"
          value={workingFloor?.depth ?? ''}
          onChange={(e) => onFloorChange('depth', e.target.value)}
          style={{ ...btn, width: 52, padding: '4px 6px' }}
        />
        {workingFloor && (
          <button style={{ ...btn, padding: '4px 6px' }} onClick={() => setFloor(null)} title="Auto-fit floor">
            auto
          </button>
        )}
      </label>
      <button style={topDownView ? activeBtn : btn} onClick={toggleTopDownView}>
        {topDownView ? 'top-down ✓' : 'top-down'}
      </button>
      {canSave && (
        <button style={{ ...btn, opacity: !dirty || save.isPending ? 0.5 : 1 }} onClick={onSave} disabled={!dirty || save.isPending}>
          {save.isPending ? 'saving…' : 'save'}
        </button>
      )}
      <button style={{ ...btn, opacity: dirty ? 1 : 0.5 }} onClick={onRevert} disabled={!dirty} title="Discard changes">
        revert
      </button>
      <button style={btn} onClick={onExport} title="Download this layout as JSON">
        export
      </button>
      <button style={btn} onClick={() => fileInput.current?.click()} title="Load a layout from a JSON file">
        import
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        onChange={onImportFile}
        style={{ display: 'none' }}
      />
      <button style={btn} onClick={onDone}>
        done
      </button>
      {save.isError && <span style={{ color: '#b91c1c' }}>save failed</span>}
      </div>
    </>
  )
}
