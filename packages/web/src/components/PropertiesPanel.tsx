import { useEffect, useRef, useState } from 'react'
import type { Rotation } from '@net3d/shared'
import { MIN_ROOM_M, useEditStore } from '../store/useEditStore'
import { formatArea, formatLength, fromMeters, toMeters, unitLabel, type LengthUnit } from '../lib/units'

const DEFAULT_ROOM_COLOR = '#0891b2'
const ROTATIONS: Rotation[] = [0, 90, 180, 270]

const panel: React.CSSProperties = {
  position: 'absolute',
  top: 80,
  right: 16,
  zIndex: 20, // above the R3F canvas (zIndex 2) so inputs receive events
  width: 250,
  background: 'rgba(255,255,255,0.97)',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  padding: '12px 14px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  color: '#1e293b',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontWeight: 700,
}

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

const numInput: React.CSSProperties = {
  width: 72,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '4px 6px',
  fontFamily: 'inherit',
  fontSize: 12,
  textAlign: 'right',
}

const textInput: React.CSSProperties = {
  flex: 1,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '4px 6px',
  fontFamily: 'inherit',
  fontSize: 12,
}

const btn: React.CSSProperties = {
  background: '#ffffff',
  color: '#1e293b',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '4px 8px',
  cursor: 'pointer',
}

const activeBtn: React.CSSProperties = { ...btn, background: '#0891b2', color: '#ffffff', borderColor: '#0891b2' }
const closeBtn: React.CSSProperties = { ...btn, padding: '0 6px', lineHeight: 1.4 }
const readonly: React.CSSProperties = { color: '#475569' }
const unitSuffix: React.CSSProperties = { width: 18, color: '#64748b' }

/**
 * A length input that displays meters in the chosen unit and commits exact meters
 * back. Free typing is preserved (we don't reformat mid-edit); the field re-syncs to
 * the stored value on blur and whenever the underlying value/unit changes externally
 * (e.g. dragging a rack updates its coordinates live).
 */
function LengthInput({
  label,
  meters,
  unit,
  onCommit,
  minMeters,
}: {
  label: string
  meters: number
  unit: LengthUnit
  onCommit: (meters: number) => void
  minMeters?: number
}) {
  const [text, setText] = useState(() => fromMeters(meters, unit).toFixed(2))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(fromMeters(meters, unit).toFixed(2))
  }, [meters, unit])

  return (
    <label style={row}>
      <span style={readonly}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="number"
          step={0.1}
          min={minMeters !== undefined ? fromMeters(minMeters, unit) : undefined}
          value={text}
          style={numInput}
          onFocus={() => {
            focused.current = true
          }}
          onBlur={() => {
            focused.current = false
            setText(fromMeters(meters, unit).toFixed(2))
          }}
          onChange={(e) => {
            setText(e.target.value)
            const v = parseFloat(e.target.value)
            if (Number.isFinite(v)) onCommit(toMeters(v, unit))
          }}
        />
        <span style={unitSuffix}>{unitLabel(unit)}</span>
      </span>
    </label>
  )
}

