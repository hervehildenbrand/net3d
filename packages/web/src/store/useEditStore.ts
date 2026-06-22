import { create } from 'zustand'
import type { CameraControls } from '@react-three/drei'
import {
  rotatedFootprint,
  snapToGrid,
  type FloorDimensions,
  type LayoutRoom,
  type RackPlacement,
  type RoomRect,
  type Rotation,
  type SiteLayout,
} from '@net3d/shared'
import { loadUnitPreference, saveUnitPreference, type LengthUnit } from '../lib/units'
import { useAppStore } from './useAppStore'

/** The editable parts of a SiteLayout (server stamps version + updatedAt). */
export type LayoutPayload = Pick<SiteLayout, 'racks' | 'rooms' | 'floor'>

/** Smallest room edge we accept, in meters — guards against zero/degenerate rooms. */
export const MIN_ROOM_M = 0.5

interface EditState {
  /** Floor-plan edit mode is active (site level only). */
  editModeActive: boolean
  /** Rack selected for manipulation (rotate/inspect); null = none. */
  selectedRackId: string | null
  /** Drawing a room rectangle (clicks on the floor rubber-band a zone). */
  addRoomMode: boolean
  /** Room selected for deletion; null = none. */
  selectedRoomId: string | null
  /** Snap pitch in meters; 0 = free placement. */
  gridSnap: number
  /** Display unit for lengths/areas in the editor UI (data stays in meters). */
  lengthUnit: LengthUnit
  /** Look straight down for 2D-style placement. */
  topDownView: boolean
  /** Working copy differs from the last-saved layout. */
  dirty: boolean
  /** In-memory working copy of rack placements (mutated during a drag). */
  workingPlacements: RackPlacement[]
  /** In-memory working copy of rooms (edited in a later slice). */
  workingRooms: LayoutRoom[]
  /** Explicit floor size, or null to auto-fit (edited in a later slice). */
  floor: FloorDimensions | null
  /** Live CameraControls handle so a drag can disable orbit while moving a rack. */
  cameraControlsRef: { current: CameraControls | null } | null
  /** Snapshot of the last-saved (or seeded) state that revert() restores. */
  seed: { placements: RackPlacement[]; rooms: LayoutRoom[]; floor: FloorDimensions | null }

  enterEditMode: (placements: RackPlacement[], rooms?: LayoutRoom[], floor?: FloorDimensions | null) => void
  exitEditMode: () => void
  selectRack: (rackId: string | null) => void
  updateRackPosition: (rackId: string, x: number, z: number) => void
  /** Rotate the selected rack +90deg, swapping its footprint for 90/270. */
  rotateSelected: () => void
  setAddRoomMode: (on: boolean) => void
  selectRoom: (roomId: string | null) => void
  /** Add a room from a drawn rectangle and leave add-room mode. */
  commitRoom: (bounds: RoomRect) => void
  /**
   * Edit a room's name/color/bounds from the properties panel. Bounds are merged
   * onto the current rect and applied EXACTLY (no grid snap) so typed footprints
   * land precisely; a patch that would make an edge < MIN_ROOM_M, or any non-finite
   * value, is rejected wholesale (the room is left unchanged).
   */
  updateRoom: (
    roomId: string,
    patch: { name?: string; color?: string; bounds?: Partial<RoomRect> },
  ) => void
  deleteSelectedRoom: () => void
  /**
   * Set a rack's position/rotation EXACTLY (no grid snap) from the properties
   * panel. Non-finite coordinates are rejected. A changed rotation recomputes the
   * footprint with the same base-recovery logic as rotateSelected.
   */
  updateRackPrecise: (rackId: string, x: number, z: number, rotationDeg?: Rotation) => void
  /** Set explicit floor dimensions, or null to auto-fit to racks + rooms. */
  setFloor: (floor: FloorDimensions | null) => void
  setGridSnap: (meters: number) => void
  /** Switch the display unit (meters/feet); persisted, does not dirty the layout. */
  setLengthUnit: (unit: LengthUnit) => void
  toggleTopDownView: () => void
  setCameraControlsRef: (ref: { current: CameraControls | null } | null) => void
  markDirty: () => void
  /** Clear dirty after a successful save (working copy becomes the new baseline). */
  markSaved: () => void
  /** Discard unsaved edits, restoring the last-saved/seeded working copy. */
  revert: () => void
  /** Replace the working copy from an imported layout, overlaid on current racks. */
  importLayout: (layout: SiteLayout) => void
  /** Build the PUT payload from the current working copy. */
  buildLayoutPayload: () => LayoutPayload
}

