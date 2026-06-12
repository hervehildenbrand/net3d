import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { GlobeLevel } from './scene/GlobeLevel'
import { SiteLevel, useSiteLayout } from './scene/SiteLevel'
import { RackLevel } from './scene/RackLevel'
import { CameraRig, HOME } from './scene/CameraRig'
import { useSites } from './hooks/useSites'
import { useCircuits } from './hooks/useCircuits'
import { useSiteDetail } from './hooks/useSiteDetail'
import { useAppStore } from './store/useAppStore'

const hudStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  color: '#9fc3e0',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 13,
}

export function App() {
  const { data: sites, isLoading, error } = useSites()
  const { data: circuitGroups } = useCircuits()
  const level = useAppStore((s) => s.level)
  const selectedSiteName = useAppStore((s) => s.selectedSiteName)
  const zoomToSite = useAppStore((s) => s.zoomToSite)
  const zoomToRack = useAppStore((s) => s.zoomToRack)
  const zoomToGlobe = useAppStore((s) => s.zoomToGlobe)
  const selectedRackId = useAppStore((s) => s.selectedRackId)
  const selectedDeviceId = useAppStore((s) => s.selectedDeviceId)
  const selectDevice = useAppStore((s) => s.selectDevice)
  const { data: siteDetail, isLoading: siteLoading } = useSiteDetail(
    level !== 'globe' ? selectedSiteName : null,
  )
  const { placements } = useSiteLayout(siteDetail?.racks)
  const selectedRack = siteDetail?.racks.find((r) => r.id === selectedRackId)
  const selectedPlacement = placements.find((p) => p.rackId === selectedRackId)

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas camera={{ position: [HOME.x, HOME.y, HOME.z], fov: 50 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[HOME.x, HOME.y + 3, HOME.z]} intensity={1.6} />
        <Stars radius={60} depth={30} count={3000} factor={3} fade />
        {sites && (
          <GlobeLevel
            sites={sites}
            circuitGroups={circuitGroups ?? []}
            onSiteClick={zoomToSite}
            visible={level === 'globe'}
          />
        )}
        {level !== 'globe' && selectedSiteName && siteDetail && (
          <SiteLevel
            racks={siteDetail.racks}
            cables={siteDetail.cables}
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
            onDeviceClick={selectDevice}
            selectedDeviceId={selectedDeviceId}
            visible
          />
        )}
        {sites && <CameraRig sites={sites} />}
      </Canvas>

      <div style={{ ...hudStyle, pointerEvents: 'none' }}>
        <strong style={{ color: '#e8f4ff' }}>net3d</strong>
        <div>
          {isLoading && 'loading sites…'}
          {error && `error: ${String(error)}`}
          {sites &&
            level === 'globe' &&
            `${sites.length} sites — ${sites.filter((s) => s.latitude !== null).length} geocoded — ${circuitGroups?.length ?? 0} DC links`}
          {level === 'site' &&
            selectedSiteName &&
            `site: ${selectedSiteName}${siteLoading ? ' — loading racks…' : siteDetail ? ` — ${siteDetail.racks.length} racks` : ''}`}
          {level === 'rack' && selectedRack && `${selectedSiteName} / ${selectedRack.name}`}
        </div>
      </div>

      {level !== 'globe' && (
        <button
          onClick={() =>
            level === 'rack' && selectedSiteName ? zoomToSite(selectedSiteName) : zoomToGlobe()
          }
          style={{
            ...hudStyle,
            top: 56,
            background: '#13283d',
            color: '#cfe8ff',
            border: '1px solid #2a4a6a',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          {level === 'rack' ? '← site' : '← globe'}
        </button>
      )}
    </div>
  )
}
