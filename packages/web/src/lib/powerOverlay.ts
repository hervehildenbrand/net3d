import { deviceTransform, type DeviceBox, type RackPlacement } from '@net3d/shared'
import type { SiteCable, SiteDevice, SiteRack } from '../hooks/useSiteDetail'
import { theme } from '../theme'

export type FeedSide = 'A' | 'B'

export interface PduRail {
  position: [number, number, number]
  scale: [number, number, number]
  color: string
  side: FeedSide
}

export interface PowerCord {
  id: string
  points: [number, number, number][]
  color: string
  side: FeedSide
  /** The powered device (not the PDU) this cord belongs to. */
  device: string
}

/** Thin vertical PDU rail footprint (x) and depth (z), and how far it insets from the rack face. */
const RAIL_W = 0.03
const RAIL_D = 0.08
const RAIL_INSET = 0.02
/** Rear plane where cabling runs (matches cables.tsx). */
const REAR_CHANNEL = 0.06

export function railColor(side: FeedSide): string {
  return side === 'A' ? theme.power.feedA : theme.power.feedB
}

/** A device is a PDU when its NetBox role is "pdu" (case-insensitive). */
export function isPdu(d: SiteDevice): boolean {
  return d.roleName.toLowerCase() === 'pdu'
}

/** Feed side encoded in a PDU/feed name's trailing "-A"/"-B"; null if absent. */
export function pduSide(name: string): FeedSide | null {
  const m = /-([ab])$/i.exec(name)
  return m ? (m[1]!.toUpperCase() as FeedSide) : null
}

/** The rack's PDUs paired with their feed side (only those with a resolvable side). */
export function pduDevices(rack: SiteRack): { device: SiteDevice; side: FeedSide }[] {
  const out: { device: SiteDevice; side: FeedSide }[] = []
  for (const d of rack.devices) {
    if (!isPdu(d)) continue
    const side = pduSide(d.name)
    if (side) out.push({ device: d, side })
  }
  return out
}

export function pduNameSet(rack: SiteRack): Set<string> {
  return new Set(rack.devices.filter(isPdu).map((d) => d.name))
}

/** A cable is a power cord when an end terminates on a PDU device or a power feed. */
export function isPowerCable(cable: SiteCable, pduNames: Set<string>): boolean {
  for (const e of [cable.a, cable.b]) {
    if (!e) continue
    if (e.kind === 'powerfeed') return true
    if (e.kind === 'device' && e.deviceName && pduNames.has(e.deviceName)) return true
  }
  return false
}

/** Rear-corner (x,z) of the side's PDU rail in world space. */
function railXZ(p: RackPlacement, side: FeedSide): { x: number; z: number } {
  const x = side === 'A' ? p.x - p.width / 2 + RAIL_INSET : p.x + p.width / 2 - RAIL_INSET
  return { x, z: p.z - p.depth / 2 + RAIL_INSET }
}

/** One full-height rail per PDU, at the rear-left (A) / rear-right (B) corner. */
export function buildPduRails(
  placement: RackPlacement,
  pdus: { device: SiteDevice; side: FeedSide }[],
): PduRail[] {
  return pdus.map(({ side }) => {
    const { x, z } = railXZ(placement, side)
    return {
      position: [x, placement.height / 2, z],
      scale: [RAIL_W, placement.height, RAIL_D],
      color: railColor(side),
      side,
    }
  })
}

/**
 * One cord per device→PDU power cable: from the device's rear attach point (fanned
 * across its face height when it has several) to its A/B rail. PDU-input→feed cables
 * are skipped (no powered-device end). Reuses deviceTransform for device boxes.
 */
export function buildPowerCords(
  rack: SiteRack,
  placement: RackPlacement,
  cables: SiteCable[],
): PowerCord[] {
  const pdus = pduDevices(rack)
  if (pdus.length === 0) return []
  const sideByPdu = new Map(pdus.map((p) => [p.device.name, p.side]))
  const pduNames = new Set(pdus.map((p) => p.device.name))

  const boxByDevice = new Map<string, DeviceBox>()
  for (const d of rack.devices) {
    if (isPdu(d)) continue
    const box = deviceTransform(placement, d)
    if (box) boxByDevice.set(d.name, box)
  }

  // Group each powered device's power cords so they can be fanned across its height.
  const perDevice = new Map<string, { cableId: string; side: FeedSide }[]>()
  for (const c of cables) {
    if (!isPowerCable(c, pduNames)) continue
    const ends = [c.a, c.b]
    const pduEnd = ends.find((e) => e?.deviceName && pduNames.has(e.deviceName))
    const devEnd = ends.find(
      (e) => e?.deviceName && !pduNames.has(e.deviceName) && boxByDevice.has(e.deviceName),
    )
    if (!pduEnd?.deviceName || !devEnd?.deviceName) continue
    const side = sideByPdu.get(pduEnd.deviceName)!
    const arr = perDevice.get(devEnd.deviceName) ?? []
    arr.push({ cableId: c.id, side })
    perDevice.set(devEnd.deviceName, arr)
  }

  const rearZ = placement.z - placement.depth / 2 + REAR_CHANNEL
  const cords: PowerCord[] = []
  for (const [deviceName, links] of perDevice) {
    const box = boxByDevice.get(deviceName)!
    const n = links.length
    links.forEach((link, i) => {
      const y = box.y - box.h / 2 + ((i + 1) / (n + 1)) * box.h
      const { x: railX, z: railZ } = railXZ(placement, link.side)
      cords.push({
        id: `${link.cableId}:${deviceName}`,
        points: [
          [box.x + box.w / 2, y, box.z - box.d / 2],
          [railX, y, rearZ],
          [railX, y, railZ],
        ],
        color: railColor(link.side),
        side: link.side,
        device: deviceName,
      })
    })
  }
  return cords
}
