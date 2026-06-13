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
