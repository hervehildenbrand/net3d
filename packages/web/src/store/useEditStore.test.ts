import { beforeEach, describe, expect, test } from 'vitest'
import { SITE_LAYOUT_VERSION, type RackPlacement } from '@net3d/shared'
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

  test('commitRoom adds a named room, exits add-room mode, and marks dirty', () => {
    useEditStore.getState().enterEditMode([placement('A1')])
    useEditStore.getState().setAddRoomMode(true)
    useEditStore.getState().commitRoom({ x: 2, z: 3, width: 4, depth: 5 })
    const rooms = useEditStore.getState().workingRooms
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.bounds).toEqual({ x: 2, z: 3, width: 4, depth: 5 })
    expect(typeof rooms[0]!.id).toBe('string')
    expect(rooms[0]!.name.length).toBeGreaterThan(0)
    expect(useEditStore.getState().addRoomMode).toBe(false)
    expect(useEditStore.getState().dirty).toBe(true)
  })

  test('deleteSelectedRoom removes the selected room', () => {
    useEditStore.getState().enterEditMode([placement('A1')])
    useEditStore.getState().commitRoom({ x: 0, z: 0, width: 2, depth: 2 })
    const id = useEditStore.getState().workingRooms[0]!.id
    useEditStore.getState().selectRoom(id)
    useEditStore.getState().deleteSelectedRoom()
    expect(useEditStore.getState().workingRooms).toHaveLength(0)
    expect(useEditStore.getState().selectedRoomId).toBeNull()
  })

  test('setFloor sets and clears explicit floor dimensions', () => {
    useEditStore.getState().enterEditMode([placement('A1')])
    useEditStore.getState().setFloor({ width: 30, depth: 20 })
    expect(useEditStore.getState().floor).toEqual({ width: 30, depth: 20 })
    expect(useEditStore.getState().buildLayoutPayload().floor).toEqual({ width: 30, depth: 20 })
    useEditStore.getState().setFloor(null)
    expect(useEditStore.getState().floor).toBeNull()
  })

  test('enterEditMode seeds rooms and floor from an existing layout', () => {
    useEditStore
      .getState()
      .enterEditMode(
        [placement('A1')],
        [{ id: 'r1', name: 'Cage', bounds: { x: 1, z: 1, width: 2, depth: 2 } }],
        { width: 40, depth: 25 },
      )
    expect(useEditStore.getState().workingRooms).toHaveLength(1)
    expect(useEditStore.getState().floor).toEqual({ width: 40, depth: 25 })
  })

  test('revert restores the working copy to the seed and clears dirty', () => {
    useEditStore.getState().enterEditMode([placement('A1', 0, 0)])
    useEditStore.getState().updateRackPosition('A1', 5, 5)
    useEditStore.getState().commitRoom({ x: 0, z: 0, width: 2, depth: 2 })
    useEditStore.getState().setFloor({ width: 9, depth: 9 })
    useEditStore.getState().revert()
    const p = useEditStore.getState().workingPlacements.find((p) => p.rackId === 'A1')!
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(0, 6)
    expect(useEditStore.getState().workingRooms).toEqual([])
    expect(useEditStore.getState().floor).toBeNull()
    expect(useEditStore.getState().dirty).toBe(false)
  })

  test('revert returns to the last saved baseline, not the original', () => {
    useEditStore.getState().enterEditMode([placement('A1', 0, 0)])
    useEditStore.getState().updateRackPosition('A1', 5, 5)
    useEditStore.getState().markSaved()
    useEditStore.getState().updateRackPosition('A1', 7, 7)
    useEditStore.getState().revert()
    const p = useEditStore.getState().workingPlacements.find((p) => p.rackId === 'A1')!
    expect(p.x).toBeCloseTo(5, 6)
    expect(useEditStore.getState().dirty).toBe(false)
  })

  test('importLayout overlays imported overrides onto the current racks', () => {
    useEditStore.getState().enterEditMode([placement('A1', 1, 1), placement('A2', 2, 2)])
    useEditStore.getState().importLayout({
      version: SITE_LAYOUT_VERSION,
      updatedAt: '2026-06-21T00:00:00.000Z',
      racks: [{ rackId: 'A1', x: 9, z: 9, rotationDeg: 90 }],
      rooms: [{ id: 'r', name: 'R', bounds: { x: 0, z: 0, width: 2, depth: 2 } }],
      floor: { width: 10, depth: 10 },
    })
    const a1 = useEditStore.getState().workingPlacements.find((p) => p.rackId === 'A1')!
    const a2 = useEditStore.getState().workingPlacements.find((p) => p.rackId === 'A2')!
    expect(a1.x).toBeCloseTo(9, 6)
    expect(a1.rotationDeg).toBe(90)
    expect(a1.width).toBeCloseTo(1.2, 6) // footprint swapped
    expect(a2.x).toBeCloseTo(2, 6) // not in import → unchanged
    expect(useEditStore.getState().workingRooms).toHaveLength(1)
    expect(useEditStore.getState().floor).toEqual({ width: 10, depth: 10 })
    expect(useEditStore.getState().dirty).toBe(true)
  })

  test('exitEditMode clears room and floor working state', () => {
    useEditStore.getState().enterEditMode([placement('A1')])
    useEditStore.getState().commitRoom({ x: 0, z: 0, width: 2, depth: 2 })
    useEditStore.getState().setFloor({ width: 10, depth: 10 })
    useEditStore.getState().exitEditMode()
    expect(useEditStore.getState().workingRooms).toEqual([])
    expect(useEditStore.getState().floor).toBeNull()
    expect(useEditStore.getState().addRoomMode).toBe(false)
    expect(useEditStore.getState().selectedRoomId).toBeNull()
  })
})
