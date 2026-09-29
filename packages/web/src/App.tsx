import { Suspense, useEffect, useMemo } from 'react'
import {
  commitRateToSpeedBucket,
  compassBearing,
  lldpToSegments,
  mapTelemetryToCables,
  type RackLocation,
} from '@net3d/shared'
import type { DcLink } from './scene/dclinks'
import { MapLayer } from './map/MapLayer'
import { useLldpDiscovery } from './hooks/useLldpDiscovery'
import { useCapabilities } from './hooks/useCapabilities'
import { useSiteTelemetry } from './hooks/useSiteTelemetry'
import { useCircuitTelemetry } from './hooks/useCircuitTelemetry'
import { useComputedSiteLayout } from './hooks/useComputedSiteLayout'
import { LazySiteScene, preloadSiteScene, LazySiteDiagram, preloadSiteDiagram } from './scene/lazySiteScene'
import { useSites } from './hooks/useSites'
import { connectionErrorMessage } from './connectionError'
import { useCircuits } from './hooks/useCircuits'
import { useSiteDetail } from './hooks/useSiteDetail'
import { useSiteLayoutQuery, useLayoutCapability } from './hooks/useSiteLayout'
import { useDeviceIndex } from './hooks/useDeviceIndex'
import { useLiveUpdates } from './hooks/useLiveUpdates'
import { useLogicalView } from './hooks/useLogicalTopology'
import { useAppStore } from './store/useAppStore'
import { DevicePanel } from './components/DevicePanel'
import { SitesMenu, SITES_MENU_WIDTH, SITES_MENU_COLLAPSED_OFFSET } from './components/SitesMenu'
import { SiteSearch } from './components/SiteSearch'
import { DeviceSearch } from './components/DeviceSearch'
import { LayersPanel } from './components/LayersPanel'
import { PowerLegend } from './components/PowerLegend'
import { BackendSwitcher } from './components/BackendSwitcher'
import { EditToolbar } from './components/EditToolbar'
import { ViewModeSwitch, LogicalLayers } from './components/LogicalControls'
import { useEditStore } from './store/useEditStore'
import { SceneErrorBoundary } from './components/SceneErrorBoundary'
import { SiteStatus } from './components/SiteStatus'
import { LldpHud } from './components/LldpHud'
import { computeSpecsRange } from './lib/specsHeatmap'
import { collectSubnets } from './lib/subnetColoring'
import { tracePowerChain } from './lib/powerChain'
import { computeActiveLldpIds } from './lib/lldpScope'
import { dirLive } from './lib/liveTelemetry'
import { viewFlags, findDevice } from './lib/logicalView'

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
  const liveUpdateStatus = useLiveUpdates()
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
  const cableColorMode = useAppStore((s) => s.cableColorMode)
  const setCableColorMode = useAppStore((s) => s.setCableColorMode)
  const ipLabelsVisible = useAppStore((s) => s.ipLabelsVisible)
  const toggleIpLabels = useAppStore((s) => s.toggleIpLabels)
  const highlightedRoles = useAppStore((s) => s.highlightedRoles)
  const toggleHighlightedRole = useAppStore((s) => s.toggleHighlightedRole)
  const clearHighlightedRoles = useAppStore((s) => s.clearHighlightedRoles)
  const specsHeatmapMetric = useAppStore((s) => s.specsHeatmapMetric)
  const setSpecsMetric = useAppStore((s) => s.setSpecsMetric)
  const sitesMenuOpen = useAppStore((s) => s.sitesMenuOpen)
  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const hiddenLogical = useAppStore((s) => s.hiddenLogical)
  const toggleHiddenLogical = useAppStore((s) => s.toggleHiddenLogical)
  const backend = useAppStore((s) => s.backend)
  // Left-stacked HUD elements clear the sites menu (open) or its ☰ button (closed).
  const leftOffset = sitesMenuOpen ? SITES_MENU_WIDTH + 16 : SITES_MENU_COLLAPSED_OFFSET
  const { data: siteDetail, isLoading: siteLoading, isFetching: siteFetching, error: siteError, refetch: retrySite } = useSiteDetail(
    level !== 'map' ? selectedSiteName : null,
  )
  const { placements } = useComputedSiteLayout(siteDetail?.racks)
  // Raw saved layout (rooms + floor) to seed the editor when entering edit mode.
  const { data: savedLayout } = useSiteLayoutQuery(level !== 'map' ? selectedSiteName : null)
  const editModeActive = useEditStore((s) => s.editModeActive)
  const editDirty = useEditStore((s) => s.dirty)
  const exitEditMode = useEditStore((s) => s.exitEditMode)
  const { canSave: layoutCanSave } = useLayoutCapability()
  const selectedRack = siteDetail?.racks.find((r) => r.id === selectedRackId)
  const selectedPlacement = placements.find((p) => p.rackId === selectedRackId)

  // In logical mode, search all racks so DevicePanel keeps its power rows.
  // In physical mode, only search the selected rack (original behavior).
  const selectedDeviceResult = useMemo(() => {
    if (!selectedDeviceId || !siteDetail) return undefined
    const result = findDevice(siteDetail.racks, selectedRackId, selectedDeviceId, viewMode === 'logical')
    return result
  }, [selectedDeviceId, siteDetail, selectedRackId, viewMode])
  const selectedDevice = selectedDeviceResult?.device
  // Use the rack from findDevice in logical mode for DevicePanel's power rows.
  const selectedDeviceRack = selectedDeviceResult?.rack ?? selectedRack

  // Global device search index (backend-agnostic; refetched per backend).
  const { data: deviceIndex, isLoading: deviceIndexLoading, isError: deviceIndexError } = useDeviceIndex()

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

  // Leaving the site (← map / rack / device focus) ends an edit session so its
  // working copy and nav suppression don't leak into other levels.
  useEffect(() => {
    if (level !== 'site' && editModeActive) exitEditMode()
  }, [level, editModeActive, exitEditMode])

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

  // Site-wide subnet list so 'Color by: Subnet' assigns each /24 a stable color.
  const siteSubnets = useMemo(() => (siteDetail ? collectSubnets(siteDetail.racks) : []), [siteDetail])

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

  // LLDP discovery: network devices site-wide from site entry (NetBox-documented
  // links still win per-link), plus the whole rack being viewed; results accumulate.
  const allSiteDevices = useMemo(
    () => siteDetail?.racks.flatMap((r) => r.devices) ?? [],
    [siteDetail],
  )
  const capabilities = useCapabilities()

  // Compute all visibility and polling decisions via viewFlags.
  // Physical mode and feature-off match today's behavior exactly.
  const flags = useMemo(
    () =>
      viewFlags(
        { viewMode, level, siteDetail: siteDetail ?? null, selectedDevice: selectedDevice ?? null, editModeActive, cableColorMode, dcLinksVisible, colorMode },
        capabilities,
      ),
    [viewMode, level, siteDetail, selectedDevice, editModeActive, cableColorMode, dcLinksVisible, colorMode, capabilities],
  )

  // Map-level circuit telemetry: polled via flags.poll.circuits.
  const circuitLive = useCircuitTelemetry(flags.poll.circuits)
  // Live gNMI utilisation, polled via flags.poll.siteTelemetry.
  const telemetry = useSiteTelemetry(selectedSiteName, flags.poll.siteTelemetry)
  const cableLive = useMemo(
    () => (cableColorMode === 'live' && telemetry && siteDetail ? mapTelemetryToCables(telemetry, siteDetail.cables) : undefined),
    [cableColorMode, telemetry, siteDetail],
  )
  const activeLldpIds = useMemo(
    () =>
      computeActiveLldpIds(capabilities.napalmAvailable, level, siteDetail?.racks ?? [], selectedRack),
    [capabilities.napalmAvailable, level, siteDetail, selectedRack],
  )
  const lldp = useLldpDiscovery(allSiteDevices, activeLldpIds)
  const lldpSegments = useMemo(() => {
    if (!siteDetail) return []
    const locations: Record<string, RackLocation> = {}
    for (const r of siteDetail.racks)
      for (const d of r.devices)
        if (d.name)
          locations[d.name.split('.')[0]!.toLowerCase()] = { rackId: r.id, rackName: r.name }
    const segments = lldpToSegments(lldp.byDevice, locations, siteDetail.cables)
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__lldpSegments = segments
    }
    return segments
  }, [lldp.byDevice, siteDetail])

  // Logical view data (graph + layers) and live accessors.
  const logicalView = useLogicalView({
    enabled: flags.logical,
    level,
    backend,
    siteName: selectedSiteName,
    siteDetail,
    deviceIndex,
    circuitGroups,
    lldp,
    telemetry,
    pollSiteTopology: flags.poll.siteTopology,
    pollBackboneTopology: flags.poll.backboneTopology,
  })

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
          cids: (g.circuits ?? []).map((c) => c.cid),
        },
      ]
    })
  }, [sites, selectedSiteName, circuitGroups])

  // Decorate DC links with live traffic each way when active; pass-through otherwise.
  const dcLinksShown = useMemo(
    () =>
      cableColorMode === 'live' && circuitLive && selectedSiteName
        ? dcLinks.map((l) => ({
            ...l,
            live: { out: dirLive(l.cids, circuitLive, selectedSiteName), in: dirLive(l.cids, circuitLive, l.peerName) },
          }))
        : dcLinks,
    [dcLinks, circuitLive, cableColorMode, selectedSiteName],
  )

  // In scene when at site/rack level.
  const inScene = flags.inScene

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#fafbfc' }}>
      {/* Leaflet world map — always mounted so its state survives scene visits.
          Hidden (visibility, not just pointer-events) when logical view is active
          at map level because R3F sets pointer-events:auto on its own elements. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          opacity: inScene ? 0 : 1,
          visibility: inScene ? 'hidden' : 'visible',
          transition: 'opacity 400ms ease',
          pointerEvents: inScene ? 'none' : 'auto',
        }}
      >
        {sites && (
          <MapLayer
            sites={sites}
            circuitGroups={circuitGroups ?? []}
            circuitLive={circuitLive}
            onSiteSelect={zoomToSite}
            logical={flags.logicalMap}
            graph={logicalView.data?.graph ?? null}
            hidden={hiddenLogical}
          />
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
        {inScene && !flags.siteDiagram && (
          <SceneErrorBoundary>
            <Suspense fallback={null}>
              <LazySiteScene
                level={level}
                selectedSiteName={selectedSiteName}
                siteDetail={siteDetail}
                lldpSegments={lldpSegments}
                onRackClick={zoomToRack}
                highlightedRoles={sceneRoles}
                powerVisible={powerVisible}
                heatmap={heatmap}
                powerChainRackIds={powerChain?.rackIds ?? null}
                selectedPowerSource={selectedPowerSource}
                onPanelClick={onPanelClick}
                dcLinks={dcLinksShown}
                dcLinksVisible={dcLinksVisible}
                selectedRack={selectedRack}
                selectedPlacement={selectedPlacement}
                napalmAvailable={capabilities.napalmAvailable}
                onDeviceClick={selectDevice}
                selectedDeviceId={selectedDeviceId}
                siteSubnets={siteSubnets}
                cableLive={cableLive}
              />
            </Suspense>
          </SceneErrorBoundary>
        )}
        {flags.siteDiagram && (
          <Suspense fallback={null}>
            <LazySiteDiagram
              key={selectedSiteName}
              siteName={selectedSiteName ?? ''}
              graph={logicalView.data?.graph ?? null}
              racks={siteDetail?.racks}
              telemetry={telemetry}
              hidden={hiddenLogical}
              selectedDeviceId={selectedDeviceId}
              insets={{
                top: 280, // LogicalLayers panel (top-right corner) height + DeviceSearch
                right: 16, // minimal margin (panel covers top-right, not full height)
                bottom: 16,
                left: leftOffset + 8, // sites menu + gap
              }}
              onSelectDevice={selectDevice}
              onSelectSite={zoomToSite}
            />
          </Suspense>
        )}
      </div>

      {/* Sites menu (left edge): all sites grouped by region, one click from any level. */}
      {sites && <SitesMenu sites={sites} />}

      <div style={{ ...hudStyle, left: leftOffset, pointerEvents: 'none' }}>
        <strong style={{ color: '#1e293b' }}>net3d</strong>
        <span style={{ marginLeft: 8, color: liveUpdateStatus === 'live' ? '#15803d' : '#64748b' }}>
          data: {liveUpdateStatus}
        </span>
        <div>
          {isLoading && 'loading sites…'}
          {error && (
            <span style={{ color: '#b91c1c' }}>⚠ {connectionErrorMessage(error)}</span>
          )}
          {sites &&
            level === 'map' &&
            `${sites.length} sites — ${sites.filter((s) => s.latitude !== null).length} on map — ${circuitGroups?.length ?? 0} DC links`}
          {level !== 'map' && selectedSiteName && (
            <div style={{ pointerEvents: 'auto' }}>
              <SiteStatus siteName={selectedSiteName} loading={siteLoading} fetching={siteFetching} error={siteError} rackCount={siteDetail?.racks.length} onRetry={() => void retrySite()} />
              {level === 'rack' && selectedRack && ` / ${selectedRack.name}`}
            </div>
          )}
          {level !== 'map' && <LldpHud discovery={lldp} undocumentedLinks={lldpSegments.length} />}
        </div>
      </div>

      {/* Source-of-truth switch — shown on the map (switching resets to the map anyway).
          Top-right is free here; the in-scene legends occupy it only at site/rack level.
          Hidden when logical view is active at map level. */}
      {level === 'map' && !flags.logical && <BackendSwitcher />}

      {/* Global device finder — persistent (top-center) so any device is reachable
          from any level. Selecting one stages a zoom to its rack. */}
      <DeviceSearch
        devices={deviceIndex?.devices ?? []}
        indexedSites={deviceIndex?.indexedSites ?? 0}
        totalSites={deviceIndex?.totalSites ?? 0}
        prewarmEnabled={deviceIndex?.prewarmEnabled ?? false}
        isLoading={deviceIndexLoading}
        isError={deviceIndexError}
        onSelect={(e) => focusDevice({ siteName: e.siteName, rackId: e.rackId, deviceId: e.id })}
      />

      {selectedDevice && (
        <DevicePanel
          device={selectedDevice}
          cables={siteDetail?.cables ?? []}
          rack={selectedDeviceRack}
          napalmAvailable={capabilities.napalmAvailable}
          telemetry={telemetry?.devices[selectedDevice.name]}
          onClose={() => selectDevice(null)}
        />
      )}

      {/* View mode switch (Physical | Logical) — shown via flags.viewSwitch. */}
      {flags.viewSwitch && (
        <ViewModeSwitch
          available={flags.viewSwitch}
          viewMode={viewMode}
          level={level}
          leftOffset={leftOffset}
          inEditMode={editModeActive}
          onSwitch={setViewMode}
          onMouseEnter={() => {
            // Preload diagram when hovering at site level, scene otherwise
            if (level === 'site') preloadSiteDiagram()
            else preloadSiteScene()
          }}
        />
      )}

      {sites && flags.siteSearch && !selectedDevice && (
        <SiteSearch sites={sites} onSelect={zoomToSite} />
      )}

      {/* Logical layers panel — shown when logical view is active.
          At map level: always shown (passes empty layers when backbone not loaded).
          At site level: shown once logicalView.data is available. */}
      {flags.logicalLayers && (level === 'map' || logicalView.data) && (
        <LogicalLayers
          level={level}
          layers={logicalView.data?.layers ?? []}
          hidden={hiddenLogical}
          onToggle={toggleHiddenLogical}
          hasLive={flags.siteDiagram && logicalView.live.hasLive}
          isError={logicalView.isError}
        />
      )}

      {/* Unified Layers control (top-right): single-select "Color by" + overlay
          toggles. Role list is scoped to the rack(s) in view; the specs gradient
          stays site-wide. Hidden while a device is selected — the 380px DevicePanel
          occupies the same corner. Hidden when logical view is active. */}
      {flags.layersPanel && siteDetail && (
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
          subnets={siteSubnets}
          cableColorMode={cableColorMode}
          onCableColorMode={setCableColorMode}
          powerVisible={powerVisible}
          onTogglePower={togglePower}
          connectivityVisible={connectivityVisible}
          onToggleConnectivity={toggleConnectivity}
          dcLinksVisible={dcLinksVisible}
          onToggleDcLinks={toggleDcLinks}
          ipLabelsVisible={ipLabelsVisible}
          onToggleIpLabels={toggleIpLabels}
          telemetryAvailable={capabilities.telemetryAvailable}
        />
      )}

      {flags.powerLegend && powerVisible && siteDetail && (
        <PowerLegend
          racks={siteDetail.racks}
          power={siteDetail.power}
          cables={siteDetail.cables}
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

      {/* Floor-plan editor toolbar (site level only; self-hides unless the server
          allows edits). Gets the current placements so entering edit seeds the
          working copy from whatever is on screen (auto-layout or saved layout).
          Hidden when logical view is active. */}
      {flags.editToolbar && selectedSiteName && siteDetail && (
        <EditToolbar
          siteName={selectedSiteName}
          placements={placements}
          rooms={savedLayout?.rooms ?? []}
          floor={savedLayout?.floor ?? null}
        />
      )}

      {level !== 'map' && (
        <button
          onClick={() => {
            // Guard against silently dropping unsaved layout edits on navigate-away
            // (only when saving is possible; sandbox edits are ephemeral by design).
            if (editModeActive && editDirty && layoutCanSave && !window.confirm('Discard unsaved layout changes?')) return
            level === 'rack' && selectedSiteName ? zoomToSite(selectedSiteName) : zoomToMap()
          }}
          style={{
            ...hudStyle,
            top: 56,
            left: leftOffset,
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
            left: leftOffset,
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
