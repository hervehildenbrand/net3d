import type { Vec3 } from './types'
import type { DeviceBox } from './devices'
import type { DeviceCableEnd } from './devicecables'

const SIDE_CHANNEL_M = 0.06
/** Lateral spacing between adjacent vertical cable lanes in the side channel. */
export const LANE_PITCH_M = 0.014
/** How far an outgoing cable stub extends past the rack rear (meters). */
export const STUB_LENGTH_M = 0.25

export interface IntraRackOpts {
  /** Lane index; shifts the vertical run outward by lane*LANE_PITCH_M so parallel cables don't coincide. */
  lane?: number
  /** Override the A endpoint (e.g. fan to a per-cable attach point); missing axes fall back to the box center. */
  aAttach?: Partial<Vec3>
  /** Override the B endpoint; missing axes fall back to the box center. */
  bAttach?: Partial<Vec3>
  /** Depth (z) of the vertical run; defaults to the endpoint midpoint. Set to the rear plane to route cabling at the back of the rack. */
  channelZ?: number
  /** Absolute x of the vertical run; overrides the lane-based side channel. Use to keep cabling inside the rack footprint (hidden behind devices from the front). */
  channelX?: number
}

/** Vertical run down the rack's side channel between two devices in the same rack. */
export function intraRackCablePath(a: DeviceBox, b: DeviceBox, opts?: IntraRackOpts): Vec3[] {
  const start: Vec3 = { x: opts?.aAttach?.x ?? a.x, y: opts?.aAttach?.y ?? a.y, z: opts?.aAttach?.z ?? a.z }
  const end: Vec3 = { x: opts?.bAttach?.x ?? b.x, y: opts?.bAttach?.y ?? b.y, z: opts?.bAttach?.z ?? b.z }
  const sideX =
    opts?.channelX ??
    Math.max(a.x + a.w / 2, b.x + b.w / 2) + SIDE_CHANNEL_M + (opts?.lane ?? 0) * LANE_PITCH_M
  const z = opts?.channelZ ?? (start.z + end.z) / 2
  return [
    start,
    { x: sideX, y: start.y, z },
    { x: sideX, y: end.y, z },
    end,
  ]
}

/** Overhead cable-tray run between two racks. */
export function interRackCablePath(from: Vec3, to: Vec3, trayHeight: number): Vec3[] {
  return [
    from,
    { x: from.x, y: trayHeight, z: from.z },
    { x: to.x, y: trayHeight, z: to.z },
    to,
  ]
}

/**
 * Whether a cable termination sits in the given rack. Device ends match by
 * rack name OR by membership in the rack's device-name set (so a device with a
 * stale endpoint rackName, or one we know by name, still counts). Powerfeeds
 * match by rack name; circuits (rackName null) never belong.
 */
export function belongsToRack(
  end: DeviceCableEnd | null,
  rackName: string,
  deviceNamesInRack: Set<string>,
): boolean {
  if (!end) return false
  if (end.kind === 'device') {
    return end.rackName === rackName || (end.deviceName != null && deviceNamesInRack.has(end.deviceName))
  }
  return end.rackName === rackName
}

/**
 * Classify a cable relative to one rack: 'intra' (both ends in the rack),
 * 'outgoing' (exactly one end in the rack — it leaves toward elsewhere),
 * or 'external' (neither end here — not shown in this rack's view).
 */
export function classifyCableForRack(
  cable: { a: DeviceCableEnd | null; b: DeviceCableEnd | null },
  rackName: string,
  deviceNamesInRack: Set<string>,
): 'intra' | 'outgoing' | 'external' {
  const a = belongsToRack(cable.a, rackName, deviceNamesInRack)
  const b = belongsToRack(cable.b, rackName, deviceNamesInRack)
  if (a && b) return 'intra'
  if (a || b) return 'outgoing'
  return 'external'
}

/**
 * Geometry for a cable that leaves the rack: from the local device's attach
 * point, into the rear channel, then straight out the back by stubLength.
 * The run holds the attach point's y so it reads as a level exit.
 */
export function outgoingStubPath(
  localAttach: Vec3,
  opts: { channelX: number; channelZ: number; stubLength?: number },
): Vec3[] {
  const stub = opts.stubLength ?? STUB_LENGTH_M
  return [
    localAttach,
    { x: opts.channelX, y: localAttach.y, z: opts.channelZ },
    { x: opts.channelX, y: localAttach.y, z: opts.channelZ - stub },
  ]
}

/** Destination label for an outgoing cable's far (remote) end. */
export function formatOutgoingLabel(remoteEnd: DeviceCableEnd | null): string {
  if (!remoteEnd) return '→ (dangling)'
  if (remoteEnd.kind === 'circuit') return `→ circuit / ${remoteEnd.name}`
  if (remoteEnd.kind === 'powerfeed') return `→ ${remoteEnd.rackName ?? 'power'} / ${remoteEnd.name}`
  return `→ ${remoteEnd.rackName ?? '?'} / ${remoteEnd.deviceName ?? '?'} / ${remoteEnd.name}`
}

/**
 * Funnel one of a device's outgoing cables from its fanned rear attach point into
 * the device's single bundle exit node: jog out to the bundle lane at the attach
 * height, converge vertically to the device's exit height, then exit out the back.
 */
export function bundleConvergencePath(
  localAttach: Vec3,
  opts: { bundleX: number; rearZ: number; exitY: number; exitZ: number },
): Vec3[] {
  return [
    localAttach,
    { x: opts.bundleX, y: localAttach.y, z: opts.rearZ },
    { x: opts.bundleX, y: opts.exitY, z: opts.rearZ },
    { x: opts.bundleX, y: opts.exitY, z: opts.exitZ },
  ]
}

/**
 * Summarize a device's outgoing destinations for the count badge + on-focus hint.
 * `count` is every outgoing cable (circuits/dangling included); `top` is the most
 * frequent destination racks (frequency desc, then name asc); `moreRacks` is the
 * remaining distinct racks not shown.
 */
export function summarizeDestinations(
  remoteRackNames: (string | null)[],
  topN = 2,
): { count: number; top: string[]; moreRacks: number } {
  const freq = new Map<string, number>()
  for (const r of remoteRackNames) {
    if (r == null) continue
    freq.set(r, (freq.get(r) ?? 0) + 1)
  }
  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([r]) => r)
  return { count: remoteRackNames.length, top: ranked.slice(0, topN), moreRacks: Math.max(0, ranked.length - topN) }
}
