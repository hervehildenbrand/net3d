/**
 * Server-side topology join: resolves system-ids and router-ids to device names
 * and emits flat TopologyFact[]. No id, chassis or IP ever leaves this module.
 */
import { baseInterface, safeName, type TopologyFact, type TopologyCable, type CollectorTopology } from '@net3d/shared'

// ─────────────────────────────────────────────────────────────────────────────
// Collector DTO types (private to this module)
// ─────────────────────────────────────────────────────────────────────────────

interface LinkEndDTO {
  device: string | null
  interface: string | null
  chassis_id: string | null
  port_id: string | null
  system_name: string | null
}

interface LinkDTO {
  a: LinkEndDTO
  b: LinkEndDTO
  state: 'PRESENT' | 'REMOVED'
  confirmed: boolean
}

interface IsisAdjacencyDTO {
  device: string
  interface: string
  level: number
  system_id: string
  state: string
  neighbor_hostname: string | null
  telemetry_state: string
}

interface IsisLsdbSourceDTO {
  device: string
  telemetry_state: string
}

interface PrefixSidDTO {
  prefix: string
  index: number
  label: number | null
  flags: string[]
  algorithm: number
}

interface AdjSidDTO {
  value: number
  label: number | null
  flags: string[]
  weight: number
}

interface IsisLsdbNodeDTO {
  level: number
  system_id: string
  hostname: string | null
  router_id: string | null
  srgb: { base: number; range: number }[]
  prefix_sids: PrefixSidDTO[]
}

interface IsisLsdbLinkEndDTO {
  system_id: string
  hostname: string | null
  metric: number | null
  adj_sids: AdjSidDTO[]
}

interface IsisLsdbLinkDTO {
  level: number
  two_way: boolean
  a: IsisLsdbLinkEndDTO
  b: IsisLsdbLinkEndDTO
}

interface IsisTopologyDTO {
  sources: IsisLsdbSourceDTO[]
  nodes: IsisLsdbNodeDTO[]
  links: IsisLsdbLinkDTO[]
}

interface OspfAdjacencyDTO {
  device: string
  interface: string
  area: string
  neighbor_router_id: string
  state: string
  telemetry_state: string
}

