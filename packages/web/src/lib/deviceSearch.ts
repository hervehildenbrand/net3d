/**
 * One searchable device, flattened out of its rack and tagged with its
 * location. Mirrors the server's DeviceIndexEntry (GET /api/devices) and is the
 * shape both the search dropdown and the staged zoom-to-device navigation work
 * with. Backend-agnostic — identical for NetBox and Infrahub.
 */
export interface DeviceIndexEntry {
  id: string
  name: string
  siteName: string
  rackId: string
  rackName: string
  position: number | null
  roleName: string
  roleColor: string
  model: string
  status: string
}

// Higher = better match. Name hits beat context (site/rack/role/model) hits so
// that typing a device name surfaces that device first; within name hits,
// exact > prefix > substring.
function scoreMatch(d: DeviceIndexEntry, q: string): number {
  const name = d.name.toLowerCase()
  if (name === q) return 4
  if (name.startsWith(q)) return 3
  if (name.includes(q)) return 2
  if (
    d.siteName.toLowerCase().includes(q) ||
    d.rackName.toLowerCase().includes(q) ||
    d.roleName.toLowerCase().includes(q) ||
    d.model.toLowerCase().includes(q)
  ) {
    return 1
  }
  return 0
}

/**
 * Rank devices for the autocomplete dropdown. Empty/whitespace query returns
 * nothing (the index can be thousands of devices — don't dump it). Matches are
 * case-insensitive across name + site/rack/role/model, ranked by match quality
 * then name, and capped at `limit`.
 */
export function filterDevices(
  devices: DeviceIndexEntry[],
  query: string,
  limit = 12,
): DeviceIndexEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return devices
    .map((d) => ({ d, score: scoreMatch(d, q) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.d.name.localeCompare(b.d.name))
    .slice(0, limit)
    .map((m) => m.d)
}