function RoomProperties({ roomId, unit }: { roomId: string; unit: LengthUnit }) {
  const room = useEditStore((s) => s.workingRooms.find((r) => r.id === roomId))
  const updateRoom = useEditStore((s) => s.updateRoom)
  const deleteSelectedRoom = useEditStore((s) => s.deleteSelectedRoom)
  const selectRoom = useEditStore((s) => s.selectRoom)
  if (!room) return null

  const { x, z, width, depth } = room.bounds
  const color = room.color ?? DEFAULT_ROOM_COLOR

  return (
    <div style={panel}>
      <div style={header}>
        <span>Room</span>
        <button style={closeBtn} title="Deselect" onClick={() => selectRoom(null)}>
          ×
        </button>
      </div>

      <label style={row}>
        <span style={readonly}>name</span>
        <input
          style={textInput}
          value={room.name}
          onChange={(e) => updateRoom(roomId, { name: e.target.value })}
        />
      </label>

      <LengthInput
        label="width"
        meters={width}
        unit={unit}
        minMeters={MIN_ROOM_M}
        onCommit={(m) => updateRoom(roomId, { bounds: { width: m } })}
      />
      <LengthInput
        label="depth"
        meters={depth}
        unit={unit}
        minMeters={MIN_ROOM_M}
        onCommit={(m) => updateRoom(roomId, { bounds: { depth: m } })}
      />
      <LengthInput
        label="center X"
        meters={x}
        unit={unit}
        onCommit={(m) => updateRoom(roomId, { bounds: { x: m } })}
      />
      <LengthInput
        label="center Z"
        meters={z}
        unit={unit}
        onCommit={(m) => updateRoom(roomId, { bounds: { z: m } })}
      />

      <label style={row}>
        <span style={readonly}>color</span>
        <input
          type="color"
          value={color}
          style={{ width: 40, height: 24, border: '1px solid #cbd5e1', borderRadius: 6, padding: 0 }}
          onChange={(e) => updateRoom(roomId, { color: e.target.value })}
        />
      </label>

      <div style={{ ...row, ...readonly }}>
        <span>area</span>
        <span>{formatArea(width * depth, unit)}</span>
      </div>

      <button style={btn} onClick={deleteSelectedRoom} title="Delete this room">
        delete room
      </button>
    </div>
  )
}

function RackProperties({ rackId, unit }: { rackId: string; unit: LengthUnit }) {
  const rack = useEditStore((s) => s.workingPlacements.find((p) => p.rackId === rackId))
  const updateRackPrecise = useEditStore((s) => s.updateRackPrecise)
  const selectRack = useEditStore((s) => s.selectRack)
  if (!rack) return null

  const rot = (rack.rotationDeg ?? 0) as Rotation

  return (
    <div style={panel}>
      <div style={header}>
        <span title={rack.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {rack.name}
        </span>
        <button style={closeBtn} title="Deselect" onClick={() => selectRack(null)}>
          ×
        </button>
      </div>

      <LengthInput
        label="X"
        meters={rack.x}
        unit={unit}
        onCommit={(m) => updateRackPrecise(rackId, m, rack.z)}
      />
      <LengthInput
        label="Z"
        meters={rack.z}
        unit={unit}
        onCommit={(m) => updateRackPrecise(rackId, rack.x, m)}
      />

      <div style={row}>
        <span style={readonly}>rotation</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {ROTATIONS.map((deg) => (
            <button
              key={deg}
              style={deg === rot ? activeBtn : btn}
              onClick={() => updateRackPrecise(rackId, rack.x, rack.z, deg)}
              title={`Rotate to ${deg}°`}
            >
              {deg}°
            </button>
          ))}
        </span>
      </div>

      <div style={{ ...row, ...readonly }}>
        <span>footprint</span>
        <span>
          {formatLength(rack.width, unit)} × {formatLength(rack.depth, unit)}
        </span>
      </div>
    </div>
  )
}

/**
 * Floor-plan editor inspector: shows editable properties for the selected rack or
 * room, or a hint when nothing is selected. Rendered only in edit mode (mounted by
 * the EditToolbar). Reads the working copy directly from the edit store.
 */
export function PropertiesPanel() {
  const selectedRackId = useEditStore((s) => s.selectedRackId)
  const selectedRoomId = useEditStore((s) => s.selectedRoomId)
  const unit = useEditStore((s) => s.lengthUnit)

  if (selectedRoomId) return <RoomProperties roomId={selectedRoomId} unit={unit} />
  if (selectedRackId) return <RackProperties rackId={selectedRackId} unit={unit} />

  return (
    <div style={{ ...panel, color: '#64748b', fontStyle: 'italic' }}>
      Select a rack or room to edit its properties — or drag on the floor to draw a room.
    </div>
  )
}
