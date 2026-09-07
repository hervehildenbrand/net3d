import { Canvas } from '@react-three/fiber'
import type { LldpCableSegment, RackPlacement } from '@net3d/shared'
import type { PowerSource } from '../lib/powerChain'
import type { SiteDetailData, SiteRack } from '../hooks/useSiteDetail'
import type { ViewLevel } from '../store/useAppStore'
import { SiteLevel } from './SiteLevel'
import { RackLevel, type HeatmapView } from './RackLevel'
import { CameraRig } from './CameraRig'
import type { DcLink } from './dclinks'

interface SiteSceneProps {
  level: ViewLevel
  selectedSiteName: string | null
  siteDetail: SiteDetailData | undefined
  lldpSegments: LldpCableSegment[]
  onRackClick: (rackId: string) => void
  highlightedRoles: Set<string>
  powerVisible: boolean
  heatmap: HeatmapView | null
  powerChainRackIds: Set<string> | null
  selectedPowerSource: PowerSource | null
  onPanelClick: (name: string) => void
  dcLinks: DcLink[]
  dcLinksVisible: boolean
  selectedRack: SiteRack | undefined
  selectedPlacement: RackPlacement | undefined
  napalmAvailable: boolean
  onDeviceClick: (deviceId: string | null) => void
  selectedDeviceId: string | null
  siteSubnets: string[]
}

export default function SiteScene({
  level, selectedSiteName, siteDetail, lldpSegments, onRackClick,
  highlightedRoles, powerVisible, heatmap, powerChainRackIds,
  selectedPowerSource, onPanelClick, dcLinks, dcLinksVisible, selectedRack,
  selectedPlacement, napalmAvailable, onDeviceClick, selectedDeviceId, siteSubnets,
}: SiteSceneProps) {
  return (
    <Canvas frameloop="demand" camera={{ position: [8, 8, 12], fov: 50 }}>
        <ambientLight intensity={0.9} />
        {selectedSiteName && siteDetail && (
          <SiteLevel
            racks={siteDetail.racks}
            cables={siteDetail.cables}
            lldpSegments={lldpSegments}
            siteName={selectedSiteName}
            onRackClick={onRackClick}
            visible={level === 'site'}
            highlightedRoles={highlightedRoles}
            powerVisible={powerVisible}
            power={siteDetail.power}
            heatmap={heatmap}
            powerChainRackIds={powerChainRackIds}
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
            napalmAvailable={napalmAvailable}
            onDeviceClick={onDeviceClick}
            selectedDeviceId={selectedDeviceId}
            visible
            heatmap={heatmap}
            highlightedRoles={highlightedRoles}
            siteSubnets={siteSubnets}
          />
        )}
        <CameraRig />
    </Canvas>
  )
}
