import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  commitRateToSpeedBucket,
  compassBearing,
  lldpToSegments,
  type RackLocation,
} from '@net3d/shared'
import type { DcLink } from './scene/dclinks'
import { MapLayer } from './map/MapLayer'
import { useLldpDiscovery } from './hooks/useLldpDiscovery'
import { useCapabilities } from './hooks/useCapabilities'
import { SiteLevel, useSiteLayout } from './scene/SiteLevel'
import { RackLevel } from './scene/RackLevel'
import { CameraRig } from './scene/CameraRig'
import { useSites } from './hooks/useSites'
import { connectionErrorMessage } from './connectionError'
import { useCircuits } from './hooks/useCircuits'
import { useSiteDetail } from './hooks/useSiteDetail'
import { useDeviceIndex } from './hooks/useDeviceIndex'
import { useAppStore } from './store/useAppStore'
import { DevicePanel } from './components/DevicePanel'
import { SiteSearch } from './components/SiteSearch'
import { DeviceSearch } from './components/DeviceSearch'
import { LayersPanel } from './components/LayersPanel'
import { PowerLegend } from './components/PowerLegend'
import { BackendSwitcher } from './components/BackendSwitcher'
import { computeSpecsRange } from './lib/specsHeatmap'
import { tracePowerChain } from './lib/powerChain'
import { SceneErrorBoundary } from './components/SceneErrorBoundary'

const hudStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  color: '#475569',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
  zIndex: 20,
}

/** Stable empty set so the scene's role prop keeps a constant identity when role-coloring is off. */
const NO_ROLES: Set<string> = new Set<string>()

