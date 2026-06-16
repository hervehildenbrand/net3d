import { theme } from '../theme'
import type { Site } from '../hooks/useSites'

export interface MarkerColors {
  /** Stroke colour. */
  color: string
  /** Fill colour. */
  fill: string
}

/** Map a site's DC role to its marker palette so the map reads by type at a glance. */
export function markerColorsForRole(role: Site['role']): MarkerColors {
  if (role === 'pop') return { ...theme.map.markerPop }
  if (role === 'compute') return { ...theme.map.marker }
  return { ...theme.map.markerOther }
}
