import type { SiteDevice, SiteRack } from '../hooks/useSiteDetail'

/** Categorical palette for subnets; cycles if a site has more subnets than colors. */
const PALETTE = [
  '#2563eb', // blue
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#dc2626', // red
  '#0891b2', // cyan
  '#db2777', // pink
  '#65a30d', // lime
  '#ea580c', // orange
  '#4f46e5', // indigo
]

/** Subnet for a device with no resolvable network. */
const NO_SUBNET = '#94a3b8'

/**
 * The network address + prefix of a device's primary IP (e.g. "10.5.20.7/24" →
 * "10.5.20.0/24"); null when the device has no primary IP. A bare address with no
 * mask is treated as a /32 host route.
 */
export function deviceSubnet(device: SiteDevice): string | null {
  const ip = device.primaryIp
  if (!ip) return null
  const [addr, prefixStr] = ip.split('/')
  const prefix = prefixStr ? Number(prefixStr) : 32
  const octets = addr!.split('.').map(Number)
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o)) || Number.isNaN(prefix)) return null
  const ipInt = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const net = (ipInt & mask) >>> 0
  return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${prefix}`
}

/** Distinct subnets across the placeable devices of the given racks, sorted. */
export function collectSubnets(racks: SiteRack[]): string[] {
  const seen = new Set<string>()
  for (const rack of racks) {
    for (const d of rack.devices) {
      if (d.position == null) continue
      const s = deviceSubnet(d)
      if (s) seen.add(s)
    }
  }
  return [...seen].sort()
}

/** The most common subnet among a rack's placeable devices; null when none have an IP. */
export function rackDominantSubnet(rack: SiteRack): string | null {
  const counts = new Map<string, number>()
  for (const d of rack.devices) {
    if (d.position == null) continue
    const s = deviceSubnet(d)
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [s, n] of counts) {
    if (n > bestN) {
      best = s
      bestN = n
    }
  }
  return best
}

/** Stable categorical color for a subnet, by its index in the site's subnet list. */
export function subnetColor(subnet: string, subnets: string[]): string {
  const i = subnets.indexOf(subnet)
  if (i < 0) return NO_SUBNET
  return PALETTE[i % PALETTE.length]!
}
