import type { Vec3 } from './types'
import type { DeviceBox } from './devices'

const SIDE_CHANNEL_M = 0.06
/** Lateral spacing between adjacent vertical cable lanes in the side channel. */
export const LANE_PITCH_M = 0.014

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
