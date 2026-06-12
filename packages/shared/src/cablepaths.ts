import type { Vec3 } from './types'
import type { DeviceBox } from './devices'

const SIDE_CHANNEL_M = 0.06

/** Vertical run down the rack's side channel between two devices in the same rack. */
export function intraRackCablePath(a: DeviceBox, b: DeviceBox): Vec3[] {
  const sideX = Math.max(a.x + a.w / 2, b.x + b.w / 2) + SIDE_CHANNEL_M
  const z = (a.z + b.z) / 2
  return [
    { x: a.x, y: a.y, z: a.z },
    { x: sideX, y: a.y, z },
    { x: sideX, y: b.y, z },
    { x: b.x, y: b.y, z: b.z },
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
