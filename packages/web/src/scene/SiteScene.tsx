import { Canvas } from '@react-three/fiber'
import type { CableLive, LldpCableSegment, RackPlacement, LogicalGraph, LogicalEdge, LogicalNode } from '@net3d/shared'
import type { PowerSource } from '../lib/powerChain'
import type { SiteDetailData, SiteRack } from '../hooks/useSiteDetail'
import type { ViewLevel } from '../store/useAppStore'
import type { EdgeLive, EdgeStyle, CameraFrame, NodeClickAction, Bounds } from '../lib/logicalView'
import { SiteLevel } from './SiteLevel'
import { RackLevel, type HeatmapView } from './RackLevel'
import { CameraRig } from './CameraRig'
import { LogicalLevel } from './LogicalLevel'
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
  /** Live gNMI utilisation per cable id, when 'Color by: live' is active. */
  cableLive?: Map<string, CableLive>
  /** When true, renders the logical topology view instead of physical. */
  logical?: boolean
  /** Logical view data (required when logical=true). */
  logicalData?: {
    graph: LogicalGraph
    positions: Map<string, [number, number, number]>
    bounds: Bounds
    geometry: import('../lib/logicalView').EdgeGeometry
    getEdgeLive: (edge: LogicalEdge) => EdgeLive | null
    getEdgeStyle: (edge: LogicalEdge, live: EdgeLive | null) => EdgeStyle
    getEdgeTooltip: (edge: LogicalEdge, live: EdgeLive | null) => string
    getCameraFrame: (bounds: Bounds) => CameraFrame
    getNodeClickAction: (node: LogicalNode, level: ViewLevel) => NodeClickAction
  }
  /** Called when a device is selected in logical view. */
  onLogicalSelectDevice?: (deviceId: string) => void
  /** Called when a site cluster is clicked in logical map view. */
  onLogicalSelectSite?: (siteName: string) => void
}

export default function SiteScene({
  level, selectedSiteName, siteDetail, lldpSegments, onRackClick,
  highlightedRoles, powerVisible, heatmap, powerChainRackIds,
  selectedPowerSource, onPanelClick, dcLinks, dcLinksVisible, selectedRack,
  selectedPlacement, napalmAvailable, onDeviceClick, selectedDeviceId, siteSubnets,
  cableLive, logical, logicalData, onLogicalSelectDevice, onLogicalSelectSite,
}: SiteSceneProps) {
  // Logical view: unmount physical scene (SiteLevel, RackLevel, CameraRig) entirely.
  // R3F raycasts meshes in hidden groups, so hiding isn't enough.
  if (logical && logicalData) {
    return (
      <Canvas frameloop="demand" camera={{ position: [8, 8, 12], fov: 50 }}>
        <LogicalLevel
          level={level}
          siteName={selectedSiteName}
          graph={logicalData.graph}
          positions={logicalData.positions}
          bounds={logicalData.bounds}
          geometry={logicalData.geometry}
          getEdgeLive={logicalData.getEdgeLive}
          getEdgeStyle={logicalData.getEdgeStyle}
          getEdgeTooltip={logicalData.getEdgeTooltip}
          getCameraFrame={logicalData.getCameraFrame}
          getNodeClickAction={logicalData.getNodeClickAction}
          onSelectDevice={onLogicalSelectDevice ?? (() => {})}
          onSelectSite={onLogicalSelectSite ?? (() => {})}
        />
      </Canvas>
    )
  }

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
            cableLive={cableLive}
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
            cableLive={cableLive}
          />
        )}
        <CameraRig />
    </Canvas>
  )
}
