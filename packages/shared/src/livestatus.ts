export interface LiveInterface {
  is_up: boolean
}

interface CableSide {
  deviceName: string | null
  name: string
}

interface CableLike {
  id: string
  a: CableSide | null
  b: CableSide | null
}

export type CableStatus = 'up' | 'down'

/**
 * Color documented cables with live NAPALM interface state for one device.
 * Subinterface readings (et-0/0/0.0) also satisfy their base interface.
 */
export function mapInterfacesToCables(
  interfaces: Record<string, LiveInterface>,
  cables: CableLike[],
  deviceName: string,
): Map<string, CableStatus> {
  const byName = new Map<string, boolean>()
  for (const [name, i] of Object.entries(interfaces)) {
    byName.set(name, i.is_up)
    const base = name.split('.')[0]!
    if (base !== name && !byName.has(base)) byName.set(base, i.is_up)
  }

  const result = new Map<string, CableStatus>()
  for (const c of cables) {
    const side = [c.a, c.b].find((s) => s?.deviceName === deviceName)
    if (!side) continue
    const up = byName.get(side.name)
    if (up === undefined) continue
    result.set(c.id, up ? 'up' : 'down')
  }
  return result
}
