import { deviceTransform, type DeviceBox, type RackPlacement } from '@net3d/shared'
import type { SiteCable, SiteDevice, SitePower, SiteRack } from '../hooks/useSiteDetail'
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

export type Redundancy = 'dual' | 'single' | 'none'

/** Feed sides (A/B) a device draws from, via its power cords to the rack's PDUs. */
export function deviceFeedSides(
  deviceName: string,
  rack: SiteRack,
  cables: SiteCable[],
): Set<FeedSide> {
  const pdus = pduDevices(rack)
  const sideByPdu = new Map(pdus.map((p) => [p.device.name, p.side]))
  const pduNames = new Set(pdus.map((p) => p.device.name))
  const sides = new Set<FeedSide>()
  for (const c of cables) {
    if (!isPowerCable(c, pduNames)) continue
    const ends = [c.a, c.b]
    const pduEnd = ends.find((e) => e?.deviceName && pduNames.has(e.deviceName))
    const devEnd = ends.find((e) => e?.deviceName && !pduNames.has(e.deviceName))
    if (!pduEnd?.deviceName || devEnd?.deviceName !== deviceName) continue
    const side = sideByPdu.get(pduEnd.deviceName)
    if (side) sides.add(side)
  }
  return sides
}

/**
 * Power redundancy of a device: 'dual' (fed by both A and B), 'single' (one side
 * only — a redundancy risk), or 'none' (no power cords documented).
 */
export function deriveRedundancy(deviceName: string, rack: SiteRack, cables: SiteCable[]): Redundancy {
  const sides = deviceFeedSides(deviceName, rack, cables)
  if (sides.size === 0) return 'none'
  return sides.has('A') && sides.has('B') ? 'dual' : 'single'
}

export interface RackPowerLoad {
  /** Sum of every device's typical draw (W), including any without a documented feed. */
  totalW: number
  /** Watts carried by the A feed (dual-fed devices split their draw across legs). */
  legA: number
  /** Watts carried by the B feed. */
  legB: number
  /** |A−B| / (A+B): 0 = perfectly balanced, 1 = entirely on one leg. */
  imbalance: number
}

/**
 * Rack power load and A/B leg balance from device draws (specs.powerDrawW) and
 * each device's feed sides. A dual-fed device splits its draw evenly across both
 * legs; a single-fed device loads only its one leg.
 */
export function rackPowerLoad(rack: SiteRack, cables: SiteCable[]): RackPowerLoad {
  let totalW = 0
  let legA = 0
  let legB = 0
  for (const d of rack.devices) {
    const w = d.specs?.powerDrawW ?? 0
    if (w <= 0) continue
    totalW += w
    const sides = deviceFeedSides(d.name, rack, cables)
    if (sides.size === 0) continue
    const per = w / sides.size
    if (sides.has('A')) legA += per
    if (sides.has('B')) legB += per
  }
  const sum = legA + legB
  return { totalW, legA, legB, imbalance: sum > 0 ? Math.abs(legA - legB) / sum : 0 }
}

/** Site-wide power load: rackPowerLoad summed across racks, with overall A/B imbalance. */
export function sitePowerLoad(racks: SiteRack[], cables: SiteCable[]): RackPowerLoad {
  let totalW = 0
  let legA = 0
  let legB = 0
  for (const r of racks) {
    const l = rackPowerLoad(r, cables)
    totalW += l.totalW
    legA += l.legA
    legB += l.legB
  }
  const sum = legA + legB
  return { totalW, legA, legB, imbalance: sum > 0 ? Math.abs(legA - legB) / sum : 0 }
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

// ---------------------------------------------------------------------------
// Room-view overlay: per-rack A/B strips, panel nodes, and a power summary.
// ---------------------------------------------------------------------------

export interface RoomPduStrip {
  rackId: string
  position: [number, number, number]
  scale: [number, number, number]
  color: string
  side: FeedSide
}

export interface PanelNode {
  side: FeedSide
  name: string
  position: [number, number, number]
  color: string
}

export interface PowerSummary {
  /** Total vertical PDUs across the site's racks. */
  pduCount: number
  panelCount: number
  feedCount: number
  /** Distinct racks served by at least one feed. */
  racksFed: number
  voltage: number | null
  amperage: number | null
  phase: string | null
}

/** Thin A/B side strips on each dual-fed rack so the redundancy reads at room scale. */
const STRIP_W = 0.04
const STRIP_INSET = 0.03

export function buildRoomPduStrips(racks: SiteRack[], placements: RackPlacement[]): RoomPduStrip[] {
  const racksById = new Map(racks.map((r) => [r.id, r]))
  const strips: RoomPduStrip[] = []
  for (const p of placements) {
    const rack = racksById.get(p.rackId)
    if (!rack) continue
    for (const { side } of pduDevices(rack)) {
      const x = side === 'A' ? p.x - p.width / 2 + STRIP_INSET : p.x + p.width / 2 - STRIP_INSET
      strips.push({
        rackId: p.rackId,
        position: [x, p.height / 2, p.z],
        scale: [STRIP_W, p.height, p.depth * 0.5],
        color: railColor(side),
        side,
      })
    }
  }
  return strips
}

/** Two panel markers (A left, B right) at the room edges, labelled from NetBox panels. */
export function panelNodes(placements: RackPlacement[], power: SitePower): PanelNode[] {
  if (placements.length === 0 || power.panels.length === 0) return []
  const xs = placements.map((p) => p.x)
  const zs = placements.map((p) => p.z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const y = Math.max(...placements.map((p) => p.height))
  const margin = 1.5
  const nodes: PanelNode[] = []
  for (const panel of power.panels) {
    const side = pduSide(panel.name)
    if (!side) continue
    nodes.push({
      side,
      name: panel.name,
      position: [side === 'A' ? minX - margin : maxX + margin, y, cz],
      color: railColor(side),
    })
  }
  return nodes
}

/** Site power roll-up for the legend: PDU/panel/feed counts + representative feed specs. */
export function collectSitePower(racks: SiteRack[], power?: SitePower): PowerSummary {
  let pduCount = 0
  for (const r of racks) pduCount += r.devices.filter(isPdu).length
  const feeds = power?.feeds ?? []
  const first = feeds[0]
  return {
    pduCount,
    panelCount: power?.panels.length ?? 0,
    feedCount: feeds.length,
    racksFed: new Set(feeds.map((f) => f.rackName).filter(Boolean)).size,
    voltage: first?.voltage ?? null,
    amperage: first?.amperage ?? null,
    phase: first?.phase ?? null,
  }
}
