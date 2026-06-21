import { beforeEach, describe, expect, test } from 'vitest'
import type { RackPlacement } from '@net3d/shared'
import { useEditStore } from './useEditStore'
import { useAppStore } from './useAppStore'

const placement = (rackId: string, x = 0, z = 0): RackPlacement => ({
  rackId,
  name: rackId,
  location: null,
  x,
  z,
  width: 0.6,
  depth: 1.2,
  height: 2,
})

beforeEach(() => {
  useEditStore.getState().exitEditMode()
  useAppStore.getState().setNavSuppressed(false)
})

describe('useEditStore', () => {
  test('starts inactive with an empty working copy', () => {
    const s = useEditStore.getState()
    expect(s.editModeActive).toBe(false)
    expect(s.selectedRackId).toBeNull()
    expect(s.dirty).toBe(false)
    expect(s.workingPlacements).toEqual([])
  })

  test('enterEditMode activates, copies placements, and suppresses navigation', () => {
    useEditStore.getState().enterEditMode([placement('A1', 1, 2)])
    const s = useEditStore.getState()
    expect(s.editModeActive).toBe(true)
    expect(s.workingPlacements).toHaveLength(1)
    expect(s.dirty).toBe(false)
    expect(useAppStore.getState().navSuppressed).toBe(true)
  })

  test('exitEditMode deactivates, clears the working copy, and restores navigation', () => {
    useEditStore.getState().enterEditMode([placement('A1')])
    useEditStore.getState().selectRack('A1')
    useEditStore.getState().exitEditMode()
    const s = useEditStore.getState()
    expect(s.editModeActive).toBe(false)
    expect(s.workingPlacements).toEqual([])
    expect(s.selectedRackId).toBeNull()
    expect(useAppStore.getState().navSuppressed).toBe(false)
  })

  test('selectRack sets the selection', () => {
    useEditStore.getState().enterEditMode([placement('A1')])
    useEditStore.getState().selectRack('A1')
    expect(useEditStore.getState().selectedRackId).toBe('A1')
  })

  test('updateRackPosition moves the rack and marks the layout dirty', () => {
    useEditStore.getState().enterEditMode([placement('A1', 0, 0)])
    useEditStore.getState().setGridSnap(0)
    useEditStore.getState().updateRackPosition('A1', 3.3, 4.4)
    const p = useEditStore.getState().workingPlacements.find((p) => p.rackId === 'A1')!
    expect(p.x).toBeCloseTo(3.3, 6)
    expect(p.z).toBeCloseTo(4.4, 6)
    expect(useEditStore.getState().dirty).toBe(true)
  })

  test('updateRackPosition snaps to the active grid', () => {
    useEditStore.getState().enterEditMode([placement('A1', 0, 0)])
    useEditStore.getState().setGridSnap(0.5)
    useEditStore.getState().updateRackPosition('A1', 0.13, 0.62)
    const p = useEditStore.getState().workingPlacements.find((p) => p.rackId === 'A1')!
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(0.5, 6)
  })

  test('rotateSelected cycles the selected rack 0->90->180->270->0 and swaps the footprint', () => {
    useEditStore.getState().enterEditMode([placement('A1')]) // width 0.6, depth 1.2
    useEditStore.getState().selectRack('A1')
    const rot = () => useEditStore.getState().rotateSelected()
    const get = () => useEditStore.getState().workingPlacements.find((p) => p.rackId === 'A1')!

    rot()
    expect(get().rotationDeg).toBe(90)
    expect(get().width).toBeCloseTo(1.2, 6)
    expect(get().depth).toBeCloseTo(0.6, 6)
    expect(useEditStore.getState().dirty).toBe(true)

    rot()
    expect(get().rotationDeg).toBe(180)
    expect(get().width).toBeCloseTo(0.6, 6)
    expect(get().depth).toBeCloseTo(1.2, 6)

    rot()
    expect(get().rotationDeg).toBe(270)
    expect(get().width).toBeCloseTo(1.2, 6)

    rot()
    expect(get().rotationDeg).toBe(0)
    expect(get().width).toBeCloseTo(0.6, 6)
    expect(get().depth).toBeCloseTo(1.2, 6)
  })

  test('rotateSelected is a no-op when nothing is selected', () => {
    useEditStore.getState().enterEditMode([placement('A1')])
    useEditStore.getState().rotateSelected()
    expect(useEditStore.getState().workingPlacements[0]!.rotationDeg ?? 0).toBe(0)
    expect(useEditStore.getState().dirty).toBe(false)
  })

  test('markSaved clears the dirty flag', () => {
    useEditStore.getState().enterEditMode([placement('A1', 0, 0)])
    useEditStore.getState().updateRackPosition('A1', 1, 1)
    expect(useEditStore.getState().dirty).toBe(true)
    useEditStore.getState().markSaved()
    expect(useEditStore.getState().dirty).toBe(false)
  })

  test('toggleTopDownView flips the flag', () => {
    expect(useEditStore.getState().topDownView).toBe(false)
    useEditStore.getState().toggleTopDownView()
    expect(useEditStore.getState().topDownView).toBe(true)
  })

  test('buildLayoutPayload emits a rack override per working placement', () => {
    useEditStore.getState().enterEditMode([placement('A1', 1, 2), placement('A2', 3, 4)])
    const payload = useEditStore.getState().buildLayoutPayload()
    expect(payload.racks).toEqual([
      { rackId: 'A1', x: 1, z: 2, rotationDeg: 0 },
      { rackId: 'A2', x: 3, z: 4, rotationDeg: 0 },
    ])
    expect(payload.rooms).toEqual([])
    expect(payload.floor).toBeNull()
  })
})
