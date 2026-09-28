import { create } from 'zustand'
import {
  DEFAULT_THRESHOLDS,
  initialNavMachine,
  stepNavigation,
  thresholdsForSpan,
} from '@net3d/shared'
import type { LogicalLayer, TracePath } from '@net3d/shared'
import type { SpecMetric } from '../lib/specsHeatmap'
import type { PowerSource } from '../lib/powerChain'
import type { Backend } from '../lib/api'
import { loadSitesMenuOpen, saveSitesMenuOpen } from '../lib/sitesMenuStorage'

export type ViewLevel = 'map' | 'site' | 'rack'
export type ViewMode = 'physical' | 'logical'

/**
 * The single active "color by" dimension for device/rack boxes. Only one is live
 * at a time (the unified Layers panel is single-select); each dimension keeps its
 * own sub-state (highlightedRoles for 'role', specsHeatmapMetric for 'specs', …).
 */
export type ColorMode = 'none' | 'role' | 'specs' | 'capacity' | 'status' | 'subnet'

/** How cables are colored: by physical medium (fiber/copper/…), by line rate (rack view only), or by live gNMI utilisation (rack and site view). */
export type CableColorMode = 'medium' | 'speed' | 'live'

/** Map zoom to land on when exiting a site — just below the re-arm threshold. */
const MAP_RETURN_ZOOM = 13

export interface MapView {
  center: [number, number]
  zoom: number
}

/** A device the user asked to zoom to, resolved to its location in the index. */
export interface DeviceFocusTarget {
  siteName: string
  rackId: string
  deviceId: string
}

