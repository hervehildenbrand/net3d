import type { SiteRack } from '../hooks/useSiteDetail'
import type { ViewLevel } from '../store/useAppStore'

/** Roles worth an LLDP call. No 'tor': it would match 'monitor'. */
const NETWORK_ROLE = /switch|leaf|spine|router|firewall/i

export function isNetworkRole(roleName: string): boolean {
  return NETWORK_ROLE.test(roleName)
}

/**
 * Which devices LLDP discovery should query. In any site view, all
 * network-role devices site-wide (documented NetBox cables still win per-link
 * in lldpToSegments); rack view additionally queries the whole selected rack,
 * matching its historical behavior.
 */
export function computeActiveLldpIds(
  napalmAvailable: boolean,
  level: ViewLevel,
  racks: SiteRack[],
  selectedRack: SiteRack | undefined,
): Set<string> {
  const ids = new Set<string>()
  if (!napalmAvailable || level === 'map') return ids
  for (const r of racks) for (const d of r.devices) if (isNetworkRole(d.roleName)) ids.add(d.id)
  if (level === 'rack' && selectedRack) for (const d of selectedRack.devices) ids.add(d.id)
  return ids
}
