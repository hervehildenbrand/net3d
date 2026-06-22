const overlay: React.CSSProperties = {
  position: 'absolute',
  top: 80,
  left: 16,
  zIndex: 20, // above the R3F canvas (zIndex 2)
  width: 340,
  maxHeight: 'calc(100vh - 160px)',
  overflowY: 'auto',
  background: 'rgba(255,255,255,0.98)',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  padding: '16px 18px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  lineHeight: 1.5,
  color: '#1e293b',
}

const head: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
}

const h: React.CSSProperties = { margin: '12px 0 4px', fontSize: 13, fontWeight: 700 }
const p: React.CSSProperties = { margin: '0 0 4px' }
const kbd: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  background: '#f1f5f9',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  padding: '0 4px',
}
const closeBtn: React.CSSProperties = {
  background: '#ffffff',
  color: '#1e293b',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  padding: '2px 8px',
  cursor: 'pointer',
}

/**
 * In-editor help card explaining units, the room/rack workflow, and shortcuts.
 * Dismissible; toggled from the EditToolbar "?" button.
 */
export function EditHelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div style={overlay}>
      <div style={head}>
        <strong>Floor-plan editor</strong>
        <button style={closeBtn} onClick={onClose} title="Close help">
          ×
        </button>
      </div>

      <p style={p}>
        Arrange racks and draw rooms to match your real datacenter footprint. The scene is
        <strong> 1:1 real-world scale</strong>.
      </p>

      <div style={h}>Units</div>
      <p style={p}>
        Switch the toolbar between <strong>meters</strong> and <strong>feet</strong> any time.
        Values are always stored in meters, so toggling never loses precision.
      </p>

      <div style={h}>Draw a room from its footprint</div>
      <p style={p}>
        1. Click <strong>add room</strong>, then drag on the floor — a live badge shows the
        size as you drag.
      </p>
      <p style={p}>
        2. The room is selected on release. In the <strong>properties panel</strong> (right),
        type the exact width, depth, centre position, name and colour.
      </p>
      <p style={p}>Typed values are exact; only dragging snaps to the grid.</p>

      <div style={h}>Move racks</div>
      <p style={p}>
        Click a rack to select it. Drag to reposition (snaps to the grid), or type exact X/Z
        and rotation in the properties panel.
      </p>

      <div style={h}>Floor size & grid</div>
      <p style={p}>
        Floor auto-fits to the content; enter explicit width × depth to fix it, or
        <strong> auto</strong> to release it. The <strong>grid</strong> menu sets the snap
        pitch — <strong>tile</strong> is the standard 0.6 m raised-floor tile.
      </p>

      <div style={h}>Saving</div>
      <p style={p}>
        <strong>save</strong> persists to the server. In <em>sandbox</em> mode changes stay
        local (Save is hidden). <strong>export/import</strong> round-trips a layout as JSON.
      </p>

      <div style={h}>Keyboard</div>
      <p style={p}>
        <span style={kbd}>R</span> rotate the selected rack · <span style={kbd}>Esc</span>{' '}
        cancel room drawing.
      </p>
    </div>
  )
}
