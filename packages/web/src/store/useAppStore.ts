import { create } from 'zustand'
import {
  DEFAULT_THRESHOLDS,
  initialNavMachine,
  stepNavigation,
} from '@net3d/shared'

export type ViewLevel = 'map' | 'site' | 'rack'

/** Map zoom to land on when exiting a site — just below the re-arm threshold. */
const MAP_RETURN_ZOOM = 13

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
  /** Rack view: render server↔leaf/OOB connectivity lines. */
  connectivityVisible: boolean
  toggleConnectivity: () => void
  /** Device under the pointer in the rack view (drives cable highlighting). */
  hoveredDeviceId: string | null
  setHoveredDevice: (deviceId: string | null) => void
  /** Leaflet zoomend/moveend feed: candidate site near the view center, if any. */
  handleMapSignals: (zoom: number, site: { name: string; lat: number; lng: number } | null) => void
  /** CameraControls feed at site/rack level. */
  handleCameraSignals: (
    distToSite: number | null,
    distToRack: number | null,
    nearestRackId: string | null,
  ) => void
}

// Hysteresis machine lives outside React state — stepping it must not re-render.
let navMachine = initialNavMachine()

export const useAppStore = create<AppState>((set, get) => ({
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
  connectivityVisible: true,
  toggleConnectivity: () => set({ connectivityVisible: !get().connectivityVisible }),
  hoveredDeviceId: null,
  setHoveredDevice: (deviceId) => set({ hoveredDeviceId: deviceId }),

  handleMapSignals: (zoom, site) => {
    const { level, zoomToSite, setMapView } = get()
    if (level !== 'map') return
    const r = stepNavigation(
      navMachine,
      { level: 'map', mapZoom: zoom, siteUnderCenter: site?.name ?? null },
      DEFAULT_THRESHOLDS,
    )
    navMachine = r.machine
    if (r.action?.type === 'enterSite' && site) {
      setMapView({ center: [site.lat, site.lng], zoom: MAP_RETURN_ZOOM })
      zoomToSite(site.name)
    }
  },

  handleCameraSignals: (distToSite, distToRack, nearestRackId) => {
    const { level, selectedSiteName, zoomToSite, zoomToRack, zoomToMap } = get()
    if (level === 'map') return
    const r = stepNavigation(
      navMachine,
      {
        level,
        cameraDistToSite: distToSite,
        cameraDistToRack: distToRack,
        nearestRackId,
      },
      DEFAULT_THRESHOLDS,
    )
    navMachine = r.machine
    if (!r.action) return
    if (r.action.type === 'exitToMap') zoomToMap()
    else if (r.action.type === 'enterRack') zoomToRack(r.action.rackId)
    else if (r.action.type === 'exitToSite' && selectedSiteName) zoomToSite(selectedSiteName)
  },
}))

// dev-only handle for driving/inspecting navigation from the console and tests
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__appStore = useAppStore
}
