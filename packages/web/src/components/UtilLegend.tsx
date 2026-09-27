import { theme } from '../theme'

/**
 * Log-scale utilisation legend: gradient low→mid→high, ticks at powers of 10.
 * Used by LayersPanel (room cable live mode) and MapLegend (map circuit arcs).
 */
export function UtilLegend() {
  return (
    <div>
      <div
        style={{
          height: 10,
          borderRadius: 3,
          background: `linear-gradient(to right, ${theme.heatmap.low}, ${theme.heatmap.mid}, ${theme.heatmap.high})`,
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: theme.text.muted,
          fontSize: 11,
          marginTop: 2,
        }}
      >
        <span>0.01</span>
        <span>0.1</span>
        <span>1</span>
        <span>10</span>
        <span>100 %</span>
      </div>
      <div style={{ color: theme.text.muted, fontSize: 11, marginTop: 6 }}>grey = stale</div>
    </div>
  )
}