// Monotonic id source for drawn rooms (unique within a session is enough).
let roomSeq = 0

export const useEditStore = create<EditState>((set, get) => ({
  editModeActive: false,
  selectedRackId: null,
  addRoomMode: false,
  selectedRoomId: null,
  gridSnap: 0.25,
  lengthUnit: 'm',
  topDownView: false,
  dirty: false,
  workingPlacements: [],
  workingRooms: [],
  floor: null,
  cameraControlsRef: null,
  seed: { placements: [], rooms: [], floor: null },

  enterEditMode: (placements, rooms = [], floor = null) => {
    // Freeze the distance-driven nav machine for the whole edit session so drags
    // and the top-down snap can't trip enterRack/exitSite. (Same lever device
    // focus uses.)
    useAppStore.getState().setNavSuppressed(true)
    set({
      editModeActive: true,
      lengthUnit: loadUnitPreference(),
      workingPlacements: placements.map((p) => ({ ...p })),
      workingRooms: rooms.map((r) => ({ ...r })),
      floor,
      seed: { placements: placements.map((p) => ({ ...p })), rooms: rooms.map((r) => ({ ...r })), floor },
      dirty: false,
      selectedRackId: null,
      selectedRoomId: null,
      addRoomMode: false,
      topDownView: false,
    })
  },

  exitEditMode: () => {
    useAppStore.getState().setNavSuppressed(false)
    set({
      editModeActive: false,
      workingPlacements: [],
      workingRooms: [],
      floor: null,
      dirty: false,
      selectedRackId: null,
      selectedRoomId: null,
      addRoomMode: false,
      topDownView: false,
    })
  },

  selectRack: (rackId) => set({ selectedRackId: rackId, selectedRoomId: null }),

  updateRackPosition: (rackId, x, z) => {
    const { gridSnap } = get()
    const nx = snapToGrid(x, gridSnap)
    const nz = snapToGrid(z, gridSnap)
    set((s) => ({
      dirty: true,
      workingPlacements: s.workingPlacements.map((p) =>
        p.rackId === rackId ? { ...p, x: nx, z: nz } : p,
      ),
    }))
  },

  updateRackPrecise: (rackId, x, z, rotationDeg) =>
    set((s) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return s
      return {
        dirty: true,
        workingPlacements: s.workingPlacements.map((p) => {
          if (p.rackId !== rackId) return p
          if (rotationDeg === undefined || rotationDeg === (p.rotationDeg ?? 0)) {
            return { ...p, x, z }
          }
          // Recover the unrotated footprint, then apply the target rotation's swap
          // (identical logic to rotateSelected so both paths stay consistent).
          const cur = p.rotationDeg ?? 0
          const swapped = cur === 90 || cur === 270
          const baseW = swapped ? p.depth : p.width
          const baseD = swapped ? p.width : p.depth
          const fp = rotatedFootprint(baseW, baseD, rotationDeg)
          return { ...p, x, z, rotationDeg, width: fp.width, depth: fp.depth }
        }),
      }
    }),

  rotateSelected: () =>
    set((s) => {
      const id = s.selectedRackId
      if (!id) return s
      return {
        dirty: true,
        workingPlacements: s.workingPlacements.map((p) => {
          if (p.rackId !== id) return p
          const cur = p.rotationDeg ?? 0
          // Recover the unrotated footprint, then apply the next rotation's swap.
          const swapped = cur === 90 || cur === 270
          const baseW = swapped ? p.depth : p.width
          const baseD = swapped ? p.width : p.depth
          const next = (((cur + 90) % 360) as Rotation)
          const fp = rotatedFootprint(baseW, baseD, next)
          return { ...p, rotationDeg: next, width: fp.width, depth: fp.depth }
        }),
      }
    }),

  // Entering add-room mode snaps to the top-down view so drawing the rectangle is
  // a predictable 2D gesture; leaving it keeps the current view (no jarring snap-back).
  setAddRoomMode: (on) =>
    set((s) => ({ addRoomMode: on, selectedRoomId: null, topDownView: on ? true : s.topDownView })),
  selectRoom: (roomId) => set({ selectedRoomId: roomId, selectedRackId: null }),
  commitRoom: (bounds) =>
    set((s) => {
      const room: LayoutRoom = { id: `room-${++roomSeq}`, name: `Room ${s.workingRooms.length + 1}`, bounds }
      return { workingRooms: [...s.workingRooms, room], addRoomMode: false, dirty: true }
    }),
  updateRoom: (roomId, patch) =>
    set((s) => {
      const room = s.workingRooms.find((r) => r.id === roomId)
      if (!room) return s
      const bounds = patch.bounds ? { ...room.bounds, ...patch.bounds } : room.bounds
      if (patch.bounds) {
        const { x, z, width, depth } = bounds
        if (![x, z, width, depth].every(Number.isFinite)) return s
        if (width < MIN_ROOM_M || depth < MIN_ROOM_M) return s
      }
      return {
        dirty: true,
        workingRooms: s.workingRooms.map((r) =>
          r.id === roomId
            ? {
                ...r,
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.color !== undefined ? { color: patch.color } : {}),
                bounds,
              }
            : r,
        ),
      }
    }),
  deleteSelectedRoom: () =>
    set((s) => {
      if (!s.selectedRoomId) return s
      return {
        workingRooms: s.workingRooms.filter((r) => r.id !== s.selectedRoomId),
        selectedRoomId: null,
        dirty: true,
      }
    }),
  setFloor: (floor) => set({ floor, dirty: true }),

  setGridSnap: (meters) => set({ gridSnap: meters }),
  setLengthUnit: (unit) => {
    saveUnitPreference(unit)
    set({ lengthUnit: unit })
  },
  toggleTopDownView: () => set((s) => ({ topDownView: !s.topDownView })),
  setCameraControlsRef: (ref) => set({ cameraControlsRef: ref }),
  markDirty: () => set({ dirty: true }),
  markSaved: () =>
    set((s) => ({
      dirty: false,
      // the saved working copy becomes the new revert baseline
      seed: {
        placements: s.workingPlacements.map((p) => ({ ...p })),
        rooms: s.workingRooms.map((r) => ({ ...r })),
        floor: s.floor,
      },
    })),
  revert: () =>
    set((s) => ({
      workingPlacements: s.seed.placements.map((p) => ({ ...p })),
      workingRooms: s.seed.rooms.map((r) => ({ ...r })),
      floor: s.seed.floor,
      dirty: false,
      selectedRackId: null,
      selectedRoomId: null,
      addRoomMode: false,
    })),
  importLayout: (layout) =>
    set((s) => {
      const overrides = new Map(layout.racks.map((o) => [o.rackId, o]))
      const workingPlacements = s.workingPlacements.map((p) => {
        const o = overrides.get(p.rackId)
        if (!o) return p
        const fp = rotatedFootprint(
          p.rotationDeg === 90 || p.rotationDeg === 270 ? p.depth : p.width,
          p.rotationDeg === 90 || p.rotationDeg === 270 ? p.width : p.depth,
          o.rotationDeg,
        )
        return { ...p, x: o.x, z: o.z, rotationDeg: o.rotationDeg, width: fp.width, depth: fp.depth }
      })
      return {
        workingPlacements,
        workingRooms: layout.rooms.map((r) => ({ ...r })),
        floor: layout.floor,
        dirty: true,
        selectedRackId: null,
        selectedRoomId: null,
        addRoomMode: false,
      }
    }),

  buildLayoutPayload: () => {
    const { workingPlacements, workingRooms, floor } = get()
    return {
      racks: workingPlacements.map((p) => ({
        rackId: p.rackId,
        x: p.x,
        z: p.z,
        rotationDeg: (p.rotationDeg ?? 0) as Rotation,
      })),
      rooms: workingRooms,
      floor,
    }
  },
}))

// dev-only handle for driving/inspecting edit mode from the console and tests
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__editStore = useEditStore
}
