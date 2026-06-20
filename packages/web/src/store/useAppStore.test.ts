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

describe('backend', () => {
  beforeEach(() => {
    // restore the default backend + map baseline between tests
    useAppStore.getState().setBackend('netbox')
    useAppStore.getState().zoomToMap()
  })

  test('initializes to netbox', () => {
    expect(useAppStore.getState().backend).toBe('netbox')
  })

  test('setBackend switches the active backend', () => {
    useAppStore.getState().setBackend('infrahub')
    expect(useAppStore.getState().backend).toBe('infrahub')
  })

  test('switching backend resets navigation to the map (selection may not exist in the other backend)', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().zoomToRack('rack-1')
    useAppStore.getState().selectDevice('dev-1')
    useAppStore.getState().setBackend('infrahub')
    const s = useAppStore.getState()
    expect(s.level).toBe('map')
    expect(s.selectedSiteName).toBe(null)
    expect(s.selectedRackId).toBe(null)
    expect(s.selectedDeviceId).toBe(null)
  })

  test('setBackend to the same backend leaves the current view intact', () => {
    useAppStore.getState().setBackend('infrahub')
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().setBackend('infrahub') // no change
    expect(useAppStore.getState().level).toBe('site')
    expect(useAppStore.getState().selectedSiteName).toBe('ams1')
  })
})

describe('pendingDeviceFocus', () => {
  beforeEach(() => {
    useAppStore.getState().zoomToMap()
  })

  const target = { siteName: 'lon1', rackId: 'r5', deviceId: 'd42' }

  test('initializes to null', () => {
    expect(useAppStore.getState().pendingDeviceFocus).toBe(null)
  })

  test('focusDevice from the map navigates to the site and records the pending focus', () => {
    useAppStore.getState().focusDevice(target)
    const s = useAppStore.getState()
    expect(s.pendingDeviceFocus).toEqual(target)
    expect(s.level).toBe('site')
    expect(s.selectedSiteName).toBe('lon1')
  })

  test('focusDevice for the site already in view does not leave that view', () => {
    useAppStore.getState().zoomToSite('lon1')
    useAppStore.getState().zoomToRack('r1') // already inside lon1, in a rack
    useAppStore.getState().focusDevice(target)
    const s = useAppStore.getState()
    expect(s.pendingDeviceFocus).toEqual(target)
    expect(s.selectedSiteName).toBe('lon1')
    expect(s.level).toBe('rack') // not bounced back out to site level
  })

  test('clearPendingFocus clears it', () => {
    useAppStore.getState().focusDevice(target)
    useAppStore.getState().clearPendingFocus()
    expect(useAppStore.getState().pendingDeviceFocus).toBe(null)
  })

  test('zoomToMap clears a pending focus (manual navigation cancels it)', () => {
    useAppStore.getState().focusDevice(target)
    useAppStore.getState().zoomToMap()
    expect(useAppStore.getState().pendingDeviceFocus).toBe(null)
  })

  test('zoomToRack clears a pending focus', () => {
    useAppStore.getState().focusDevice(target)
    useAppStore.getState().zoomToRack('r5')
    expect(useAppStore.getState().pendingDeviceFocus).toBe(null)
  })

  test('a manual zoomToSite to a different site clears a pending focus', () => {
    useAppStore.getState().focusDevice(target) // pending for lon1, now at lon1
    useAppStore.getState().zoomToSite('fra1')
    expect(useAppStore.getState().pendingDeviceFocus).toBe(null)
  })
})

