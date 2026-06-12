import { create } from 'zustand'

export type ViewLevel = 'map' | 'site' | 'rack'

export interface MapView {
  center: [number, number]
  zoom: number
}

interface AppState {
  level: ViewLevel
  selectedSiteName: string | null
  selectedRackId: string | null
  selectedDeviceId: string | null
  /** Last map position, restored when zooming back out of a site. */
  mapView: MapView | null
  zoomToSite: (siteName: string) => void
  zoomToRack: (rackId: string) => void
  zoomToMap: () => void
  selectDevice: (deviceId: string | null) => void
  setMapView: (view: MapView) => void
}

export const useAppStore = create<AppState>((set) => ({
  level: 'map',
  selectedSiteName: null,
  selectedRackId: null,
  selectedDeviceId: null,
  mapView: null,
  zoomToSite: (siteName) =>
    set({ level: 'site', selectedSiteName: siteName, selectedRackId: null, selectedDeviceId: null }),
  zoomToRack: (rackId) => set({ level: 'rack', selectedRackId: rackId }),
  zoomToMap: () =>
    set({ level: 'map', selectedSiteName: null, selectedRackId: null, selectedDeviceId: null }),
  selectDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
  setMapView: (view) => set({ mapView: view }),
}))

// dev-only handle for driving/inspecting navigation from the console and tests
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__appStore = useAppStore
}
