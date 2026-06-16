import { beforeEach, describe, expect, test } from 'vitest'
import { useAppStore } from './useAppStore'

describe('siteViewDistance', () => {
  beforeEach(() => {
    // reset to the map baseline (clears level + siteViewDistance)
    useAppStore.getState().zoomToMap()
  })

  test('initializes to null', () => {
    expect(useAppStore.getState().siteViewDistance).toBe(null)
  })

  test('setSiteViewDistance updates the field', () => {
    useAppStore.getState().setSiteViewDistance(12.5)
    expect(useAppStore.getState().siteViewDistance).toBe(12.5)
  })

  test('zoomToSite resets it to null', () => {
    useAppStore.getState().setSiteViewDistance(10)
    useAppStore.getState().zoomToSite('ams1')
    expect(useAppStore.getState().siteViewDistance).toBe(null)
  })

  test('zoomToMap resets it to null', () => {
    useAppStore.getState().setSiteViewDistance(10)
    useAppStore.getState().zoomToMap()
    expect(useAppStore.getState().siteViewDistance).toBe(null)
  })

  test('handleCameraSignals records the distance at site level', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().handleCameraSignals(15, null, null, 20)
    expect(useAppStore.getState().siteViewDistance).toBe(15)
  })

  test('handleCameraSignals does NOT touch siteViewDistance when not at site level', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().setSiteViewDistance(99)
    useAppStore.getState().zoomToRack('rack-1') // level -> 'rack', does not reset distance
    useAppStore.getState().handleCameraSignals(5, 1, 'rack-1', 20)
    expect(useAppStore.getState().siteViewDistance).toBe(99)
  })
})

describe('highlightedRoles', () => {
  beforeEach(() => {
    // map baseline clears level, selectedSiteName, and highlightedRoles
    useAppStore.getState().zoomToMap()
  })

  test('initializes to an empty set', () => {
    expect(useAppStore.getState().highlightedRoles.size).toBe(0)
  })

  test('toggleHighlightedRole adds a role not yet present', () => {
    useAppStore.getState().toggleHighlightedRole('leaf')
    expect([...useAppStore.getState().highlightedRoles]).toEqual(['leaf'])
  })

  test('toggleHighlightedRole removes a role already present', () => {
    useAppStore.getState().toggleHighlightedRole('leaf')
    useAppStore.getState().toggleHighlightedRole('leaf')
    expect(useAppStore.getState().highlightedRoles.size).toBe(0)
  })

  test('toggleHighlightedRole leaves other roles intact', () => {
    useAppStore.getState().toggleHighlightedRole('leaf')
    useAppStore.getState().toggleHighlightedRole('spine')
    useAppStore.getState().toggleHighlightedRole('leaf') // remove leaf only
    expect([...useAppStore.getState().highlightedRoles]).toEqual(['spine'])
  })

  test('toggleHighlightedRole replaces the Set instance (immutable update)', () => {
    const before = useAppStore.getState().highlightedRoles
    useAppStore.getState().toggleHighlightedRole('leaf')
    expect(useAppStore.getState().highlightedRoles).not.toBe(before)
  })

  test('clearHighlightedRoles empties the set', () => {
    useAppStore.getState().toggleHighlightedRole('leaf')
    useAppStore.getState().toggleHighlightedRole('spine')
    useAppStore.getState().clearHighlightedRoles()
    expect(useAppStore.getState().highlightedRoles.size).toBe(0)
  })

  test('zoomToMap resets the set to empty', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().toggleHighlightedRole('leaf')
    useAppStore.getState().zoomToMap()
    expect(useAppStore.getState().highlightedRoles.size).toBe(0)
  })

  test('zoomToSite to a different site resets the set', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().toggleHighlightedRole('leaf')
    useAppStore.getState().zoomToSite('lon1')
    expect(useAppStore.getState().highlightedRoles.size).toBe(0)
  })

  test('zoomToSite to the same site preserves the set (rack<->site bounce)', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().toggleHighlightedRole('leaf')
    useAppStore.getState().zoomToSite('ams1') // e.g. exitToSite returning from a rack
    expect([...useAppStore.getState().highlightedRoles]).toEqual(['leaf'])
  })
})

describe('powerVisible', () => {
  beforeEach(() => {
    useAppStore.getState().zoomToMap()
  })

  test('initializes to false', () => {
    expect(useAppStore.getState().powerVisible).toBe(false)
  })

  test('togglePower flips the flag', () => {
    useAppStore.getState().togglePower()
    expect(useAppStore.getState().powerVisible).toBe(true)
    useAppStore.getState().togglePower()
    expect(useAppStore.getState().powerVisible).toBe(false)
  })

  test('persists across site<->rack navigation', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().togglePower()
    useAppStore.getState().zoomToRack('rack-1')
    expect(useAppStore.getState().powerVisible).toBe(true)
    useAppStore.getState().zoomToSite('ams1')
    expect(useAppStore.getState().powerVisible).toBe(true)
  })

  test('zoomToMap resets it to false', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().togglePower()
    useAppStore.getState().zoomToMap()
    expect(useAppStore.getState().powerVisible).toBe(false)
  })
})

describe('specsHeatmapMetric', () => {
  beforeEach(() => {
    useAppStore.getState().zoomToMap()
  })

  test('initializes to null (heatmap off)', () => {
    expect(useAppStore.getState().specsHeatmapMetric).toBe(null)
  })

  test('setSpecsMetric selects a metric and back to null', () => {
    useAppStore.getState().setSpecsMetric('ramGb')
    expect(useAppStore.getState().specsHeatmapMetric).toBe('ramGb')
    useAppStore.getState().setSpecsMetric(null)
    expect(useAppStore.getState().specsHeatmapMetric).toBe(null)
  })

  test('persists across site<->rack navigation', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().setSpecsMetric('cpuCores')
    useAppStore.getState().zoomToRack('rack-1')
    expect(useAppStore.getState().specsHeatmapMetric).toBe('cpuCores')
  })

  test('zoomToMap resets it to null', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().setSpecsMetric('storageTb')
    useAppStore.getState().zoomToMap()
    expect(useAppStore.getState().specsHeatmapMetric).toBe(null)
  })
})
