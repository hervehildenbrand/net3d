import { create } from 'zustand'
import type { CameraControls } from '@react-three/drei'
import {
  rotatedFootprint,
  snapToGrid,
  type FloorDimensions,
  type LayoutRoom,
  type RackPlacement,
  type Rotation,
  type SiteLayout,
} from '@net3d/shared'
import { useAppStore } from './useAppStore'

/** The editable parts of a SiteLayout (server stamps version + updatedAt). */
export type LayoutPayload = Pick<SiteLayout, 'racks' | 'rooms' | 'floor'>

interface EditState {
  /** Floor-plan edit mode is active (site level only). */
  editModeActive: boolean
  /** Rack selected for manipulation (rotate/inspect); null = none. */
  selectedRackId: string | null
  /** Snap pitch in meters; 0 = free placement. */
  gridSnap: number
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

  enterEditMode: (placements: RackPlacement[], rooms?: LayoutRoom[], floor?: FloorDimensions | null) => void
  exitEditMode: () => void
  selectRack: (rackId: string | null) => void
  updateRackPosition: (rackId: string, x: number, z: number) => void
  /** Rotate the selected rack +90deg, swapping its footprint for 90/270. */
  rotateSelected: () => void
  setGridSnap: (meters: number) => void
  toggleTopDownView: () => void
  setCameraControlsRef: (ref: { current: CameraControls | null } | null) => void
  markDirty: () => void
  /** Clear dirty after a successful save (working copy becomes the new baseline). */
  markSaved: () => void
  /** Build the PUT payload from the current working copy. */
  buildLayoutPayload: () => LayoutPayload
}

export const useEditStore = create<EditState>((set, get) => ({
  editModeActive: false,
  selectedRackId: null,
  gridSnap: 0.25,
  topDownView: false,
  dirty: false,
  workingPlacements: [],
  workingRooms: [],
  floor: null,
  cameraControlsRef: null,

  enterEditMode: (placements, rooms = [], floor = null) => {
    // Freeze the distance-driven nav machine for the whole edit session so drags
    // and the top-down snap can't trip enterRack/exitSite. (Same lever device
    // focus uses.)
    useAppStore.getState().setNavSuppressed(true)
    set({
      editModeActive: true,
      workingPlacements: placements.map((p) => ({ ...p })),
      workingRooms: rooms.map((r) => ({ ...r })),
      floor,
      dirty: false,
      selectedRackId: null,
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
      topDownView: false,
    })
  },

  selectRack: (rackId) => set({ selectedRackId: rackId }),

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

  setGridSnap: (meters) => set({ gridSnap: meters }),
  toggleTopDownView: () => set((s) => ({ topDownView: !s.topDownView })),
  setCameraControlsRef: (ref) => set({ cameraControlsRef: ref }),
  markDirty: () => set({ dirty: true }),
  markSaved: () => set({ dirty: false }),

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
