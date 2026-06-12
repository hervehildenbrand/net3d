export interface SiteCircuit {
  id: string
  cid: string
  provider: string | null
  siteA: string
  siteZ: string
  /** Committed data rate in Kbps (NetBox commit_rate); null when undocumented. */
  commitRate: number | null
  status: string
  description: string | null
}

export interface CircuitGroup {
  /** Alphabetically first site of the pair. */
  siteA: string
  siteZ: string
  count: number
  circuitIds: string[]
  /** Member circuits, for per-circuit tooltips. */
  circuits: SiteCircuit[]
  /** Highest commit rate (Kbps) of the pair; drives arc width. */
  maxCommitRate: number | null
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
      g = { siteA, siteZ, count: 0, circuitIds: [], circuits: [], maxCommitRate: null }
      groups.set(key, g)
    }
    g.count++
    g.circuitIds.push(c.id)
    g.circuits.push(c)
    if (c.commitRate !== null && (g.maxCommitRate === null || c.commitRate > g.maxCommitRate)) {
      g.maxCommitRate = c.commitRate
    }
  }
  return [...groups.values()]
}
