import { describe, expect, test } from 'vitest'
import {
  DEFAULT_THRESHOLDS,
  initialNavMachine,
  stepNavigation,
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
