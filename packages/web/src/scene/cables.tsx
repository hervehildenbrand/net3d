import { useMemo } from 'react'
import { Billboard, Line, Text } from '@react-three/drei'
import {
  belongsToRack,
  cableMedium,
  classifyCableForRack,
  classifyCableKind,
  deviceTransform,
  formatOutgoingLabel,
  getCablesForDevice,
  interRackCablePath,
  intraRackCablePath,
  LANE_PITCH_M,
  outgoingStubPath,
  type DeviceBox,
  type LldpCableSegment,
  type RackPlacement,
  type Vec3,
} from '@net3d/shared'
import type { CableEndpoint, SiteCable, SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'

export const CABLE_FALLBACK = '#0ea5e9'
export const CABLE_LLDP = '#06b6d4'
const TRAY_CLEARANCE_M = 0.35
/** Cables cycle through this many vertical lanes so parallel runs stay distinct. */
const MAX_LANES = 8

const shortName = (n: string) => n.split('.')[0]!.toLowerCase()

export function cableColor(c: SiteCable): string {
  if (c.status !== 'CONNECTED') return '#dc2626'
  // honor an explicit NetBox color, else group by physical medium
  if (c.color) return `#${c.color}`
  return theme.cable.medium[cableMedium(c.type)]
}

/** Cables between devices inside one rack, routed down the side channel. */
export function RackCables({
  rack,
  placement,
  cables,
  liveStatus,
  lldpSegments = [],
  showConnectivity = true,
  highlightDeviceName = null,
}: {
  rack: SiteRack
  placement: RackPlacement
  cables: SiteCable[]
  liveStatus?: Map<string, 'up' | 'down'>
  /** LLDP-discovered intra-rack links — rendered dashed. */
  lldpSegments?: LldpCableSegment[]
  /** Render the documented intra-rack cabling (server↔leaf/OOB) at all. */
  showConnectivity?: boolean
  /** Device whose links get full emphasis while everything else dims. */
  highlightDeviceName?: string | null
}) {
  // cabling runs along the rear of the rack, as in reality (front faces +z),
  // and just inside the right rail so the device boxes occlude it from the front
  const rearZ = placement.z - placement.depth / 2 + 0.06
  const channelBaseX = placement.x + placement.width / 2 - 0.04

  const lldpLines = useMemo(() => {
    const boxByShortName = new Map<string, DeviceBox>()
    for (const d of rack.devices) {
      const box = deviceTransform(placement, d)
      if (box) boxByShortName.set(shortName(d.name), box)
    }
    return lldpSegments.flatMap((s) => {
      if (s.scope !== 'intra-rack') return []
      const a = boxByShortName.get(s.localDeviceName)
      const b = boxByShortName.get(s.remoteDeviceName)
      if (!a || !b) return []
      return [
        {
          id: s.id,
          points: intraRackCablePath(a, b, {
            channelX: channelBaseX,
            channelZ: rearZ,
            aAttach: { z: a.z - a.d / 2 },
            bAttach: { z: b.z - b.d / 2 },
          }).map((p) => [p.x, p.y, p.z] as [number, number, number]),
        },
      ]
    })
  }, [rack, placement, lldpSegments, rearZ])

  const { intraLines, outgoingStubs } = useMemo(() => {
    if (!showConnectivity) return { intraLines: [], outgoingStubs: [] }
    const boxByDevice = new Map<string, DeviceBox>()
    for (const d of rack.devices) {
      const box = deviceTransform(placement, d)
      if (box) boxByDevice.set(d.name, box)
    }
    const deviceNamesInRack = new Set(rack.devices.map((d) => d.name))

    // Partition this rack's cables. Intra = both ends here AND both boxed (a cable
    // to an unpositioned same-rack device can't be drawn). Outgoing = exactly one
    // end here; we draw a stub from the local (boxed) device toward the back.
    const intra: SiteCable[] = []
    const outgoing: { cable: SiteCable; localName: string; localPort: string; remote: CableEndpoint | null }[] = []
    for (const c of cables) {
      const cls = classifyCableForRack(c, placement.name, deviceNamesInRack)
      if (cls === 'intra') {
        if (c.a?.deviceName && c.b?.deviceName && boxByDevice.has(c.a.deviceName) && boxByDevice.has(c.b.deviceName)) {
          intra.push(c)
        }
      } else if (cls === 'outgoing') {
        const aBelongs = belongsToRack(c.a, placement.name, deviceNamesInRack)
        const local = aBelongs ? c.a : c.b
        const remote = aBelongs ? c.b : c.a
        if (local?.deviceName && boxByDevice.has(local.deviceName)) {
          outgoing.push({ cable: c, localName: local.deviceName, localPort: local.name, remote })
        }
      }
    }

    // Fan each device's cables (intra + outgoing) to distinct attach points across
    // its face height, so you can read how many links a device has and where they land.
    const union = [...intra, ...outgoing.map((o) => o.cable)]
    const attach = new Map<string, Vec3>() // key: `${cableId}:${deviceName}`
    for (const [deviceName, box] of boxByDevice) {
      const links = getCablesForDevice(union, deviceName)
      const n = links.length
      links.forEach((link, i) => {
        const y = box.y - box.h / 2 + ((i + 1) / (n + 1)) * box.h
        // leave the device at its rear face so cabling exits toward the back
        attach.set(`${link.cableId}:${deviceName}`, { x: box.x + box.w / 2, y, z: box.z - box.d / 2 })
      })
    }

    const intraLines = intra.map((c, idx) => {
      const a = boxByDevice.get(c.a!.deviceName!)!
      const b = boxByDevice.get(c.b!.deviceName!)!
      const mgmt = classifyCableKind(c.a!.name) === 'mgmt' || classifyCableKind(c.b!.name) === 'mgmt'
      return {
        id: c.id,
        color: mgmt ? theme.cable.mgmt : cableColor(c),
        mgmt,
        devices: [c.a!.deviceName!, c.b!.deviceName!],
        points: intraRackCablePath(a, b, {
          // lanes march inward (left) so they stay inside the rack footprint
          channelX: channelBaseX - (idx % MAX_LANES) * LANE_PITCH_M,
          channelZ: rearZ,
          aAttach: attach.get(`${c.id}:${c.a!.deviceName}`),
          bAttach: attach.get(`${c.id}:${c.b!.deviceName}`),
        }).map((p) => [p.x, p.y, p.z] as [number, number, number]),
      }
    })

    const outgoingStubs = outgoing.map((o, idx) => {
      const localAttach = attach.get(`${o.cable.id}:${o.localName}`)!
      const mgmt = classifyCableKind(o.localPort) === 'mgmt'
      // outgoing stubs sit on a separate lane band so they don't overlap intra runs
      const path = outgoingStubPath(localAttach, {
        channelX: channelBaseX - (MAX_LANES + (idx % MAX_LANES)) * LANE_PITCH_M,
        channelZ: rearZ,
      })
      const exit = path[path.length - 1]!
      return {
        id: o.cable.id,
        color: mgmt ? theme.cable.mgmt : cableColor(o.cable),
        mgmt,
        device: o.localName,
        label: formatOutgoingLabel(o.remote),
        exit: [exit.x, exit.y, exit.z] as [number, number, number],
        labelPos: [exit.x, exit.y, exit.z - 0.04] as [number, number, number],
        points: path.map((p) => [p.x, p.y, p.z] as [number, number, number]),
      }
    })

    return { intraLines, outgoingStubs }
  }, [rack, placement, cables, showConnectivity, rearZ, channelBaseX])

  return (
    <>
      {intraLines.map((l) => {
        const live = liveStatus?.get(l.id)
        // hovering/selecting a device emphasizes its links and fades the rest
        const emphasis = highlightDeviceName
          ? l.devices.includes(highlightDeviceName)
            ? 'hi'
            : 'lo'
          : 'none'
        // live up/down wins; else the focused bundle reads as one accent colour
        const color =
          live === 'up'
            ? '#16a34a'
            : live === 'down'
              ? '#dc2626'
              : emphasis === 'hi'
                ? theme.cable.highlight
                : l.color
        return (
          <Line
            key={l.id}
            points={l.points}
            color={color}
            lineWidth={emphasis === 'hi' ? 3 : live ? 2.5 : 1.5}
            dashed={l.mgmt}
            dashSize={0.04}
            gapSize={0.025}
            transparent
            opacity={emphasis === 'hi' ? 1 : emphasis === 'lo' ? 0.08 : live ? 1 : 0.85}
          />
        )
      })}
      {outgoingStubs.map((l) => {
        // emphasis follows the LOCAL device (the one in this rack)
        const emphasis = highlightDeviceName
          ? l.device === highlightDeviceName
            ? 'hi'
            : 'lo'
          : 'none'
        const color = emphasis === 'hi' ? theme.cable.highlight : l.color
        const lineOpacity = emphasis === 'hi' ? 1 : emphasis === 'lo' ? 0.08 : 0.75
        const labelOpacity = emphasis === 'hi' ? 1 : emphasis === 'lo' ? 0.08 : 0.9
        return (
          <group key={`out-${l.id}`}>
            <Line
              points={l.points}
              color={color}
              lineWidth={emphasis === 'hi' ? 3 : 1.5}
              dashed
              dashSize={0.03}
              gapSize={0.02}
              transparent
              opacity={lineOpacity}
            />
            {/* arrow head marking the cable leaving the rack (points out the back, -z) */}
            <mesh position={l.exit} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.012, 0.03, 8]} />
              <meshStandardMaterial color={color} transparent opacity={lineOpacity} />
            </mesh>
            <Billboard position={l.labelPos}>
              <Text
                fontSize={0.028}
                color={emphasis === 'hi' ? theme.text.primary : theme.text.secondary}
                anchorX="left"
                anchorY="middle"
                fillOpacity={labelOpacity}
              >
                {l.label}
              </Text>
            </Billboard>
          </group>
        )
      })}
      {lldpLines.map((l) => (
        <Line
          key={l.id}
          points={l.points}
          color={CABLE_LLDP}
          lineWidth={2}
          dashed
          dashSize={0.05}
          gapSize={0.03}
          transparent
          opacity={0.95}
        />
      ))}
    </>
  )
}

