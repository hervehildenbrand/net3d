import { U_METERS, type RackPlacement } from './layout'

const RAIL_INSET_M = 0.04
const U_GAP_M = 0.004

export interface DeviceForTransform {
  /** Lowest occupied U, 1-based; null when unracked/child device. */
  position: number | null
  face: string | null
  uHeight: number
  isFullDepth: boolean
}

export interface DeviceBox {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
}

/** World-space box for a device mounted in a placed rack. Front of rack faces +z. */
export function deviceTransform(
  rack: RackPlacement,
  device: DeviceForTransform,
): DeviceBox | null {
  if (device.position === null) return null

  const h = device.uHeight * U_METERS - U_GAP_M
  const y = (device.position - 1 + device.uHeight / 2) * U_METERS

  let d: number
  let z: number
  if (device.isFullDepth) {
    d = rack.depth * 0.9
    z = rack.z
  } else {
    d = rack.depth * 0.42
    const offset = rack.depth / 2 - d / 2 - 0.05
    z = device.face === 'REAR' ? rack.z - offset : rack.z + offset
  }

  return { x: rack.x, y, z, w: rack.width - RAIL_INSET_M, h, d }
}