export interface RawTopologyData {
  links: LinkDTO[]
  isisAdjacencies: IsisAdjacencyDTO[]
  isisTopology: IsisTopologyDTO
  ospfAdjacencies: OspfAdjacencyDTO[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Id map for system-id -> device name resolution
// ─────────────────────────────────────────────────────────────────────────────

interface IdMapEntry {
  candidates: Set<string>
}

function buildIdMap(
  links: LinkDTO[],
  isisAdjacencies: IsisAdjacencyDTO[],
  lsdbNodes: IsisLsdbNodeDTO[],
  lsdbLive: boolean,
): Map<string, IdMapEntry> {
  const idMap = new Map<string, IdMapEntry>()

  const addCandidate = (systemId: string, deviceName: string) => {
    let entry = idMap.get(systemId)
    if (!entry) {
      entry = { candidates: new Set() }
      idMap.set(systemId, entry)
    }
    entry.candidates.add(deviceName)
  }

  // Build indices for LLDP coincidence check
  // linkIndex: (device, baseIface) -> array of links on that port
  const linkIndex = new Map<string, LinkDTO[]>()
  for (const link of links) {
    if (link.state !== 'PRESENT') continue
    if (link.a.device) {
      const key = `${link.a.device}|${baseInterface(link.a.interface ?? '')}`
      const arr = linkIndex.get(key) ?? []
      arr.push(link)
      linkIndex.set(key, arr)
    }
    if (link.b.device) {
      const key = `${link.b.device}|${baseInterface(link.b.interface ?? '')}`
      const arr = linkIndex.get(key) ?? []
      arr.push(link)
      linkIndex.set(key, arr)
    }
  }

  // adjIndex: (device, baseIface) -> array of neighbour system_ids
  const adjIndex = new Map<string, Set<string>>()
  for (const adj of isisAdjacencies) {
    const key = `${adj.device}|${baseInterface(adj.interface)}`
    const set = adjIndex.get(key) ?? new Set()
    set.add(adj.system_id)
    adjIndex.set(key, set)
  }

  // LLDP coincidence: for each adjacency, check if port has exactly one PRESENT link
  // with a monitored far end, exactly one distinct neighbour id across its units,
  // and the far port carries an adjacency itself.
  for (const adj of isisAdjacencies) {
    const portKey = `${adj.device}|${baseInterface(adj.interface)}`
    const linksOnPort = linkIndex.get(portKey) ?? []
    const monitoredLinks = linksOnPort.filter(l => {
      // Find the "other" end of the link from this device's perspective
      if (l.a.device === adj.device) return l.b.device !== null
      if (l.b.device === adj.device) return l.a.device !== null
      return false
    })

    // Exactly one PRESENT link with a monitored far end
    if (monitoredLinks.length !== 1) continue

    // Exactly one distinct neighbour id across all units of this base interface
    const neighbourIds = adjIndex.get(portKey)
    if (!neighbourIds || neighbourIds.size !== 1) continue

    const link = monitoredLinks[0]!
    // Find the far end and check it carries an adjacency
    const isASide = link.a.device === adj.device
    const farDevice = isASide ? link.b.device : link.a.device
    const farIface = isASide ? link.b.interface : link.a.interface
    if (!farDevice || !farIface) continue

    const farPortKey = `${farDevice}|${baseInterface(farIface)}`
    const farAdjs = adjIndex.get(farPortKey)
    if (!farAdjs || farAdjs.size === 0) continue

    // LLDP coincidence holds: add candidate
    addCandidate(adj.system_id, farDevice)
  }

  // LSDB hostname resolution (only when live)
  if (lsdbLive) {
    for (const node of lsdbNodes) {
      if (node.hostname) {
        addCandidate(node.system_id, node.hostname)
      }
    }
  }

  // ponytail: no address join — neighbour addresses are not matched to devices;
  // add it for LLDP-less links once the LSDB is on.

  return idMap
}

function resolveSystemId(systemId: string, idMap: Map<string, IdMapEntry>): string | null {
  const entry = idMap.get(systemId)
  if (!entry) return null
  if (entry.candidates.size !== 1) return null // conflict
  return [...entry.candidates][0]!
}

// ─────────────────────────────────────────────────────────────────────────────
// Far-end name resolution for unmonitored LLDP neighbours
// ─────────────────────────────────────────────────────────────────────────────

function farName(
  systemName: string | null,
  chassisId: string | null,
  chassisToName: Map<string, string>,
  nameCounts: Map<string, number>,
): string {
  const name = safeName(systemName) ?? 'unnamed'
  if (!chassisId) return name

  const chassisKey = chassisId.toLowerCase()

  // If this chassis was seen before, return its assigned name
  const existing = chassisToName.get(chassisKey)
  if (existing !== undefined) return existing

  // New chassis: assign a name (first occurrence gets no suffix, subsequent get #2, #3, ...)
  const count = nameCounts.get(name) ?? 0
  nameCounts.set(name, count + 1)
  const assignedName = count === 0 ? name : `${name}#${count + 1}`
  chassisToName.set(chassisKey, assignedName)
  return assignedName
}

// ─────────────────────────────────────────────────────────────────────────────
// Main join
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Join collector LLDP, IS-IS, OSPF and SR data into flat TopologyFacts.
 * Returns { facts, nodeSids } (circuits is added by Task 5's scopeTopology).
 */
export function resolveTopology(raw: RawTopologyData): Pick<CollectorTopology, 'facts' | 'nodeSids'> {
  const facts: TopologyFact[] = []
  const nodeSids: Record<string, number> = {}

  const { links, isisAdjacencies, isisTopology, ospfAdjacencies } = raw
  const lsdbLive = isisTopology.sources.some(s => s.telemetry_state === 'LIVE')

  // Build id map for system-id resolution
  const idMap = buildIdMap(links, isisAdjacencies, isisTopology.nodes, lsdbLive)

  // Track chassis ids for distinct far-end naming
  // Sort links by (a.device, a.interface, chassis_id) for deterministic ordering
  const sortedLinks = [...links]
    .filter(l => l.state === 'PRESENT')
    .sort((x, y) => {
      const ax = `${x.a.device ?? ''}|${x.a.interface ?? ''}|${x.b.chassis_id ?? ''}`
      const bx = `${y.a.device ?? ''}|${y.a.interface ?? ''}|${y.b.chassis_id ?? ''}`
      return ax.localeCompare(bx)
    })

  // Maps for tracking distinct chassis with same system_name
  const chassisToName = new Map<string, string>()
  const nameCounts = new Map<string, number>()

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1: Physical links from collector /links
  // ─────────────────────────────────────────────────────────────────────────
  for (const link of sortedLinks) {
    // Emit from a side
    if (link.a.device && link.a.interface) {
      let remote: string | null
      let remoteIface: string | null

      if (link.b.device) {
        remote = link.b.device
        remoteIface = link.b.interface
      } else {
        remote = farName(link.b.system_name, link.b.chassis_id, chassisToName, nameCounts)
        remoteIface = safeName(link.b.port_id)
      }

      facts.push({
        layer: 'physical',
        device: link.a.device,
        iface: link.a.interface,
        remote,
        remoteIface,
        up: true, // PRESENT -> up
        label: '',
      })
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2: IS-IS adjacencies
  // ─────────────────────────────────────────────────────────────────────────
  for (const adj of isisAdjacencies) {
    if (adj.state === 'REMOVED') continue

    const remote = resolveSystemId(adj.system_id, idMap)
    const up = adj.state === 'UP' && adj.telemetry_state !== 'STALE'
    const level = `L${adj.level}`
    let label = `${level} ${adj.state}`
    if (adj.telemetry_state === 'STALE') {
      label += ' stale'
    }

    facts.push({
      layer: 'isis',
      device: adj.device,
      iface: adj.interface,
      remote,
      remoteIface: null,
      up,
      label,
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3: LSDB (SR) - only when a source is LIVE
  // ─────────────────────────────────────────────────────────────────────────
  if (lsdbLive) {
    // Node SIDs: NODE prefix SID, algorithm 0, lowest prefix, non-null label
    for (const node of isisTopology.nodes) {
      const hostname = node.hostname
      if (!hostname) continue

      const nodePrefixSid = node.prefix_sids
        .filter(ps => ps.flags.includes('NODE') && ps.algorithm === 0 && ps.label !== null)
        .sort((a, b) => a.prefix.localeCompare(b.prefix))[0]

      if (nodePrefixSid?.label !== null && nodePrefixSid !== undefined) {
        nodeSids[hostname] = nodePrefixSid.label!
      }
    }

    // SR pair facts: one per device pair (L2 preferred)
    // Group LSDB links by device pair
    const pairFacts = new Map<string, { a: string; b: string; adjSidA: number; adjSidB: number; level: number }>()

    for (const link of isisTopology.links) {
      const aHostname = link.a.hostname
      const bHostname = link.b.hostname
      if (!aHostname || !bHostname) continue

      const pairKey = aHostname < bHostname ? `${aHostname}~${bHostname}` : `${bHostname}~${aHostname}`
      const existing = pairFacts.get(pairKey)

      // L2 preferred over L1
      if (existing && existing.level >= link.level) continue

      // Get adj-SIDs (label ?? value)
      const aAdjSid = link.a.adj_sids?.[0]
      const bAdjSid = link.b.adj_sids?.[0]
      const adjSidA = aAdjSid?.label ?? aAdjSid?.value ?? 0
      const adjSidB = bAdjSid?.label ?? bAdjSid?.value ?? 0

      pairFacts.set(pairKey, {
        a: aHostname < bHostname ? aHostname : bHostname,
        b: aHostname < bHostname ? bHostname : aHostname,
        adjSidA: aHostname < bHostname ? adjSidA : adjSidB,
        adjSidB: aHostname < bHostname ? adjSidB : adjSidA,
        level: link.level,
      })
    }

    for (const pair of pairFacts.values()) {
      facts.push({
        layer: 'sr',
        device: pair.a,
        iface: null,
        remote: pair.b,
        remoteIface: null,
        up: true,
        label: `adj-SID ${pair.adjSidA}/${pair.adjSidB}`,
      })
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 4: OSPF adjacencies
  // ─────────────────────────────────────────────────────────────────────────
  for (const adj of ospfAdjacencies) {
    if (adj.state === 'REMOVED') continue

    // OSPF has no hostname - remote stays unresolved (null)
    const remote: string | null = null
    const up = (adj.state === 'FULL' || adj.state === 'TWO_WAY') && adj.telemetry_state !== 'STALE'

    // Convert dotted-quad area to integer
    let areaLabel: string
    if (adj.area.includes('.')) {
      // Dotted-quad format: "0.0.0.33" -> 33
      const parts = adj.area.split('.').map(p => parseInt(p, 10))
      const areaInt = parts.reduce((acc, p) => acc * 256 + p, 0)
      areaLabel = String(areaInt)
    } else {
      areaLabel = adj.area
    }

    let label = `area ${areaLabel} ${adj.state}`
    if (adj.telemetry_state === 'STALE') {
      label += ' stale'
    }

    facts.push({
      layer: 'ospf',
      device: adj.device,
      iface: adj.interface,
      remote,
      remoteIface: null,
      up,
      label,
    })
  }

  // Sort facts for deterministic output (constraint: pure functions are deterministic)
  facts.sort((a, b) => {
    const ka = `${a.layer}|${a.device}|${a.iface ?? ''}|${a.remote ?? ''}|${a.remoteIface ?? ''}`
    const kb = `${b.layer}|${b.device}|${b.iface ?? ''}|${b.remote ?? ''}|${b.remoteIface ?? ''}`
    return ka.localeCompare(kb)
  })

  return { facts, nodeSids }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoping: filter topology to site or backbone
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scope topology facts and circuits for a site or backbone view.
 * - site (non-null): keep facts where device OR remote is in the site, plus
 *   circuits with an end in the site.
 * - backbone (site === null): keep facts where both ends are known devices in
 *   DIFFERENT sites, plus all circuits.
 */
export function scopeTopology(
  topology: Pick<CollectorTopology, 'facts' | 'nodeSids'>,
  circuits: TopologyCable[],
  deviceSite: Record<string, string>,
  site: string | null,
): CollectorTopology {
  const { facts, nodeSids } = topology

  let scopedFacts: TopologyFact[]
  let scopedCircuits: TopologyCable[]
  const scopedSids: Record<string, number> = {}

  if (site !== null) {
    // Site scope: keep facts touching the site
    scopedFacts = facts.filter(f => {
      const deviceInSite = deviceSite[f.device] === site
      const remoteInSite = f.remote !== null && deviceSite[f.remote] === site
      return deviceInSite || remoteInSite
    })

    // Circuits with an end in the site
    scopedCircuits = circuits.filter(c => {
      const aInSite = c.a?.deviceName && deviceSite[c.a.deviceName] === site
      const bInSite = c.b?.deviceName && deviceSite[c.b.deviceName] === site
      return aInSite || bInSite
    })

    // nodeSids for devices in facts
    for (const f of scopedFacts) {
      if (nodeSids[f.device] !== undefined) {
        scopedSids[f.device] = nodeSids[f.device]!
      }
      if (f.remote && nodeSids[f.remote] !== undefined) {
        scopedSids[f.remote] = nodeSids[f.remote]!
      }
    }
  } else {
    // Backbone scope: keep facts where both ends are known and in different sites
    scopedFacts = facts.filter(f => {
      if (f.remote === null) return false
      const deviceSiteName = deviceSite[f.device]
      const remoteSiteName = deviceSite[f.remote]
      // Both must be known and in different sites
      return deviceSiteName !== undefined && remoteSiteName !== undefined && deviceSiteName !== remoteSiteName
    })

    // All circuits for backbone
    scopedCircuits = circuits

    // nodeSids for inter-site devices
    for (const f of scopedFacts) {
      if (nodeSids[f.device] !== undefined) {
        scopedSids[f.device] = nodeSids[f.device]!
      }
      if (f.remote && nodeSids[f.remote] !== undefined) {
        scopedSids[f.remote] = nodeSids[f.remote]!
      }
    }
  }

  return { facts: scopedFacts, nodeSids: scopedSids, circuits: scopedCircuits }
}
