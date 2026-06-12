export interface SiteCircuit {
  id: string
  cid: string
  provider: string | null
  siteA: string
  siteZ: string
}

export interface CircuitGroup {
  /** Alphabetically first site of the pair. */
  siteA: string
  siteZ: string
  count: number
  circuitIds: string[]
}

/** Aggregate circuits into undirected site pairs; same-site circuits are dropped. */
export function groupCircuitsBySitePair(circuits: SiteCircuit[]): CircuitGroup[] {
  const groups = new Map<string, CircuitGroup>()
  for (const c of circuits) {
    if (c.siteA === c.siteZ) continue
    const [siteA, siteZ] = c.siteA < c.siteZ ? [c.siteA, c.siteZ] : [c.siteZ, c.siteA]
    const key = `${siteA}|${siteZ}`
    let g = groups.get(key)
    if (!g) {
      g = { siteA, siteZ, count: 0, circuitIds: [] }
      groups.set(key, g)
    }
    g.count++
    g.circuitIds.push(c.id)
  }
  return [...groups.values()]
}
