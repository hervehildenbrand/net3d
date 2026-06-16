import type { DeviceBox } from './devices'
import { getCablesForDevice, type DeviceCableEnd } from './devicecables'

/** Target spacing between port-slot centers across the device width (m). */
export const PORT_PITCH_M = 0.05

/** A port's footprint on the device face: center (x,y,z) + its grid-cell size. */
export interface PortSlot {
  x: number
  y: number
  z: number
  w: number
  h: number
}

type CableLike = { id: string; a: DeviceCableEnd | null; b: DeviceCableEnd | null }

/**
 * Unique interface names that terminate on a device across the given cables,
 * sorted (getCablesForDevice already sorts by interface name; we just dedup,
 * preserving that order). This is the synthetic faceplate — only connected
 * ports, since that's all the data carries.
 */
export function collectDevicePortNames(cables: CableLike[], deviceName: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const link of getCablesForDevice(cables, deviceName)) {
    if (seen.has(link.interfaceName)) continue
    seen.add(link.interfaceName)
    names.push(link.interfaceName)
  }
  return names
}

/**
 * Lay the ports out as a grid on the device's rear face (z = box.z - box.d/2,
 * the side cabling exits). Columns are sized to PORT_PITCH_M across the box
 * width (>=1); remaining ports stack upward in rows. Deterministic for a given
 * (box, names) pair, so the rendered port markers and the cable attach points
 * computed in separate components agree on every slot's position.
 */
export function portSlotLayout(box: DeviceBox, portNames: string[]): Map<string, PortSlot> {
  const slots = new Map<string, PortSlot>()
  const n = portNames.length
  if (n === 0) return slots

  const cols = Math.max(1, Math.min(n, Math.floor(box.w / PORT_PITCH_M)))
  const rows = Math.ceil(n / cols)
  const cellW = box.w / cols
  const cellH = box.h / rows
  const left = box.x - box.w / 2
  const bottom = box.y - box.h / 2
  const z = box.z - box.d / 2

  portNames.forEach((name, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    slots.set(name, {
      x: left + (col + 0.5) * cellW,
      y: bottom + (row + 0.5) * cellH,
      z,
      w: cellW,
      h: cellH,
    })
  })
  return slots
}
