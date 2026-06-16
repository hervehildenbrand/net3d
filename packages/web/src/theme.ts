/** Single source of truth for the light visual style. */
export const theme = {
  map: {
    tiles: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    background: '#f4f6f8',
    marker: { color: '#0284c7', fill: '#38bdf8' },
    circuit: '#0ea5e9',
  },
  scene: {
    background: '#fafbfc',
    floor: '#f1f5f9',
    buildingShell: '#cbd5e1',
    buildingShellOpacity: 0.18,
    rack: '#8aa5bd',
    rackHover: '#5d87ab',
    /** Non-matching racks when a role highlight is active — recede behind the markers. */
    rackDimmed: '#3c4a59',
    rackShell: '#dbe5ee',
    rackShellEdges: '#94a8bb',
  },
  text: {
    primary: '#1e293b',
    secondary: '#475569',
    muted: '#94a3b8',
    onScene: '#334155',
  },
  hud: {
    background: 'rgba(255, 255, 255, 0.94)',
    border: '#cbd5e1',
    shadow: '0 1px 3px rgba(15, 23, 42, 0.1)',
    accent: '#0891b2',
  },
  // A/B redundant power: feed A = amber (the power-cable hue), feed B = blue for
  // a clear two-side contrast; PDU rails share their feed's color.
  power: {
    feedA: '#b45309',
    feedB: '#2563eb',
    panel: '#334155',
  },
  // Device-specs heatmap ramp: cool low -> warm high, with a distinct slate for
  // devices that carry no value for the active metric. Stops are exact so the
  // gradient endpoints/midpoint land on these colors verbatim.
  heatmap: {
    low: '#2563eb', // blue (low capacity)
    mid: '#facc15', // yellow (mid)
    high: '#dc2626', // red (high capacity)
    noData: '#475569', // slate (metric not populated)
  },
  cable: {
    fallback: '#0ea5e9',
    lldp: '#06b6d4',
    up: '#16a34a',
    down: '#dc2626',
    mgmt: '#d97706',
    // selected/hovered device's whole bundle, so it reads as one set
    highlight: '#f59e0b',
    // grouping by physical medium when NetBox gives no explicit color
    medium: {
      fiber: '#7c3aed', // violet
      copper: '#0ea5e9', // sky
      dac: '#0d9488', // teal
      power: '#b45309', // dark amber
      other: '#64748b', // slate
    },
  },
} as const
