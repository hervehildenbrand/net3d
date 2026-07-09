import type { Site } from '../hooks/useSites'

/** Group label for sites whose backend has no region set. */
export const NO_REGION = '(no region)'

/** Group sites by region; regions alphabetical (NO_REGION last), sites alphabetical within. */
export function groupSitesByRegion(sites: Site[]): Map<string, Site[]> {
  const groups = new Map<string, Site[]>()
  for (const s of sites) {
    const key = s.region ?? NO_REGION
    const arr = groups.get(key)
    if (arr) arr.push(s)
    else groups.set(key, [s])
  }
  const keys = [...groups.keys()].sort((a, b) =>
    a === NO_REGION ? 1 : b === NO_REGION ? -1 : a.localeCompare(b),
  )
  const sorted = new Map<string, Site[]>()
  for (const k of keys)
    sorted.set(k, groups.get(k)!.sort((a, b) => a.name.localeCompare(b.name)))
  return sorted
}