interface AppState {
  /** Active cable trace through patch panels; null when not tracing. */
  activeTrace: TracePath | null
  setTrace: (path: TracePath) => void
  clearTrace: () => void
  /** Active source of truth; switching it flips the API prefix and resets the view. */
  backend: Backend
  setBackend: (backend: Backend) => void
  /** Scene mode: 'physical' (3D rooms/racks) or 'logical' (topology graph). */
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  /** Logical view: layers to hide in the topology graph. 'end' hides end devices. */
  hiddenLogical: Set<LogicalLayer | 'end'>
  toggleHiddenLogical: (layer: LogicalLayer | 'end') => void
  level: ViewLevel
  selectedSiteName: string | null
  selectedRackId: string | null
  selectedDeviceId: string | null
  /**
   * In-flight request to zoom to a searched device. Set by focusDevice; an
   * effect in App consumes it once the target site's detail has loaded (the
   * rack/device only exist then). Manual navigation clears it.
   */
  pendingDeviceFocus: DeviceFocusTarget | null
  /** Last map position, restored when zooming back out of a site. */
  mapView: MapView | null
  zoomToSite: (siteName: string) => void
  zoomToRack: (rackId: string) => void
  zoomToMap: () => void
  selectDevice: (deviceId: string | null) => void
  /** Begin staged navigation to a device: site → (await load) → rack → select. */
  focusDevice: (target: DeviceFocusTarget) => void
  /** Drop an in-flight device focus (once consumed, or on manual navigation). */
  clearPendingFocus: () => void
  /**
   * While true, handleCameraSignals ignores the camera so the distance-driven
   * nav machine can't fire mid programmatic fly. focusDevice sets it; an App
   * timer resumes it once the camera has settled. A cross-level focus fly passes
   * through far distances that would otherwise trip exitToSite/exitToMap.
   */
  navSuppressed: boolean
  setNavSuppressed: (suppressed: boolean) => void
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
  /** Active "color by" dimension (unified Layers panel; single-select). 'none' = default box colors. */
  colorMode: ColorMode
  setColorMode: (mode: ColorMode) => void
  /** Status filter (rack view): device statuses to hide. Empty = show all. */
  hiddenStatuses: Set<string>
  toggleHiddenStatus: (status: string) => void
  /** Cable coloring (rack and site view): by physical medium (default), by interface line rate (rack view only), or by live gNMI utilisation. */
  cableColorMode: CableColorMode
  setCableColorMode: (mode: CableColorMode) => void
  /** Rack view: render each device's primary IP as a label. */
  ipLabelsVisible: boolean
  toggleIpLabels: () => void
  /** Specs heatmap: recolor devices (rack) and racks (room) by this metric; null = off. */
  specsHeatmapMetric: SpecMetric | null
  setSpecsMetric: (metric: SpecMetric | null) => void
  /** Left sites-menu (sites grouped by region): open or collapsed. Persisted. */
  sitesMenuOpen: boolean
  toggleSitesMenu: () => void
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
  activeTrace: null,
  setTrace: (path) => set({ activeTrace: path }),
  clearTrace: () => set({ activeTrace: null }),
  backend: 'netbox',
  setBackend: (backend) => {
    if (backend === get().backend) return
    // A site/rack selected against one backend need not exist in the other, so
    // return to the map. zoomToMap also clears overlays/selection cleanly.
    get().zoomToMap()
    set({ backend, viewMode: 'physical' })
  },
  viewMode: 'physical',
  setViewMode: (mode) => {
    if (mode === get().viewMode) return
    const { level } = get()
    // Reset the nav machine so zoom gestures don't cause spurious transitions.
    // If already at site level, arm the exit so zoom-out-to-map still works.
    navMachine = { ...initialNavMachine(), exitSiteArmed: level === 'site' }
    set({ viewMode: mode, selectedDeviceId: null, activeTrace: null, navSuppressed: true })
  },
  hiddenLogical: new Set<LogicalLayer | 'end'>(),
  toggleHiddenLogical: (layer) =>
    set((s) => {
      const next = new Set(s.hiddenLogical)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return { hiddenLogical: next }
    }),
  level: 'map',
  selectedSiteName: null,
  selectedRackId: null,
  selectedDeviceId: null,
  pendingDeviceFocus: null,
  mapView: null,
  zoomToSite: (siteName) => {
    // Arm the site exit on entry so zoom-out-to-map is always reachable. The
    // nav-machine actions do this for zoom-driven entry; this also covers the
    // click paths (map-marker click) that bypass the machine. See navigation.ts.
    navMachine = { ...navMachine, exitSiteArmed: true }
    set((s) => ({
      level: 'site',
      selectedSiteName: siteName,
      selectedRackId: null,
      selectedDeviceId: null,
      // A user-initiated site jump cancels any in-flight device focus. focusDevice
      // sets pendingDeviceFocus *after* calling this, so its own focus survives.
      pendingDeviceFocus: null,
      rackView: 'front',
      siteViewDistance: null,
      // Same stale-signal gap as zoomToRack: the camera may still sit next to a
      // rack when the level flips to 'site', and an onChange before the fly
      // starts would re-enter that rack. Suppress until the fly settles.
      navSuppressed: true,
      // Keep the legend selection when bouncing back to the same room (rack->site
      // exit reuses this action); clear it when entering a different site, since
      // roles are per-site. Same for activeTrace - cable IDs are site-local.
      highlightedRoles: siteName === s.selectedSiteName ? s.highlightedRoles : new Set<string>(),
      activeTrace: siteName === s.selectedSiteName ? s.activeTrace : null,
    }))
  },
  zoomToRack: (rackId) => {
    // Arm the rack exit on entry (covers rack-click entry that bypasses the
    // nav machine) so zoom-out-to-room is always reachable. See navigation.ts.
    navMachine = { ...navMachine, exitRackArmed: true, enterRackArmed: false }
    // activeTrace survives rack hops — it's site-scoped, and following a traced
    // path rack-to-rack is exactly how the trace UI navigates.
    // navSuppressed: the exit above is armed while the camera still sits at SITE
    // distance; CameraRig only suppresses signals once its fly effect runs, so a
    // damping onChange in that gap would fire exitToSite and undo the click
    // ("clicking a rack sometimes does nothing"). Suppress synchronously here;
    // App's watchdog resumes the machine after the fly settles.
    set({ level: 'rack', selectedRackId: rackId, rackView: 'front', pendingDeviceFocus: null, navSuppressed: true })
  },
  zoomToMap: () =>
    set({ level: 'map', selectedSiteName: null, selectedRackId: null, selectedDeviceId: null, pendingDeviceFocus: null, navSuppressed: false, siteViewDistance: null, highlightedRoles: new Set<string>(), powerVisible: false, selectedPowerSource: null, specsHeatmapMetric: null, colorMode: 'none', hiddenStatuses: new Set<string>(), cableColorMode: 'medium', ipLabelsVisible: false, activeTrace: null }),
  selectDevice: (deviceId) => set({ selectedDeviceId: deviceId, activeTrace: deviceId ? get().activeTrace : null }),
  focusDevice: (target) => {
    const { level, selectedSiteName } = get()
    // From the map, or when the device lives in another site, fly to its site
    // first; the App effect finishes the hop (rack + select) once it loads. When
    // already viewing that site, stay put — the effect resolves it immediately.
    if (level === 'map' || selectedSiteName !== target.siteName) get().zoomToSite(target.siteName)
    // Suppress the distance-driven nav machine for the whole programmatic fly:
    // a map/site → rack hop sweeps through far distances that would otherwise
    // trip exitToSite/exitToMap. An App timer resumes it once the camera settles.
    set({ pendingDeviceFocus: target, navSuppressed: true })
  },
  clearPendingFocus: () => set({ pendingDeviceFocus: null }),
  navSuppressed: false,
  setNavSuppressed: (suppressed) => set({ navSuppressed: suppressed }),
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
  colorMode: 'none',
  setColorMode: (mode) => set({ colorMode: mode }),
  hiddenStatuses: new Set<string>(),
  toggleHiddenStatus: (status) =>
    set((s) => {
      const next = new Set(s.hiddenStatuses)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return { hiddenStatuses: next }
    }),
  cableColorMode: 'medium',
  setCableColorMode: (mode) => set({ cableColorMode: mode }),
  ipLabelsVisible: false,
  toggleIpLabels: () => set((s) => ({ ipLabelsVisible: !s.ipLabelsVisible })),
  specsHeatmapMetric: null,
  setSpecsMetric: (metric) => set({ specsHeatmapMetric: metric }),
  sitesMenuOpen: loadSitesMenuOpen(),
  toggleSitesMenu: () => {
    const next = !get().sitesMenuOpen
    saveSitesMenuOpen(next)
    set({ sitesMenuOpen: next })
  },

  handleMapSignals: (zoom, site) => {
    const { level, viewMode, zoomToSite, setMapView } = get()
    if (level !== 'map') return
    // Logical mode at map level: pan/zoom the backbone graph, never zoom-enter a site.
    if (viewMode === 'logical') return
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
    const { level, selectedSiteName, zoomToSite, zoomToRack, zoomToMap, navSuppressed, viewMode } = get()
    if (level === 'map') return
    // Logical mode at site level: orbit the topology graph, never zoom-enter a rack.
    // Rack level (reached via device search) still allows exitToSite.
    if (viewMode === 'logical' && level === 'site') return
    // record camera distance only at site level — drives rack-label LOD; a passive
    // reading, so it records even while the nav machine is suppressed below
    if (level === 'site') set({ siteViewDistance: distToSite })
    // A programmatic fly (level change or zoom-to-device) is in flight: ignore the
    // camera so the machine can't bounce levels on a mid-flight far-distance reading.
    if (navSuppressed) return
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
