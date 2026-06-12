import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import {
  deviceTransform,
  interRackCablePath,
  intraRackCablePath,
  type DeviceBox,
  type LldpCableSegment,
  type RackPlacement,
} from '@net3d/shared'
import type { SiteCable, SiteRack } from '../hooks/useSiteDetail'

export const CABLE_FALLBACK = '#58b7e8'
export const CABLE_LLDP = '#06b6d4'
const TRAY_CLEARANCE_M = 0.35

const shortName = (n: string) => n.split('.')[0]!.toLowerCase()

export function cableColor(c: SiteCable): string {
  if (c.status !== 'CONNECTED') return '#e05656'
  return c.color ? `#${c.color}` : CABLE_FALLBACK
}

/** Cables between devices inside one rack, routed down the side channel. */
export function RackCables({
  rack,
  placement,
  cables,
  liveStatus,
  lldpSegments = [],
}: {
  rack: SiteRack
  placement: RackPlacement
  cables: SiteCable[]
  liveStatus?: Map<string, 'up' | 'down'>
  /** LLDP-discovered intra-rack links — rendered dashed. */
  lldpSegments?: LldpCableSegment[]
}) {
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
          points: intraRackCablePath(a, b).map((p) => [p.x, p.y, p.z] as [number, number, number]),
        },
      ]
    })
  }, [rack, placement, lldpSegments])

  const lines = useMemo(() => {
    const boxByDevice = new Map<string, DeviceBox>()
    for (const d of rack.devices) {
      const box = deviceTransform(placement, d)
      if (box) boxByDevice.set(d.name, box)
    }
    return cables.flatMap((c) => {
      if (!c.a?.deviceName || !c.b?.deviceName) return []
      const a = boxByDevice.get(c.a.deviceName)
      const b = boxByDevice.get(c.b.deviceName)
      if (!a || !b) return []
      return [
        {
          id: c.id,
          color: cableColor(c),
          points: intraRackCablePath(a, b).map((p) => [p.x, p.y, p.z] as [number, number, number]),
        },
      ]
    })
  }, [rack, placement, cables])

  return (
    <>
      {lines.map((l) => {
        const live = liveStatus?.get(l.id)
        const color = live === 'up' ? '#3ddc6f' : live === 'down' ? '#e03e3e' : l.color
        return (
          <Line
            key={l.id}
            points={l.points}
            color={color}
            lineWidth={live ? 2.5 : 1.5}
            transparent
            opacity={live ? 1 : 0.85}
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
