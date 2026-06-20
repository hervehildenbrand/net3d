import type { SiteRack } from '../hooks/useSiteDetail'

/** Lifecycle order for the legend: in-service first, end-of-life last. */
const STATUS_ORDER = [
  'active',
  'planned',
  'staged',
  'failed',
  'offline',
  'decommissioning',
  'inventory',
] as const

/** Distinct hue per known NetBox/Infrahub device status; '#rrggbb', lowercase. */
const STATUS_COLORS: Record<string, string> = {
  active: '#16a34a', // green — in service
  planned: '#2563eb', // blue — not built yet
  staged: '#0891b2', // cyan — racked, pre-production
  failed: '#dc2626', // red — faulted
  offline: '#64748b', // slate — powered down
  decommissioning: '#d97706', // amber — being removed
  inventory: '#7c3aed', // violet — spare stock
}

/** One neutral color for any status outside the known set. */
const UNKNOWN_COLOR = '#94a3b8'

/** Color for a device status (case-insensitive); unknown statuses share a neutral hue. */
export function statusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? UNKNOWN_COLOR
}

/**
 * Distinct statuses across the placeable devices of the given racks, known ones
 * in lifecycle order and any unknown ones after, alphabetically. Drives the
 * status legend + filter; mirrors collectSiteRoles in only counting devices that
 * actually render in the rack view (a real U position).
 */
export function collectStatuses(racks: SiteRack[]): string[] {
  const seen = new Set<string>()
  for (const rack of racks) {
    for (const d of rack.devices) {
      if (d.position == null) continue
      seen.add(d.status.toLowerCase())
    }
  }
  return [...seen].sort((a, b) => {
    const ai = (STATUS_ORDER as readonly string[]).indexOf(a)
    const bi = (STATUS_ORDER as readonly string[]).indexOf(b)
    const aKnown = ai !== -1
    const bKnown = bi !== -1
    if (aKnown && bKnown) return ai - bi
    if (aKnown !== bKnown) return aKnown ? -1 : 1
    return a.localeCompare(b)
  })
}
