export interface NavThresholds {
  /** Map zoom at which a site under the view center is entered. */
  mapEnterZoom: number
  /** Map zoom the user must drop below before map→site can fire again. */
  mapRearmZoom: number
  /** Camera distance to the building center beyond which the site exits to the map. */
  siteExitDistance: number
  /** Camera must first come within this distance to arm the site exit. */
  siteExitRearm: number
  /** Camera distance to the nearest rack at which the rack view is entered. */
  rackEnterDistance: number
  /** Camera must first retreat beyond this distance to arm rack entry. */
  rackEnterRearm: number
  /** Camera distance to the current rack beyond which the rack exits to site. */
  rackExitDistance: number
  /** Camera must first come within this distance to arm the rack exit. */
  rackExitRearm: number
}

export const DEFAULT_THRESHOLDS: NavThresholds = {
  mapEnterZoom: 14,
  mapRearmZoom: 13.5,
  siteExitDistance: 25,
  siteExitRearm: 23,
  rackEnterDistance: 2.5,
  rackEnterRearm: 2.7,
  rackExitDistance: 3.5,
  rackExitRearm: 3.3,
}

/**
 * Distance (in spans) at which the site fly-in camera rests from the building
 * center — |(0.55, 0.7, 0.95)|, the setLookAt offset used by the camera rig.
 */
export const CAMERA_REST_FACTOR = Math.hypot(0.55, 0.7, 0.95)

/**
 * Exit thresholds scaled to the building size. A large site's camera rests
 * beyond the fixed default exit distance, which used to bounce the view back
 * to the map right after the fly-in; the exit band must sit safely outside
 * the resting distance.
 */
export function thresholdsForSpan(
  span: number | null,
  base: NavThresholds = DEFAULT_THRESHOLDS,
): NavThresholds {
  if (span == null) return base
  const rest = span * CAMERA_REST_FACTOR
  return {
    ...base,
    siteExitDistance: Math.max(base.siteExitDistance, rest * 1.35),
    siteExitRearm: Math.max(base.siteExitRearm, rest * 1.15),
  }
}

export interface NavSignals {
  level: 'map' | 'site' | 'rack'
  mapZoom?: number | null
  /** Name of the geocoded site nearest the map view center (within pick radius), if any. */
  siteUnderCenter?: string | null
  cameraDistToSite?: number | null
  cameraDistToRack?: number | null
  nearestRackId?: string | null
}

export type NavAction =
  | { type: 'enterSite'; siteName: string }
  | { type: 'exitToMap' }
  | { type: 'enterRack'; rackId: string }
  | { type: 'exitToSite' }

/**
 * Armed flags implement hysteresis: each transition only fires when armed,
 * and arms only after its metric has crossed the re-arm threshold. This is
 * what stops fly-in animations and band-edge hovering from flapping levels.
 */
export interface NavMachine {
  enterSiteArmed: boolean
  exitSiteArmed: boolean
  enterRackArmed: boolean
  exitRackArmed: boolean
}

export function initialNavMachine(): NavMachine {
  return { enterSiteArmed: false, exitSiteArmed: false, enterRackArmed: false, exitRackArmed: false }
}

export function stepNavigation(
  machine: NavMachine,
  signals: NavSignals,
  t: NavThresholds,
): { machine: NavMachine; action?: NavAction } {
  const m = { ...machine }

  if (signals.level === 'map') {
    const zoom = signals.mapZoom
    if (zoom == null) return { machine: m }
    if (zoom <= t.mapRearmZoom) m.enterSiteArmed = true
    if (m.enterSiteArmed && zoom >= t.mapEnterZoom && signals.siteUnderCenter) {
      m.enterSiteArmed = false
      m.exitSiteArmed = false // require settling inside before exiting back out
      return { machine: m, action: { type: 'enterSite', siteName: signals.siteUnderCenter } }
    }
    return { machine: m }
  }

  if (signals.level === 'site') {
    const dSite = signals.cameraDistToSite
    if (dSite != null) {
      if (dSite <= t.siteExitRearm) m.exitSiteArmed = true
      if (m.exitSiteArmed && dSite >= t.siteExitDistance) {
        m.exitSiteArmed = false
        m.enterSiteArmed = false // map re-arms once its zoom drops below rearm
        return { machine: m, action: { type: 'exitToMap' } }
      }
    }
    const dRack = signals.cameraDistToRack
    if (dRack != null) {
      if (dRack >= t.rackEnterRearm) m.enterRackArmed = true
      if (m.enterRackArmed && dRack <= t.rackEnterDistance && signals.nearestRackId) {
        m.enterRackArmed = false
        m.exitRackArmed = false
        return { machine: m, action: { type: 'enterRack', rackId: signals.nearestRackId } }
      }
    }
    return { machine: m }
  }

  // rack level
  const dRack = signals.cameraDistToRack
  if (dRack != null) {
    if (dRack <= t.rackExitRearm) m.exitRackArmed = true
    if (m.exitRackArmed && dRack >= t.rackExitDistance) {
      m.exitRackArmed = false
      m.enterRackArmed = false
      return { machine: m, action: { type: 'exitToSite' } }
    }
  }
  return { machine: m }
}