describe('navSuppressed', () => {
  beforeEach(() => {
    useAppStore.getState().zoomToMap()
  })

  test('initializes to false', () => {
    expect(useAppStore.getState().navSuppressed).toBe(false)
  })

  test('focusDevice suppresses the distance-driven nav machine', () => {
    useAppStore.getState().focusDevice({ siteName: 'AMS1', rackId: 'r1', deviceId: 'd1' })
    expect(useAppStore.getState().navSuppressed).toBe(true)
  })

  test('handleCameraSignals is a no-op while suppressed (no programmatic-fly bounce)', () => {
    useAppStore.getState().zoomToSite('AMS1')
    useAppStore.getState().zoomToRack('r1') // level=rack, arms the rack exit
    useAppStore.getState().setNavSuppressed(true)
    // A far rack distance would normally fire exitToSite; suppressed it must not.
    useAppStore.getState().handleCameraSignals(30, 30, 'r1', 20)
    expect(useAppStore.getState().level).toBe('rack')
  })

  test('once resumed, the nav machine reacts again', () => {
    useAppStore.getState().zoomToSite('AMS1')
    useAppStore.getState().zoomToRack('r1')
    useAppStore.getState().setNavSuppressed(true)
    useAppStore.getState().handleCameraSignals(30, 30, 'r1', 20) // ignored
    useAppStore.getState().setNavSuppressed(false)
    useAppStore.getState().handleCameraSignals(30, 30, 'r1', 20) // now exits
    expect(useAppStore.getState().level).toBe('site')
  })

  test('zoomToMap clears suppression', () => {
    useAppStore.getState().focusDevice({ siteName: 'AMS1', rackId: 'r1', deviceId: 'd1' })
    useAppStore.getState().zoomToMap()
    expect(useAppStore.getState().navSuppressed).toBe(false)
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

describe('selectedPowerSource', () => {
  beforeEach(() => {
    useAppStore.getState().zoomToMap()
  })

  test('initializes to null', () => {
    expect(useAppStore.getState().selectedPowerSource).toBe(null)
  })

  test('setPowerSource records and clears the source', () => {
    useAppStore.getState().setPowerSource({ kind: 'panel', name: 'PANEL-A' })
    expect(useAppStore.getState().selectedPowerSource).toEqual({ kind: 'panel', name: 'PANEL-A' })
    useAppStore.getState().setPowerSource(null)
    expect(useAppStore.getState().selectedPowerSource).toBe(null)
  })

  test('turning the power overlay off clears any selected source', () => {
    useAppStore.getState().togglePower() // on
    useAppStore.getState().setPowerSource({ kind: 'feed', name: 'FEED1' })
    useAppStore.getState().togglePower() // off
    expect(useAppStore.getState().selectedPowerSource).toBe(null)
  })

  test('zoomToMap resets it to null', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().setPowerSource({ kind: 'panel', name: 'PANEL-A' })
    useAppStore.getState().zoomToMap()
    expect(useAppStore.getState().selectedPowerSource).toBe(null)
  })
})

describe('colorMode', () => {
  beforeEach(() => {
    useAppStore.getState().zoomToMap()
  })

  test('initializes to none (no box coloring)', () => {
    expect(useAppStore.getState().colorMode).toBe('none')
  })

  test('setColorMode selects a dimension', () => {
    useAppStore.getState().setColorMode('specs')
    expect(useAppStore.getState().colorMode).toBe('specs')
  })

  test('is single-select: setting a new dimension replaces the previous one', () => {
    useAppStore.getState().setColorMode('specs')
    useAppStore.getState().setColorMode('role')
    expect(useAppStore.getState().colorMode).toBe('role')
  })

  test('setColorMode("none") turns box coloring off', () => {
    useAppStore.getState().setColorMode('role')
    useAppStore.getState().setColorMode('none')
    expect(useAppStore.getState().colorMode).toBe('none')
  })

  test('persists across site<->rack navigation', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().setColorMode('specs')
    useAppStore.getState().zoomToRack('rack-1')
    expect(useAppStore.getState().colorMode).toBe('specs')
  })

  test('zoomToMap resets it to none', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().setColorMode('role')
    useAppStore.getState().zoomToMap()
    expect(useAppStore.getState().colorMode).toBe('none')
  })
})

describe('hiddenStatuses', () => {
  beforeEach(() => {
    useAppStore.getState().zoomToMap()
  })

  test('initializes to an empty set (nothing filtered out)', () => {
    expect(useAppStore.getState().hiddenStatuses.size).toBe(0)
  })

  test('toggleHiddenStatus hides a status, then shows it again', () => {
    useAppStore.getState().toggleHiddenStatus('offline')
    expect([...useAppStore.getState().hiddenStatuses]).toEqual(['offline'])
    useAppStore.getState().toggleHiddenStatus('offline')
    expect(useAppStore.getState().hiddenStatuses.size).toBe(0)
  })

  test('toggleHiddenStatus replaces the Set instance (immutable update)', () => {
    const before = useAppStore.getState().hiddenStatuses
    useAppStore.getState().toggleHiddenStatus('planned')
    expect(useAppStore.getState().hiddenStatuses).not.toBe(before)
  })

  test('zoomToMap clears the filter', () => {
    useAppStore.getState().zoomToSite('ams1')
    useAppStore.getState().toggleHiddenStatus('offline')
    useAppStore.getState().zoomToMap()
    expect(useAppStore.getState().hiddenStatuses.size).toBe(0)
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
