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
  cable: {
    fallback: '#0ea5e9',
    lldp: '#06b6d4',
    up: '#16a34a',
    down: '#dc2626',
    mgmt: '#d97706',
  },
} as const