export function App() {
  const { data: sites, isLoading, error } = useSites()
  const { data: circuitGroups } = useCircuits()
  const level = useAppStore((s) => s.level)
  const selectedSiteName = useAppStore((s) => s.selectedSiteName)
  const zoomToSite = useAppStore((s) => s.zoomToSite)
  const zoomToRack = useAppStore((s) => s.zoomToRack)
  const zoomToMap = useAppStore((s) => s.zoomToMap)
  const selectedRackId = useAppStore((s) => s.selectedRackId)
  const selectedDeviceId = useAppStore((s) => s.selectedDeviceId)
  const selectDevice = useAppStore((s) => s.selectDevice)
  const pendingDeviceFocus = useAppStore((s) => s.pendingDeviceFocus)
  const focusDevice = useAppStore((s) => s.focusDevice)
  const clearPendingFocus = useAppStore((s) => s.clearPendingFocus)
  const navSuppressed = useAppStore((s) => s.navSuppressed)
  const setNavSuppressed = useAppStore((s) => s.setNavSuppressed)
  const connectivityVisible = useAppStore((s) => s.connectivityVisible)
  const toggleConnectivity = useAppStore((s) => s.toggleConnectivity)
  const powerVisible = useAppStore((s) => s.powerVisible)
  const togglePower = useAppStore((s) => s.togglePower)
  const selectedPowerSource = useAppStore((s) => s.selectedPowerSource)
  const setPowerSource = useAppStore((s) => s.setPowerSource)
  const dcLinksVisible = useAppStore((s) => s.dcLinksVisible)
  const toggleDcLinks = useAppStore((s) => s.toggleDcLinks)
  const rackView = useAppStore((s) => s.rackView)
  const toggleRackView = useAppStore((s) => s.toggleRackView)
  const colorMode = useAppStore((s) => s.colorMode)
  const setColorMode = useAppStore((s) => s.setColorMode)
  const hiddenStatuses = useAppStore((s) => s.hiddenStatuses)
  const toggleHiddenStatus = useAppStore((s) => s.toggleHiddenStatus)
  const highlightedRoles = useAppStore((s) => s.highlightedRoles)
  const toggleHighlightedRole = useAppStore((s) => s.toggleHighlightedRole)
  const clearHighlightedRoles = useAppStore((s) => s.clearHighlightedRoles)
  const specsHeatmapMetric = useAppStore((s) => s.specsHeatmapMetric)
  const setSpecsMetric = useAppStore((s) => s.setSpecsMetric)
  const { data: siteDetail, isLoading: siteLoading } = useSiteDetail(
    level !== 'map' ? selectedSiteName : null,
  )
  const { placements } = useSiteLayout(siteDetail?.racks)
  const selectedRack = siteDetail?.racks.find((r) => r.id === selectedRackId)
  const selectedPlacement = placements.find((p) => p.rackId === selectedRackId)
  const selectedDevice = selectedRack?.devices.find((d) => d.id === selectedDeviceId)

  // Global device search index (backend-agnostic; refetched per backend).
  const { data: deviceIndex } = useDeviceIndex()

  // Staged zoom-to-device from the search box. The searched device may live in a
  // different site, whose racks only exist once its detail has loaded — so once
  // the target site is loaded, hop into the rack and select the device. This
  // reuses the normal rack fly-in (CameraRig), so there's no bespoke camera or
  // nav-machine code. Idempotent: zoomToRack clears the pending focus, and the
  // same-rack / device-gone paths fall through to clearPendingFocus.
  useEffect(() => {
    if (!pendingDeviceFocus || !siteDetail) return
    if (selectedSiteName !== pendingDeviceFocus.siteName) return
    const { rackId, deviceId } = pendingDeviceFocus
    const rack = siteDetail.racks.find((r) => r.id === rackId)
    if (rack) {
      if (selectedRackId !== rackId) zoomToRack(rackId)
      if (rack.devices.some((d) => d.id === deviceId)) selectDevice(deviceId)
    }
    clearPendingFocus()
  }, [
    pendingDeviceFocus,
    siteDetail,
    selectedSiteName,
    selectedRackId,
    zoomToRack,
    selectDevice,
    clearPendingFocus,
  ])

  // Resume the nav machine once the focus fly has settled. CameraRig's smoothTime
  // is 0.6s; a generous margin covers a long map→rack hop before the camera, now
  // at rest near the rack, starts feeding the machine again (zoom-out still works).
  useEffect(() => {
    if (!navSuppressed) return
    const id = setTimeout(() => setNavSuppressed(false), 1500)
    return () => clearTimeout(id)
  }, [navSuppressed, setNavSuppressed])

  // Site-wide specs range, computed once so rack view, room view, and the legend
  // all normalize against the same min/max (null unless 'Color by: Specs' is active).
  const heatmap = useMemo(() => {
    if (colorMode !== 'specs' || !specsHeatmapMetric || !siteDetail) return null
    const { min, max } = computeSpecsRange(siteDetail.racks, specsHeatmapMetric)
    return { metric: specsHeatmapMetric, min, max }
  }, [colorMode, specsHeatmapMetric, siteDetail])

  // Role highlighting drives the scene only while 'Color by: Role' is active; a
  // stable empty set otherwise keeps the scene prop identity constant.
  const sceneRoles = colorMode === 'role' ? highlightedRoles : NO_ROLES

  // Power chain: the racks + devices fed by the clicked panel/feed (null when off).
  const powerChain = useMemo(
    () =>
      powerVisible && selectedPowerSource && siteDetail
        ? tracePowerChain(siteDetail.racks, siteDetail.power, selectedPowerSource)
        : null,
    [powerVisible, selectedPowerSource, siteDetail],
  )
  // Clicking the active panel again clears the chain (toggle).
  const onPanelClick = (name: string) =>
    setPowerSource(
      selectedPowerSource?.kind === 'panel' && selectedPowerSource.name === name
        ? null
        : { kind: 'panel', name },
    )

  // LLDP discovery: activates for the rack being viewed; results accumulate site-wide.
  const allSiteDevices = useMemo(
    () => siteDetail?.racks.flatMap((r) => r.devices) ?? [],
    [siteDetail],
  )
  const capabilities = useCapabilities()
  const activeLldpIds = useMemo(
    () =>
      new Set(
        capabilities.napalmAvailable && level === 'rack' && selectedRack
          ? selectedRack.devices.map((d) => d.id)
          : [],
      ),
    [capabilities.napalmAvailable, level, selectedRack],
  )
  const lldp = useLldpDiscovery(allSiteDevices, activeLldpIds)
  const lldpSegments = useMemo(() => {
    if (!siteDetail) return []
    const locations: Record<string, RackLocation> = {}
    for (const r of siteDetail.racks)
      for (const d of r.devices)
        locations[d.name.split('.')[0]!.toLowerCase()] = { rackId: r.id, rackName: r.name }
    const segments = lldpToSegments(lldp.byDevice, locations, siteDetail.cables)
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__lldpSegments = segments
    }
    return segments
  }, [lldp.byDevice, siteDetail])

  // Inter-DC links for the site in view: each circuit group touching this site,
  // placed by the geographic bearing from this site to its peer.
  const dcLinks = useMemo<DcLink[]>(() => {
    if (!sites || !selectedSiteName || !circuitGroups) return []
    const byName = new Map(sites.map((s) => [s.name, s]))
    const origin = byName.get(selectedSiteName)
    return circuitGroups.flatMap((g) => {
      const isA = g.siteA === selectedSiteName
      const isZ = g.siteZ === selectedSiteName
      if (!isA && !isZ) return []
      const peerName = isA ? g.siteZ : g.siteA
      const peer = byName.get(peerName)
      const bearingDeg =
        origin?.latitude != null &&
        origin.longitude != null &&
        peer?.latitude != null &&
        peer.longitude != null
          ? compassBearing(origin.latitude, origin.longitude, peer.latitude, peer.longitude)
          : null
      return [
        {
          peerName,
          count: g.count,
          bucket: commitRateToSpeedBucket(g.maxCommitRate ?? null),
          bearingDeg,
        },
      ]
    })
  }, [sites, selectedSiteName, circuitGroups])

  const inScene = level !== 'map'

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#fafbfc' }}>
      {/* Leaflet world map — always mounted so its state survives scene visits */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          opacity: inScene ? 0 : 1,
          transition: 'opacity 400ms ease',
          pointerEvents: inScene ? 'none' : 'auto',
        }}
      >
        {sites && (
          <MapLayer sites={sites} circuitGroups={circuitGroups ?? []} onSiteSelect={zoomToSite} />
        )}
      </div>

      {/* 3D scene layer for site + rack levels.
          visibility (not just pointer-events) must toggle: R3F sets
          pointer-events:auto on its own elements, which defeats inheritance
          and would swallow the map's mouse input. Hidden elements are
          excluded from hit-testing regardless of children's styles. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          opacity: inScene ? 1 : 0,
          visibility: inScene ? 'visible' : 'hidden',
          transition: inScene
            ? 'opacity 400ms ease, visibility 0s'
            : 'opacity 400ms ease, visibility 0s 400ms',
          pointerEvents: inScene ? 'auto' : 'none',
        }}
      >
        <SceneErrorBoundary>
          <Canvas frameloop="demand" camera={{ position: [8, 8, 12], fov: 50 }}>
            <ambientLight intensity={0.9} />
            {inScene && selectedSiteName && siteDetail && (
              <SiteLevel
                racks={siteDetail.racks}
                cables={siteDetail.cables}
                lldpSegments={lldpSegments}
                siteName={selectedSiteName}
                onRackClick={zoomToRack}
                visible={level === 'site'}
                highlightedRoles={sceneRoles}
                powerVisible={powerVisible}
                power={siteDetail.power}
                heatmap={heatmap}
                powerChainRackIds={powerChain?.rackIds ?? null}
                selectedPanel={selectedPowerSource?.kind === 'panel' ? selectedPowerSource.name : null}
                onPanelClick={onPanelClick}
                dcLinks={dcLinks}
                dcLinksVisible={dcLinksVisible}
              />
            )}
            {level === 'rack' && selectedRack && selectedPlacement && (
              <RackLevel
                rack={selectedRack}
                placement={selectedPlacement}
                cables={siteDetail?.cables ?? []}
                lldpSegments={lldpSegments}
                napalmAvailable={capabilities.napalmAvailable}
                onDeviceClick={selectDevice}
                selectedDeviceId={selectedDeviceId}
                visible
                heatmap={heatmap}
                highlightedRoles={sceneRoles}
              />
            )}
            <CameraRig />
          </Canvas>
        </SceneErrorBoundary>
      </div>

      <div style={{ ...hudStyle, pointerEvents: 'none' }}>
        <strong style={{ color: '#1e293b' }}>net3d</strong>
        <div>
          {isLoading && 'loading sites…'}
          {error && (
            <span style={{ color: '#b91c1c' }}>⚠ {connectionErrorMessage(error)}</span>
          )}
          {sites &&
            level === 'map' &&
            `${sites.length} sites — ${sites.filter((s) => s.latitude !== null).length} on map — ${circuitGroups?.length ?? 0} DC links`}
          {level === 'site' &&
            selectedSiteName &&
            `site: ${selectedSiteName}${siteLoading ? ' — loading racks…' : siteDetail ? ` — ${siteDetail.racks.length} racks` : ''}`}
          {level === 'rack' && selectedRack && `${selectedSiteName} / ${selectedRack.name}`}
          {level === 'rack' && lldp.discovering && (
            <div style={{ color: '#0891b2' }}>
              ◐ discovering cabling {lldp.completed}/{lldp.total} devices…
            </div>
          )}
          {level === 'rack' && !lldp.discovering && lldp.total > 0 && (
            <div style={{ color: '#0891b2' }}>
              ▣ LLDP: {lldpSegments.length} undocumented link{lldpSegments.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>

      {/* Source-of-truth switch — shown on the map (switching resets to the map anyway).
          Top-right is free here; the in-scene legends occupy it only at site/rack level. */}
      {level === 'map' && <BackendSwitcher />}

      {/* Global device finder — persistent (top-center) so any device is reachable
          from any level. Selecting one stages a zoom to its rack. */}
      {deviceIndex && deviceIndex.length > 0 && (
        <DeviceSearch
          devices={deviceIndex}
          onSelect={(e) => focusDevice({ siteName: e.siteName, rackId: e.rackId, deviceId: e.id })}
        />
      )}

      {selectedDevice && (
        <DevicePanel
          device={selectedDevice}
          cables={siteDetail?.cables ?? []}
          napalmAvailable={capabilities.napalmAvailable}
          onClose={() => selectDevice(null)}
        />
      )}

      {sites && level === 'map' && !selectedDevice && (
        <SiteSearch sites={sites} onSelect={zoomToSite} />
      )}

      {/* Unified Layers control (top-right): single-select "Color by" + overlay
          toggles. Role list is scoped to the rack(s) in view; the specs gradient
          stays site-wide. Hidden while a device is selected — the 380px DevicePanel
          occupies the same corner. */}
      {level !== 'map' && !selectedDevice && !!siteDetail?.racks?.length && (
        <LayersPanel
          level={level}
          racks={level === 'rack' && selectedRack ? [selectedRack] : siteDetail.racks}
          metricRacks={siteDetail.racks}
          colorMode={colorMode}
          onColorMode={setColorMode}
          highlightedRoles={highlightedRoles}
          onToggleRole={toggleHighlightedRole}
          onClearRoles={clearHighlightedRoles}
          specsMetric={specsHeatmapMetric}
          onSpecsMetric={setSpecsMetric}
          hiddenStatuses={hiddenStatuses}
          onToggleHiddenStatus={toggleHiddenStatus}
          powerVisible={powerVisible}
          onTogglePower={togglePower}
          connectivityVisible={connectivityVisible}
          onToggleConnectivity={toggleConnectivity}
          dcLinksVisible={dcLinksVisible}
          onToggleDcLinks={toggleDcLinks}
        />
      )}

      {level === 'site' && powerVisible && !!siteDetail?.racks?.length && (
        <PowerLegend
          racks={siteDetail.racks}
          power={siteDetail.power}
          chain={
            powerChain && selectedPowerSource
              ? {
                  sourceName: selectedPowerSource.name,
                  rackCount: powerChain.rackIds.size,
                  deviceCount: powerChain.deviceNames.size,
                }
              : null
          }
          onClearChain={() => setPowerSource(null)}
        />
      )}

      {level !== 'map' && (
        <button
          onClick={() =>
            level === 'rack' && selectedSiteName ? zoomToSite(selectedSiteName) : zoomToMap()
          }
          style={{
            ...hudStyle,
            top: 56,
            background: '#ffffff',
            color: '#1e293b',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          {level === 'rack' ? '← site' : '← map'}
        </button>
      )}

      {level === 'rack' && (
        <button
          onClick={toggleRackView}
          title="flip the rack camera between the device faces (front) and the cabling (rear)"
          style={{
            ...hudStyle,
            top: 96,
            background: rackView === 'rear' ? '#0891b2' : '#ffffff',
            color: rackView === 'rear' ? '#ffffff' : '#1e293b',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          {rackView === 'rear' ? '⟲ rear view' : '⟳ front view'}
        </button>
      )}
    </div>
  )
}
