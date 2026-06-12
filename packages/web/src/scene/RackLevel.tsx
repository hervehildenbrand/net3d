import { useMemo, useState } from 'react'
import { Edges, Text } from '@react-three/drei'
import {
  deviceTransform,
  mapInterfacesToCables,
  type LldpCableSegment,
  type RackPlacement,
} from '@net3d/shared'
import type { SiteCable, SiteDevice, SiteRack } from '../hooks/useSiteDetail'
import { useNapalm } from '../hooks/useNapalm'
import type { NapalmInterface } from '../components/DevicePanel'
import { theme } from '../theme'
import { useAppStore } from '../store/useAppStore'
import { RackCables } from './cables'

interface PlacedDevice {
  device: SiteDevice
  box: { x: number; y: number; z: number; w: number; h: number; d: number }
}

export function RackLevel({
  rack,
  placement,
  cables,
  lldpSegments = [],
  napalmAvailable = true,
  onDeviceClick,
  selectedDeviceId,
  visible,
}: {
  rack: SiteRack
  placement: RackPlacement
  cables: SiteCable[]
  lldpSegments?: LldpCableSegment[]
  napalmAvailable?: boolean
  onDeviceClick: (deviceId: string) => void
  selectedDeviceId: string | null
  visible: boolean
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const connectivityVisible = useAppStore((s) => s.connectivityVisible)
  const setHoveredDevice = useAppStore((s) => s.setHoveredDevice)

  // live cable coloring follows the selected device's interface states
  const selectedDevice = rack.devices.find((d) => d.id === selectedDeviceId)
  // hover wins over selection for cable emphasis
  const hoveredDevice = rack.devices.find((d) => d.id === hovered)
  const highlightDeviceName = hoveredDevice?.name ?? selectedDevice?.name ?? null
  const { data: liveIfaces } = useNapalm<Record<string, NapalmInterface>>(
    napalmAvailable ? selectedDeviceId : null,
    'get_interfaces',
  )
  const liveStatus = useMemo(
    () =>
      liveIfaces && selectedDevice
        ? mapInterfacesToCables(liveIfaces, cables, selectedDevice.name)
        : undefined,
    [liveIfaces, selectedDevice, cables],
  )

  const placed = useMemo<PlacedDevice[]>(
    () =>
      rack.devices
        .map((device) => ({ device, box: deviceTransform(placement, device) }))
        .filter((p): p is PlacedDevice => p.box !== null),
    [rack, placement],
  )

  return (
    <group visible={visible}>
      {/* rack-local lights — site lights are hidden with the site group */}
      <directionalLight position={[placement.x + 2, placement.height + 2, placement.z + 4]} intensity={1.2} />
      <directionalLight position={[placement.x - 3, placement.height, placement.z - 3]} intensity={0.4} />
      {/* rack shell */}
      <mesh position={[placement.x, placement.height / 2, placement.z]}>
        <boxGeometry args={[placement.width, placement.height, placement.depth]} />
        <meshStandardMaterial
          color={theme.scene.rackShell}
          transparent
          opacity={0.15}
          depthWrite={false}
        />
        <Edges color={theme.scene.rackShellEdges} />
      </mesh>

      {placed.map(({ device, box }) => {
        const active = device.id === selectedDeviceId
        const hover = device.id === hovered
        return (
          <group key={device.id}>
            <mesh
              position={[box.x, box.y, box.z]}
              onClick={(e) => {
                e.stopPropagation()
                onDeviceClick(device.id)
              }}
              onPointerOver={(e) => {
                e.stopPropagation()
                setHovered(device.id)
                setHoveredDevice(device.id)
                document.body.style.cursor = 'pointer'
              }}
              onPointerOut={() => {
                setHovered(null)
                setHoveredDevice(null)
                document.body.style.cursor = 'auto'
              }}
            >
              <boxGeometry args={[box.w, box.h, box.d]} />
              <meshStandardMaterial
                color={`#${device.roleColor}`}
                emissive={`#${device.roleColor}`}
                emissiveIntensity={active ? 0.9 : hover ? 0.55 : 0.25}
                roughness={0.45}
                metalness={0.3}
              />
            </mesh>
            <Text
              position={[box.x + box.w / 2 + 0.06, box.y, box.z]}
              fontSize={0.035}
              color={active || hover ? theme.text.primary : theme.text.secondary}
              anchorX="left"
              anchorY="middle"
            >
              {`${device.name} · U${device.position}`}
            </Text>
          </group>
        )
      })}

      <RackCables
        rack={rack}
        placement={placement}
        cables={cables}
        liveStatus={liveStatus}
        lldpSegments={lldpSegments}
        showConnectivity={connectivityVisible}
        highlightDeviceName={highlightDeviceName}
      />

      <Text
        position={[placement.x, placement.height + 0.18, placement.z]}
        fontSize={0.1}
        color={theme.text.primary}
        anchorX="center"
        anchorY="bottom"
      >
        {`${rack.name} — ${placed.length}/${rack.devices.length} devices`}
      </Text>
    </group>
  )
}
