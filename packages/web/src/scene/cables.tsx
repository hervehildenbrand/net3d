import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import {
  deviceTransform,
  interRackCablePath,
  intraRackCablePath,
  type DeviceBox,
  type RackPlacement,
} from '@net3d/shared'
import type { SiteCable, SiteRack } from '../hooks/useSiteDetail'

export const CABLE_FALLBACK = '#58b7e8'
const TRAY_CLEARANCE_M = 0.35

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
}: {
  rack: SiteRack
  placement: RackPlacement
  cables: SiteCable[]
  liveStatus?: Map<string, 'up' | 'down'>
}) {
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
    </>
  )
}

/** One overhead tray line per connected rack pair; brightness follows cable count. */
export function SiteCables({
  placements,
  cables,
}: {
  placements: RackPlacement[]
  cables: SiteCable[]
}) {
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
    </>
  )
}
