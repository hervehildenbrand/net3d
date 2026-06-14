/** Structural subset of a cable termination (server and web SiteCable both satisfy it). */
export interface DeviceCableEnd {
  kind: string
  /** Termination (interface/port) name. */
  name: string
  deviceName: string | null
  rackName: string | null
}

export interface DeviceLink {
  /** Interface on the device being asked about. */
  interfaceName: string
  remoteDeviceName: string | null
  remoteInterfaceName: string | null
  /** Rack of the remote end (null for circuits / dangling cables). */
  remoteRackName: string | null
  kind: 'data' | 'mgmt'
  cableId: string
}

/** Management links (mgmt0, Mgmt-*) vs data links, by local interface name. */
export function classifyCableKind(interfaceName: string): 'data' | 'mgmt' {
  return /^mgmt/i.test(interfaceName) ? 'mgmt' : 'data'
}

/**
 * All documented cables touching a device, normalized so the device's own
 * interface comes first regardless of which cable side it terminates on.
 * Sorted by interface name for a stable port-allocation listing.
 */
export function getCablesForDevice(
  cables: { id: string; a: DeviceCableEnd | null; b: DeviceCableEnd | null }[],
  deviceName: string,
): DeviceLink[] {
  const links: DeviceLink[] = []
  for (const c of cables) {
    const local = c.a?.deviceName === deviceName ? c.a : c.b?.deviceName === deviceName ? c.b : null
    if (!local) continue
    const remote = local === c.a ? c.b : c.a
    links.push({
      interfaceName: local.name,
      remoteDeviceName: remote?.deviceName ?? null,
      remoteInterfaceName: remote?.name ?? null,
      remoteRackName: remote?.rackName ?? null,
      kind: classifyCableKind(local.name),
      cableId: c.id,
    })
  }
  return links.sort((x, y) => x.interfaceName.localeCompare(y.interfaceName))
}
