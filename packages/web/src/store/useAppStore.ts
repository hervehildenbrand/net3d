import { create } from 'zustand'
import {
  DEFAULT_THRESHOLDS,
  initialNavMachine,
  stepNavigation,
  thresholdsForSpan,
} from '@net3d/shared'
import type { SpecMetric } from '../lib/specsHeatmap'
import type { PowerSource } from '../lib/powerChain'

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
  /** Power overlay: PDU rails + A/B power cords (rack) and per-rack PDU strips (room). */
  powerVisible: boolean
  togglePower: () => void
  /** Power-chain root: a clicked panel/feed whose fed racks + devices are highlighted; null = none. */
  selectedPowerSource: PowerSource | null
  setPowerSource: (source: PowerSource | null) => void
  /** Site view: render labelled inter-DC circuit links radiating toward peer sites. */
  dcLinksVisible: boolean
  toggleDcLinks: () => void
  /** Rack view camera side: 'rear' frames the cabling, 'front' the device faces. */
  rackView: 'front' | 'rear'
  toggleRackView: () => void
  /** Camera distance from the site center (m) while at site level; null otherwise. Drives rack-label LOD. */
  siteViewDistance: number | null
  setSiteViewDistance: (distance: number | null) => void
  /** Device under the pointer in the rack view (drives cable highlighting). */
  hoveredDeviceId: string | null
  setHoveredDevice: (deviceId: string | null) => void
  /** Room view: NetBox role names to highlight (per-device markers + rack dimming). Empty = off. */
  highlightedRoles: Set<string>
  toggleHighlightedRole: (name: string) => void
  clearHighlightedRoles: () => void
  /** Specs heatmap: recolor devices (rack) and racks (room) by this metric; null = off. */
  specsHeatmapMetric: SpecMetric | null
  setSpecsMetric: (metric: SpecMetric | null) => void
  /** Leaflet zoomend/moveend feed: candidate site near the view center, if any. */
  handleMapSignals: (zoom: number, site: { name: string; lat: number; lng: number } | null) => void
  /** CameraControls feed at site/rack level; span sizes the exit thresholds. */
  handleCameraSignals: (
    distToSite: number | null,
    distToRack: number | null,
    nearestRackId: string | null,
    siteSpan?: number | null,
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
    set((s) => ({
      level: 'site',
      selectedSiteName: siteName,
      selectedRackId: null,
      selectedDeviceId: null,
      rackView: 'front',
      siteViewDistance: null,
      // Keep the legend selection when bouncing back to the same room (rack->site
      // exit reuses this action); clear it when entering a different site, since
      // roles are per-site.
      highlightedRoles: siteName === s.selectedSiteName ? s.highlightedRoles : new Set<string>(),
    })),
  zoomToRack: (rackId) => set({ level: 'rack', selectedRackId: rackId, rackView: 'front' }),
  zoomToMap: () =>
    set({ level: 'map', selectedSiteName: null, selectedRackId: null, selectedDeviceId: null, siteViewDistance: null, highlightedRoles: new Set<string>(), powerVisible: false, selectedPowerSource: null, specsHeatmapMetric: null }),
  selectDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
  setMapView: (view) => set({ mapView: view }),
  connectivityVisible: true,
  toggleConnectivity: () => set({ connectivityVisible: !get().connectivityVisible }),
  powerVisible: false,
  // turning the overlay off also drops any chain selection — it has no meaning hidden
  togglePower: () =>
    set((s) => (s.powerVisible ? { powerVisible: false, selectedPowerSource: null } : { powerVisible: true })),
  selectedPowerSource: null,
  setPowerSource: (source) => set({ selectedPowerSource: source }),
  dcLinksVisible: false,
  toggleDcLinks: () => set({ dcLinksVisible: !get().dcLinksVisible }),
  rackView: 'front',
  toggleRackView: () => set({ rackView: get().rackView === 'front' ? 'rear' : 'front' }),
  siteViewDistance: null,
  setSiteViewDistance: (distance) => set({ siteViewDistance: distance }),
  hoveredDeviceId: null,
  setHoveredDevice: (deviceId) => set({ hoveredDeviceId: deviceId }),
  highlightedRoles: new Set<string>(),
  toggleHighlightedRole: (name) =>
    set((s) => {
      const next = new Set(s.highlightedRoles)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return { highlightedRoles: next }
    }),
  clearHighlightedRoles: () => set({ highlightedRoles: new Set<string>() }),
  specsHeatmapMetric: null,
  setSpecsMetric: (metric) => set({ specsHeatmapMetric: metric }),

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

  handleCameraSignals: (distToSite, distToRack, nearestRackId, siteSpan = null) => {
    const { level, selectedSiteName, zoomToSite, zoomToRack, zoomToMap } = get()
    if (level === 'map') return
    // record camera distance only at site level — drives rack-label LOD
    if (level === 'site') set({ siteViewDistance: distToSite })
    const r = stepNavigation(
      navMachine,
      {
        level,
        cameraDistToSite: distToSite,
        cameraDistToRack: distToRack,
        nearestRackId,
      },
      thresholdsForSpan(siteSpan),
    )
    navMachine = r.machine
    if (!r.action) return
    if (r.action.type === 'exitToMap') zoomToMap()
    else if (r.action.type === 'enterRack') zoomToRack(r.action.rackId)
    else if (r.action.type === 'exitToSite' && selectedSiteName) zoomToSite(selectedSiteName)
  },
}))

// dev-only handle for driving/inspecting navigation from the console and tests
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__appStore = useAppStore
}
