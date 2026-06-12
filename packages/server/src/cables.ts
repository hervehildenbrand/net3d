export interface RawTermination {
  __typename: string
  name?: string
  device?: { name: string; rack: { name: string } | null } | null
  rack?: { name: string } | null
  circuit?: { cid: string } | null
  site?: { name: string } | null
}

export interface RawCable {
  id: string
  type: string | null
  status: string
  color: string
  a_terminations: RawTermination[]
  b_terminations: RawTermination[]
}

export interface CableEndpoint {
  kind: 'device' | 'powerfeed' | 'circuit'
  name: string
  deviceName: string | null
  rackName: string | null
}

export interface SiteCable {
  id: string
  type: string | null
  status: string
  color: string
  a: CableEndpoint | null
  b: CableEndpoint | null
}

const DEVICE_BOUND_TYPES = new Set([
  'InterfaceType',
  'FrontPortType',
  'RearPortType',
  'ConsolePortType',
  'ConsoleServerPortType',
  'PowerPortType',
  'PowerOutletType',
])

const unknownTypes = new Set<string>()

function normalizeTermination(t: RawTermination | undefined): CableEndpoint | null {
  if (!t) return null
  if (DEVICE_BOUND_TYPES.has(t.__typename)) {
    return {
      kind: 'device',
      name: t.name ?? '',
      deviceName: t.device?.name ?? null,
      rackName: t.device?.rack?.name ?? null,
    }
  }
  if (t.__typename === 'PowerFeedType') {
    return { kind: 'powerfeed', name: t.name ?? '', deviceName: null, rackName: t.rack?.name ?? null }
  }
  if (t.__typename === 'CircuitTerminationType') {
    return { kind: 'circuit', name: t.circuit?.cid ?? '', deviceName: null, rackName: null }
  }
  if (!unknownTypes.has(t.__typename)) {
    unknownTypes.add(t.__typename)
    console.warn(`net3d: unknown cable termination type ${t.__typename} — endpoint dropped`)
  }
  return null
}

export function normalizeRawCables(raw: RawCable[]): SiteCable[] {
  return raw.map((c) => ({
    id: c.id,
    type: c.type,
    status: c.status,
    color: c.color,
    // NetBox 3.7 allows multi-termination sides; the first carries the rack/device we draw to
    a: normalizeTermination(c.a_terminations[0]),
    b: normalizeTermination(c.b_terminations[0]),
  }))
}
