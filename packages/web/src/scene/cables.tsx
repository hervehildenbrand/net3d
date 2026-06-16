import { useMemo } from 'react'
import { Billboard, Line, Text } from '@react-three/drei'
import {
  belongsToRack,
  bundleConvergencePath,
  cableMedium,
  classifyCableForRack,
  classifyCableKind,
  collectDevicePortNames,
  deviceTransform,
  getCablesForDevice,
  interRackCablePath,
  intraRackCablePath,
  LANE_PITCH_M,
  portSlotLayout,
  STUB_LENGTH_M,
  summarizeDestinations,
  type CableMedium,
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
const MAX_LANES = 12
/** Outgoing bundles sit this far left of the intra lane band so the two never overlap. */
const BUNDLE_LANE_OFFSET = 0.1

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

  const { intraLines, outgoingBundles } = useMemo(() => {
    if (!showConnectivity) return { intraLines: [], outgoingBundles: [] }
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

    // Anchor each cable to its interface's port slot on the device's rear face, so
    // a device's links land on distinct, stable points (a synthetic faceplate built
    // from the connected interface names) instead of being fanned by ordinal. The
    // port markers in RackLevel use the same layout, so cables meet the right port.
    const attach = new Map<string, Vec3>() // key: `${cableId}:${deviceName}`
    for (const [deviceName, box] of boxByDevice) {
      const slots = portSlotLayout(box, collectDevicePortNames(cables, deviceName))
      for (const link of getCablesForDevice(cables, deviceName)) {
        const slot = slots.get(link.interfaceName)
        if (slot) attach.set(`${link.cableId}:${deviceName}`, { x: slot.x, y: slot.y, z: slot.z })
      }
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

    // Collapse each device's outgoing cables into ONE bundle: many cables → one
    // exit node + one "↗count" badge, so a spine with 49 uplinks reads as a single
    // labelled exit instead of 49 overprinted labels. Full detail lives in the panel.
    const byDevice = new Map<string, typeof outgoing>()
    for (const o of outgoing) {
      const arr = byDevice.get(o.localName)
      if (arr) arr.push(o)
      else byDevice.set(o.localName, [o])
    }
    const bundleX = channelBaseX - BUNDLE_LANE_OFFSET
    const exitZ = rearZ - STUB_LENGTH_M
    const outgoingBundles = [...byDevice.entries()].map(([deviceName, items]) => {
      const box = boxByDevice.get(deviceName)!
      const exitY = box.y
      const medTally = new Map<CableMedium, number>()
      let mgmtCount = 0
      const lines = items.map((o) => {
        const localAttach = attach.get(`${o.cable.id}:${deviceName}`)!
        const isMgmt = classifyCableKind(o.localPort) === 'mgmt'
        if (isMgmt) mgmtCount++
        const med = cableMedium(o.cable.type)
        medTally.set(med, (medTally.get(med) ?? 0) + 1)
        return {
          color: isMgmt ? theme.cable.mgmt : cableColor(o.cable),
          points: bundleConvergencePath(localAttach, { bundleX, rearZ, exitY, exitZ }).map(
            (p) => [p.x, p.y, p.z] as [number, number, number],
          ),
        }
      })
      const dominant = [...medTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'
      const nodeColor = mgmtCount === items.length ? theme.cable.mgmt : theme.cable.medium[dominant]
      const summary = summarizeDestinations(items.map((o) => o.remote?.rackName ?? null), 2)
      const hint =
        summary.top.length > 0
          ? `${summary.top.join(', ')}${summary.moreRacks > 0 ? `  +${summary.moreRacks}` : ''}`
          : ''
      return {
        device: deviceName,
        lines,
        nodeColor,
        exit: [bundleX, exitY, exitZ] as [number, number, number],
        // badge + hint sit just outward (left) of the exit cone in open space
        badgePos: [bundleX - 0.03, exitY, exitZ] as [number, number, number],
        hintPos: [bundleX - 0.03, exitY - 0.05, exitZ] as [number, number, number],
        count: summary.count,
        hint,
      }
    })

    return { intraLines, outgoingBundles }
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
            opacity={emphasis === 'hi' ? 1 : emphasis === 'lo' ? 0.08 : live ? 1 : 0.5}
          />
        )
      })}
      {outgoingBundles.map((b) => {
        // emphasis follows the LOCAL device (the one in this rack)
        const emphasis = highlightDeviceName
          ? b.device === highlightDeviceName
            ? 'hi'
            : 'lo'
          : 'none'
        const lineOpacity = emphasis === 'hi' ? 1 : emphasis === 'lo' ? 0.06 : 0.3
        const nodeColor = emphasis === 'hi' ? theme.cable.highlight : b.nodeColor
        const badgeOpacity = emphasis === 'hi' ? 1 : emphasis === 'lo' ? 0.06 : 0.7
        return (
          <group key={`out-${b.device}`}>
            {b.lines.map((ln, i) => (
              <Line
                key={i}
                points={ln.points}
                color={emphasis === 'hi' ? theme.cable.highlight : ln.color}
                lineWidth={emphasis === 'hi' ? 2.5 : 1}
                dashed
                dashSize={0.03}
                gapSize={0.02}
                transparent
                opacity={lineOpacity}
              />
            ))}
            {/* one exit node + count badge per device (points out the back, -z) */}
            <mesh position={b.exit} rotation={[-Math.PI / 2, 0, 0]}>
              <coneGeometry args={[emphasis === 'hi' ? 0.018 : 0.014, 0.035, 10]} />
              <meshStandardMaterial color={nodeColor} transparent opacity={emphasis === 'lo' ? 0.06 : 0.9} />
            </mesh>
            <Billboard position={b.badgePos}>
              <Text
                fontSize={0.034}
                color={emphasis === 'hi' ? theme.text.primary : theme.text.secondary}
                anchorX="right"
                anchorY="middle"
                fillOpacity={badgeOpacity}
              >
                {`${b.count} out`}
              </Text>
            </Billboard>
            {/* on focus, reveal where this device's cables go (top racks + remainder) */}
            {emphasis === 'hi' && b.hint && (
              <Billboard position={b.hintPos}>
                <Text fontSize={0.022} color={theme.text.secondary} anchorX="right" anchorY="middle">
                  {b.hint}
                </Text>
              </Billboard>
            )}
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
