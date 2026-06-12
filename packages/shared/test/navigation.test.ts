import { describe, expect, test } from 'vitest'
import {
  CAMERA_REST_FACTOR,
  DEFAULT_THRESHOLDS,
  initialNavMachine,
  stepNavigation,
  thresholdsForSpan,
  type NavMachine,
  type NavSignals,
} from '../src/navigation'

const T = DEFAULT_THRESHOLDS

function run(machine: NavMachine, signals: NavSignals[]) {
  const actions: unknown[] = []
  let m = machine
  for (const s of signals) {
    const r = stepNavigation(m, s, T)
    m = r.machine
    if (r.action) actions.push(r.action)
  }
  return { machine: m, actions }
}

describe('map → site', () => {
  test('zooming past the threshold over a site enters it', () => {
    const { actions } = run(initialNavMachine(), [
      { level: 'map', mapZoom: 10, siteUnderCenter: null },
      { level: 'map', mapZoom: 13, siteUnderCenter: 'als' },
      { level: 'map', mapZoom: 14.2, siteUnderCenter: 'als' },
    ])
    expect(actions).toEqual([{ type: 'enterSite', siteName: 'als' }])
  })

  test('no entry without a site near the view center', () => {
    const { actions } = run(initialNavMachine(), [
      { level: 'map', mapZoom: 10, siteUnderCenter: null },
      { level: 'map', mapZoom: 15, siteUnderCenter: null },
    ])
    expect(actions).toEqual([])
  })

  test('hysteresis: after returning below threshold but above re-arm, no re-entry', () => {
    let m = initialNavMachine()
    let r = stepNavigation(m, { level: 'map', mapZoom: 13, siteUnderCenter: 'als' }, T)
    r = stepNavigation(r.machine, { level: 'map', mapZoom: 14.2, siteUnderCenter: 'als' }, T)
    expect(r.action).toEqual({ type: 'enterSite', siteName: 'als' })
    // back on the map at 13.8 (above re-arm 13.5) — must NOT immediately re-enter at 14.0
    r = stepNavigation(r.machine, { level: 'map', mapZoom: 13.8, siteUnderCenter: 'als' }, T)
    expect(r.action).toBeUndefined()
    r = stepNavigation(r.machine, { level: 'map', mapZoom: 14.1, siteUnderCenter: 'als' }, T)
    expect(r.action).toBeUndefined()
    // dropping below re-arm re-enables the transition
    r = stepNavigation(r.machine, { level: 'map', mapZoom: 13.0, siteUnderCenter: 'als' }, T)
    r = stepNavigation(r.machine, { level: 'map', mapZoom: 14.1, siteUnderCenter: 'als' }, T)
    expect(r.action).toEqual({ type: 'enterSite', siteName: 'als' })
  })
})

describe('site → map', () => {
  test('camera fly-in from far away does not bounce straight back to map', () => {
    const { actions } = run(initialNavMachine(), [
      // entering animation passes through large distances first
      { level: 'site', cameraDistToSite: 40 },
      { level: 'site', cameraDistToSite: 30 },
      { level: 'site', cameraDistToSite: 12 },
    ])
    expect(actions).toEqual([])
  })

  test('after settling close, zooming far out exits to map', () => {
    const { actions } = run(initialNavMachine(), [
      { level: 'site', cameraDistToSite: 12 }, // arms the exit (below re-arm 23)
      { level: 'site', cameraDistToSite: 26 },
    ])
    expect(actions).toEqual([{ type: 'exitToMap' }])
  })
})

describe('site ↔ rack', () => {
  test('approaching a rack enters it once armed', () => {
    const { actions } = run(initialNavMachine(), [
      { level: 'site', cameraDistToSite: 12, cameraDistToRack: 8, nearestRackId: '376' },
      { level: 'site', cameraDistToSite: 6, cameraDistToRack: 2.2, nearestRackId: '376' },
    ])
    expect(actions).toEqual([{ type: 'enterRack', rackId: '376' }])
  })

  test('rack fly-in does not bounce back to site, but later retreat exits', () => {
    const { actions } = run(initialNavMachine(), [
      { level: 'rack', cameraDistToRack: 6 }, // approach animation — not armed yet
      { level: 'rack', cameraDistToRack: 2.2 }, // settles close → arms exit
      { level: 'rack', cameraDistToRack: 3.8 },
    ])
    expect(actions).toEqual([{ type: 'exitToSite' }])
  })

  test('after exiting a rack, hovering in the hysteresis band does not re-enter', () => {
    let m = initialNavMachine()
    let r = stepNavigation(m, { level: 'rack', cameraDistToRack: 2.2 }, T)
    r = stepNavigation(r.machine, { level: 'rack', cameraDistToRack: 3.8 }, T)
    expect(r.action).toEqual({ type: 'exitToSite' })
    // at 2.6 (below enter 2.5? no: 2.6 > 2.5, inside band) — and not re-armed (needs > 2.7)
    r = stepNavigation(r.machine, { level: 'site', cameraDistToSite: 8, cameraDistToRack: 2.6, nearestRackId: '376' }, T)
    expect(r.action).toBeUndefined()
    r = stepNavigation(r.machine, { level: 'site', cameraDistToSite: 8, cameraDistToRack: 2.4, nearestRackId: '376' }, T)
    expect(r.action).toBeUndefined()
    // retreat past re-arm, then approach again → enters
    r = stepNavigation(r.machine, { level: 'site', cameraDistToSite: 8, cameraDistToRack: 3.0, nearestRackId: '376' }, T)
    r = stepNavigation(r.machine, { level: 'site', cameraDistToSite: 8, cameraDistToRack: 2.3, nearestRackId: '376' }, T)
    expect(r.action).toEqual({ type: 'enterRack', rackId: '376' })
  })
})

describe('thresholdsForSpan', () => {
  test('small buildings keep the default exit thresholds', () => {
    const t = thresholdsForSpan(8)
    expect(t.siteExitDistance).toBe(DEFAULT_THRESHOLDS.siteExitDistance)
    expect(t.siteExitRearm).toBe(DEFAULT_THRESHOLDS.siteExitRearm)
  })

  test('large buildings push the exit beyond the camera resting distance', () => {
    // 50-rack showcase site: span ~20m, camera rests at ~1.3*span ≈ 26m —
    // past the default 25m exit, which used to bounce the view back to map
    const span = 20
    const rest = span * CAMERA_REST_FACTOR
    const t = thresholdsForSpan(span)
    expect(t.siteExitDistance).toBeGreaterThan(rest)
    expect(t.siteExitRearm).toBeGreaterThan(rest)
    expect(t.siteExitRearm).toBeLessThan(t.siteExitDistance)
  })

  test('null span falls back to the defaults', () => {
    expect(thresholdsForSpan(null)).toEqual(DEFAULT_THRESHOLDS)
  })

  test('settled camera at rest distance never exits a large site', () => {
    const span = 20
    const rest = span * CAMERA_REST_FACTOR
    const t = thresholdsForSpan(span)
    let m = initialNavMachine()
    // fly-in passes close to the building (arms exit), then settles at rest
    for (const d of [12, 16, 20, rest, rest, rest]) {
      const r = stepNavigation(m, { level: 'site', cameraDistToSite: d }, t)
      m = r.machine
      expect(r.action).toBeUndefined()
    }
  })
})
