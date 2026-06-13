import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import {
  cableMedium,
  classifyCableKind,
  deviceTransform,
  getCablesForDevice,
  interRackCablePath,
  intraRackCablePath,
  LANE_PITCH_M,
  type DeviceBox,
  type LldpCableSegment,
  type RackPlacement,
  type Vec3,
} from '@net3d/shared'
import type { SiteCable, SiteRack } from '../hooks/useSiteDetail'
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

  const lines = useMemo(() => {
    if (!showConnectivity) return []
    const boxByDevice = new Map<string, DeviceBox>()
    for (const d of rack.devices) {
      const box = deviceTransform(placement, d)
      if (box) boxByDevice.set(d.name, box)
    }
    // only cables whose both ends are devices in this rack are drawn here
    const drawable = cables.filter(
      (c) =>
        c.a?.deviceName &&
        c.b?.deviceName &&
        boxByDevice.has(c.a.deviceName) &&
        boxByDevice.has(c.b.deviceName),
    )
    // fan each device's cables to distinct attach points across its face height,
    // so you can read how many links a device has and where they land
    const attach = new Map<string, Vec3>() // key: `${cableId}:${deviceName}`
    for (const [deviceName, box] of boxByDevice) {
      const links = getCablesForDevice(drawable, deviceName)
      const n = links.length
      links.forEach((link, i) => {
        const y = box.y - box.h / 2 + ((i + 1) / (n + 1)) * box.h
        // leave the device at its rear face so cabling exits toward the back
        attach.set(`${link.cableId}:${deviceName}`, { x: box.x + box.w / 2, y, z: box.z - box.d / 2 })
      })
    }
    return drawable.map((c, idx) => {
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
  }, [rack, placement, cables, showConnectivity, rearZ])

  return (
    <>
      {lines.map((l) => {
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
