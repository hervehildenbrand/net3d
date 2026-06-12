import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { lldpToSegments, type RackLocation } from '@net3d/shared'
import { MapLayer } from './map/MapLayer'
import { useLldpDiscovery } from './hooks/useLldpDiscovery'
import { useCapabilities } from './hooks/useCapabilities'
import { SiteLevel, useSiteLayout } from './scene/SiteLevel'
import { RackLevel } from './scene/RackLevel'
import { CameraRig } from './scene/CameraRig'
import { useSites } from './hooks/useSites'
import { useCircuits } from './hooks/useCircuits'
import { useSiteDetail } from './hooks/useSiteDetail'
import { useAppStore } from './store/useAppStore'
import { DevicePanel } from './components/DevicePanel'
import { SiteSearch } from './components/SiteSearch'
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
  const { data: siteDetail, isLoading: siteLoading } = useSiteDetail(
    level !== 'map' ? selectedSiteName : null,
  )
  const { placements } = useSiteLayout(siteDetail?.racks)
  const selectedRack = siteDetail?.racks.find((r) => r.id === selectedRackId)
  const selectedPlacement = placements.find((p) => p.rackId === selectedRackId)
  const selectedDevice = selectedRack?.devices.find((d) => d.id === selectedDeviceId)

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

      {/* 3D scene layer for site + rack levels */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          opacity: inScene ? 1 : 0,
          transition: 'opacity 400ms ease',
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
          {error && `error: ${String(error)}`}
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
    </div>
  )
}
