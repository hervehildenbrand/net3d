export interface RawTermination {
  __typename: string
  name?: string
  /** Interface form factor (e.g. "100gbase-x-qsfp28"); only present on InterfaceType. */
  type?: string | null
  device?: { name: string; rack: { name: string } | null } | null
  rack?: { name: string } | null
  circuit?: { cid: string } | null
  site?: { name: string } | null
  /** Paired rear port; only present on FrontPortType (NetBox 3.x flat FK). */
  rear_port?: { name: string } | null
  /** NetBox 4.6 replacement for rear_port: multi-position mappings list. */
  mappings?: { rear_port?: { name: string } | null }[] | null
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
  /** Interface form factor at this end (drives bandwidth coloring); null for non-interface ends. */
  ifaceType: string | null
  /** Termination type: interface, front-port, rear-port, or other (powerfeed/circuit). */
  termType: 'interface' | 'front-port' | 'rear-port' | 'other'
  /** Paired rear port name for front-port ends; null otherwise. */
  pairedPort: string | null
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

function deriveTermType(tn: string): 'interface' | 'front-port' | 'rear-port' | 'other' {
  if (tn === 'InterfaceType') return 'interface'
  if (tn === 'FrontPortType') return 'front-port'
  if (tn === 'RearPortType') return 'rear-port'
  return 'other'
}

function normalizeTermination(t: RawTermination | undefined): CableEndpoint | null {
  if (!t) return null
  if (DEVICE_BOUND_TYPES.has(t.__typename)) {
    const termType = deriveTermType(t.__typename)
    return {
      kind: 'device',
      name: t.name ?? '',
      deviceName: t.device?.name ?? null,
      rackName: t.device?.rack?.name ?? null,
      // only real interfaces have a line rate; front/rear/console/power ports don't
      ifaceType: t.__typename === 'InterfaceType' ? (t.type ?? null) : null,
      termType,
      pairedPort:
        t.__typename === 'FrontPortType'
          ? (t.rear_port?.name ?? t.mappings?.[0]?.rear_port?.name ?? null)
          : null,
    }
  }
  if (t.__typename === 'PowerFeedType') {
    return { kind: 'powerfeed', name: t.name ?? '', deviceName: null, rackName: t.rack?.name ?? null, ifaceType: null, termType: 'other', pairedPort: null }
  }
  if (t.__typename === 'CircuitTerminationType') {
    return { kind: 'circuit', name: t.circuit?.cid ?? '', deviceName: null, rackName: null, ifaceType: null, termType: 'other', pairedPort: null }
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
    // NetBox 4.x (Strawberry) returns enums lowercase; the app compares 'CONNECTED'
    status: c.status?.toUpperCase() ?? c.status,
    color: c.color,
    // NetBox 3.7 allows multi-termination sides; the first carries the rack/device we draw to
    a: normalizeTermination(c.a_terminations[0]),
    b: normalizeTermination(c.b_terminations[0]),
  }))
}