/** One overhead tray line per connected rack pair; brightness follows cable count. */
export function SiteCables({
  placements,
  cables,
  lldpSegments = [],
}: {
  placements: RackPlacement[]
  cables: SiteCable[]
  /** LLDP-discovered inter-rack links — rendered as dashed trays. */
  lldpSegments?: LldpCableSegment[]
}) {
  const lldpLines = useMemo(() => {
    const byRackId = new Map(placements.map((p) => [p.rackId, p]))
    const trayY = Math.max(...placements.map((p) => p.height), 2) + TRAY_CLEARANCE_M + 0.12
    const seen = new Set<string>()
    return lldpSegments.flatMap((s) => {
      if (s.scope !== 'inter-rack' || !s.remoteRackId) return []
      const a = byRackId.get(s.localRackId)
      const b = byRackId.get(s.remoteRackId)
      if (!a || !b) return []
      const key = [s.localRackId, s.remoteRackId].sort().join('|')
      if (seen.has(key)) return []
      seen.add(key)
      return [
        {
          key: `lldp-${key}`,
          points: interRackCablePath(
            { x: a.x, y: a.height, z: a.z },
            { x: b.x, y: b.height, z: b.z },
            trayY,
          ).map((p) => [p.x, p.y, p.z] as [number, number, number]),
        },
      ]
    })
  }, [placements, lldpSegments])
  const lines = useMemo(() => {
    const byRack = new Map(placements.map((p) => [p.name, p]))
    const pairs = new Map<string, { a: RackPlacement; b: RackPlacement; count: number }>()
    for (const c of cables) {
      const ra = c.a?.rackName
      const rb = c.b?.rackName
      if (!ra || !rb || ra === rb) continue
      const pa = byRack.get(ra)
      const pb = byRack.get(rb)
      if (!pa || !pb) continue
      const key = [ra, rb].sort().join('|')
      const e = pairs.get(key)
      if (e) e.count++
      else pairs.set(key, { a: pa, b: pb, count: 1 })
    }
    const trayY = Math.max(...placements.map((p) => p.height), 2) + TRAY_CLEARANCE_M
    const maxCount = Math.max(1, ...[...pairs.values()].map((p) => p.count))
    return [...pairs.entries()].map(([key, { a, b, count }]) => ({
      key,
      intensity: 0.35 + 0.65 * (count / maxCount),
      points: interRackCablePath(
        { x: a.x, y: a.height, z: a.z },
        { x: b.x, y: b.height, z: b.z },
        trayY,
      ).map((p) => [p.x, p.y, p.z] as [number, number, number]),
    }))
  }, [placements, cables])

  return (
    <>
      {lines.map((l) => (
        <Line
          key={l.key}
          points={l.points}
          color={CABLE_FALLBACK}
          lineWidth={1.5}
          transparent
          opacity={l.intensity}
        />
      ))}
      {lldpLines.map((l) => (
        <Line
          key={l.key}
          points={l.points}
          color={CABLE_LLDP}
          lineWidth={2}
          dashed
          dashSize={0.25}
          gapSize={0.15}
          transparent
          opacity={0.9}
        />
      ))}
    </>
  )
}
