import type { ViewMode } from '../store/useAppStore'

/**
 * Determine which chunk to preload when hovering the view mode switch.
 * We preload the chunk for the mode we're switching TO, not the current mode.
 */
export function chunkForSwitchHover(viewMode: ViewMode): 'diagram' | 'scene' {
  return viewMode === 'physical' ? 'diagram' : 'scene'
}
