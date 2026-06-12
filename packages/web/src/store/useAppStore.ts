import { create } from 'zustand'

export type ViewLevel = 'globe' | 'site' | 'rack'

interface AppState {
  level: ViewLevel
  selectedSiteName: string | null
  selectedRackId: string | null
  selectedDeviceId: string | null
  zoomToSite: (siteName: string) => void
  zoomToRack: (rackId: string) => void
  zoomToGlobe: () => void
  selectDevice: (deviceId: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  level: 'globe',
  selectedSiteName: null,
  selectedRackId: null,
  selectedDeviceId: null,
  zoomToSite: (siteName) =>
    set({ level: 'site', selectedSiteName: siteName, selectedRackId: null, selectedDeviceId: null }),
  zoomToRack: (rackId) => set({ level: 'rack', selectedRackId: rackId }),
  zoomToGlobe: () =>
    set({ level: 'globe', selectedSiteName: null, selectedRackId: null, selectedDeviceId: null }),
  selectDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
}))

// dev-only handle for driving/inspecting navigation from the console and tests
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__appStore = useAppStore
}
