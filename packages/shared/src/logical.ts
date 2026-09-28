import type { LldpNeighbor } from './lldp'
import { extractFrontRearPairs, buildCablePath, isInterfaceEnd, type TraceCable } from './cabletrace'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type LogicalLayer = 'physical' | 'isis' | 'ospf' | 'sr'

export type Tier = 'remote' | 'core' | 'spine' | 'leaf' | 'end'

export interface TopologyFact {
  layer: LogicalLayer
  device: string
  iface: string | null
  remote: string | null
  remoteIface: string | null
  up: boolean
  label: string
}

export interface TopologyCable {
  id: string
  a: { deviceName: string | null; name: string } | null
  b: { deviceName: string | null; name: string } | null
}

export interface CollectorTopology {
  facts: TopologyFact[]
  nodeSids: Record<string, number>
  circuits: TopologyCable[]
}

export interface GraphDevice {
  id: string
  name: string
  siteName: string
  roleName: string
  roleColor: string
}

export interface LogicalNode {
  id: string
  name: string
  tier: Tier
  siteName: string | null
  device: GraphDevice | null
  sid: number | null
}

export interface LayerState {
  up: number
  total: number
  label: string
}

export interface LogicalEdge {
  id: string
  a: string
  b: string
  layers: Partial<Record<LogicalLayer, LayerState>>
  members: TopologyCable[]
}

export interface LogicalGraph {
  nodes: LogicalNode[]
  edges: LogicalEdge[]
}

export interface GraphInput {
  devices: GraphDevice[]
  links: TopologyCable[]
  circuits: TopologyCable[]
  circuitSites: Record<string, [string, string]>
  lldp: Record<string, Record<string, LldpNeighbor[]>>
  topology?: CollectorTopology
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure functions
// ─────────────────────────────────────────────────────────────────────────────

/** Strip Junos unit suffix (e.g. `.0`, `.100`) from interface name. */
export function baseInterface(name: string): string {
  return name.replace(/\.\d+$/, '')
}

// IPv4 anywhere (unanchored word-bounded)
const IPV4_RE = /\b\d{1,3}(\.\d{1,3}){3}\b/

// IPv6: colon-separated hex (with :: compression), MAC: colon, dash, or dotted-quad-of-hex
const IPV6_OR_MAC_RE =
  // IPv6: contains :: or has multiple colon-separated hex groups
  /::[\da-f]*|[\da-f]+:[\da-f]*:[\da-f:]*|[\da-f]{2}(-[\da-f]{2}){5}|[\da-f]{2}(:[\da-f]{2}){5}|[\da-f]{4}(\.[\da-f]{4}){2}/i

/**
 * Return the name unchanged if it's safe to expose, or null if it contains
 * an IP address (v4 or v6) or MAC address pattern.
 */
export function safeName(v: string | null): string | null {
  if (v === null) return null
  if (IPV4_RE.test(v)) return null
  if (IPV6_OR_MAC_RE.test(v)) return null
  return v
}

// Tier classifier patterns (first match wins, case-insensitive)
const SPINE_RE = /spine/i
const LEAF_RE = /leaf|access|oob|switch|(^|[^a-z])tor([^a-z]|$)/i
const CORE_RE = /core|router|edge|border|firewall/i

/**
 * Classify a device role into a tier for logical graph layout.
 * First match wins (spine > leaf > core), then hasIgp implies core, else end.
 */
export function classifyTier(roleName: string, hasIgp: boolean): Exclude<Tier, 'remote'> {
  if (SPINE_RE.test(roleName)) return 'spine'
  if (LEAF_RE.test(roleName)) return 'leaf'
  if (CORE_RE.test(roleName)) return 'core'
  if (hasIgp) return 'core'
  return 'end'
}

/**
 * Derive interface-to-interface links from SoT cables, collapsing panel-routed paths.
 * Direct cables keep their original id. Panel-routed paths use the cable attached to
 * the lexicographically smaller endpoint (by deviceName then portName), making the id
 * deterministic and stable across input orderings.
 *
 * ponytail: O(n) scan per traced port in buildCablePath; index by port past ~10k cables
 */
export function sotLinks(cables: TraceCable[]): TopologyCable[] {
  const pairs = extractFrontRearPairs(cables)
  const links: TopologyCable[] = []
  const seen = new Set<string>()

  for (const cable of cables) {
    for (const end of [cable.a, cable.b]) {
      if (!end?.deviceName || !isInterfaceEnd(end)) continue

      const key = `${end.deviceName}\0${end.name}`
      if (seen.has(key)) continue

      const path = buildCablePath(cables, pairs, end.deviceName, end.name)
      if (!path?.complete) continue

      const firstHop = path.hops[0]
      const lastHop = path.hops[path.hops.length - 1]
      if (!firstHop || !lastHop) continue

      // Mark both ends as seen to avoid duplicates
      seen.add(`${firstHop.deviceName}\0${firstHop.portName}`)
      seen.add(`${lastHop.deviceName}\0${lastHop.portName}`)

      // Normalize: a < b lexicographically for deterministic id across input orderings
      const firstKey = `${firstHop.deviceName}\0${firstHop.portName}`
      const lastKey = `${lastHop.deviceName}\0${lastHop.portName}`
      const firstIsA = firstKey <= lastKey
      const aHop = firstIsA ? firstHop : lastHop
      const bHop = firstIsA ? lastHop : firstHop
      // id: cable attached to the canonical 'a' endpoint
      const id = firstIsA ? path.cableIds[0] : path.cableIds[path.cableIds.length - 1]
      if (!id) continue

      links.push({
        id,
        a: { deviceName: aHop.deviceName, name: aHop.portName },
        b: { deviceName: bHop.deviceName, name: bHop.portName },
      })
    }
  }

  return links
}

/**
 * Build a TopologyCable member from a resolved LLDP/collector observation.
 * id format: `lldp:<device>:<iface>`
 */
export function factCable(o: {
  device: string
  iface: string
  remote: string
  remoteIface: string
}): TopologyCable {
  return {
    id: `lldp:${o.device}:${o.iface}`,
    a: { deviceName: o.device, name: o.iface },
    b: { deviceName: o.remote, name: o.remoteIface },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// buildLogicalGraph implementation
// ─────────────────────────────────────────────────────────────────────────────

import { resolveRemote } from './lldpcables'
import { naturalCompare } from './layout'

/** Short lowercase hostname (first segment before dot). */
function short(h: string): string {
  return h.split('.')[0]!.toLowerCase()
}

/** Port table key: device|baseInterface(iface). */
function portKey(device: string, iface: string): string {
  return `${device}|${baseInterface(iface)}`
}

/** Edge id: `${a}~${b}` where a < b lexicographically. */
function edgeId(a: string, b: string): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`
}

interface PortOwner {
  edgeKey: string
  member: TopologyCable
}

interface EdgeBuilder {
  a: string
  b: string
  layers: Map<LogicalLayer, { up: number; total: number; labels: Set<string> }>
  members: TopologyCable[]
  memberIds: Set<string>
}

interface NameResolver {
  exactMap: Map<string, string>     // lowercase -> exact SoT name
  siteDevices: Map<string, string>  // short lowercase -> exact SoT name (within site)
  allDevices: Map<string, GraphDevice>
}

/** Build name resolution maps for a given site. */
function buildResolver(devices: GraphDevice[], site: string | null): NameResolver {
  const exactMap = new Map<string, string>()
  const siteDevices = new Map<string, string>()
  const allDevices = new Map<string, GraphDevice>()

  for (const d of devices) {
    const lower = d.name.toLowerCase()
    exactMap.set(lower, d.name)
    allDevices.set(d.name, d)
    if (site === null || d.siteName === site) {
      siteDevices.set(short(d.name), d.name)
    }
  }
  return { exactMap, siteDevices, allDevices }
}

/**
 * Resolve a hostname to an exact SoT device name, or an ext: id.
 * Resolution order: exact name, short-lowercase equality in site, resolveRemote suffix match.
 */
function resolveName(
  hostname: string | null,
  localDevice: string,
  resolver: NameResolver,
): string {
  if (!hostname || hostname.trim() === '') {
    return `ext:${localDevice}:${baseInterface('')}`
  }

  const lower = hostname.toLowerCase()

  // 1. Exact match (case-insensitive)
  const exact = resolver.exactMap.get(lower)
  if (exact) return exact

  // 2. Short-lowercase equality within site
  const shortName = short(hostname)
  const siteMatch = resolver.siteDevices.get(shortName)
  if (siteMatch) return siteMatch

  // 3. resolveRemote suffix match within site
  const suffixMatch = resolveRemote(hostname, Object.fromEntries(resolver.siteDevices))
  if (resolver.siteDevices.has(suffixMatch)) {
    return resolver.siteDevices.get(suffixMatch)!
  }

  // No hit: ext:<full lowercased name>
  return `ext:${lower}`
}

/** Resolve name for port context (includes port in ext: id when hostname is empty). */
function resolveNameWithPort(
  hostname: string | null,
  localDevice: string,
  localPort: string,
  resolver: NameResolver,
): string {
  if (!hostname || hostname.trim() === '') {
    return `ext:${localDevice}:${localPort}`
  }
  return resolveName(hostname, localDevice, resolver)
}

/** Add or update a layer on an edge builder. */
function addLayer(
  edge: EdgeBuilder,
  layer: LogicalLayer,
  up: boolean,
  label: string,
): void {
  let state = edge.layers.get(layer)
  if (!state) {
    state = { up: 0, total: 0, labels: new Set() }
    edge.layers.set(layer, state)
  }
  state.total++
  if (up) state.up++
  if (label) state.labels.add(label)
}

/** Get or create an edge builder. */
function getEdge(edges: Map<string, EdgeBuilder>, a: string, b: string): EdgeBuilder {
  const key = edgeId(a, b)
  let edge = edges.get(key)
  if (!edge) {
    edge = {
      a: a < b ? a : b,
      b: a < b ? b : a,
      layers: new Map(),
      members: [],
      memberIds: new Set(),
    }
    edges.set(key, edge)
  }
  return edge
}

/** Add a member to an edge if not already present. */
function addMember(edge: EdgeBuilder, member: TopologyCable): void {
  if (!edge.memberIds.has(member.id)) {
    edge.members.push(member)
    edge.memberIds.add(member.id)
  }
}

/**
 * Build a logical graph from SoT links, circuits, LLDP and collector facts.
 * Pure and deterministic: same input produces byte-for-byte identical output.
 */
export function buildLogicalGraph(input: GraphInput, site: string | null): LogicalGraph {
  const { devices, links, circuits, circuitSites, lldp, topology } = input
  const resolver = buildResolver(devices, site)

  // Port table: portKey -> PortOwner
  const portOwners = new Map<string, PortOwner>()
  // Edge builders keyed by edgeId
  const edges = new Map<string, EdgeBuilder>()
  // Track which nodes have edges
  const nodesWithEdges = new Set<string>()
  // Track which nodes have IGP layers
  const nodesWithIgp = new Set<string>()
  // Track circuit far ends (site: nodes)
  const circuitFarEnds = new Set<string>()

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1: Process SoT links (claim both port keys)
  // ─────────────────────────────────────────────────────────────────────────
  for (const link of links) {
    if (!link.a?.deviceName || !link.b?.deviceName) continue

    const aKey = portKey(link.a.deviceName, link.a.name)
    const bKey = portKey(link.b.deviceName, link.b.name)
    const ek = edgeId(link.a.deviceName, link.b.deviceName)

    const edge = getEdge(edges, link.a.deviceName, link.b.deviceName)
    addMember(edge, link)

    const owner: PortOwner = { edgeKey: ek, member: link }
    portOwners.set(aKey, owner)
    portOwners.set(bKey, owner)

    nodesWithEdges.add(link.a.deviceName)
    nodesWithEdges.add(link.b.deviceName)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2: Process circuits (member id is cid, far end -> site:<peer>)
  // ─────────────────────────────────────────────────────────────────────────
  for (const ckt of circuits) {
    if (!ckt.a?.deviceName) continue

    const localDevice = ckt.a.deviceName
    const localPort = ckt.a.name
    const aKey = portKey(localDevice, localPort)

    // Determine far end
    let remoteId: string
    if (ckt.b?.deviceName) {
      remoteId = ckt.b.deviceName
    } else {
      // Unknown far end: use circuitSites to find peer site
      const sitePair = circuitSites[ckt.id]
      if (sitePair) {
        const [siteA, siteZ] = sitePair
        // Use the local device's actual site, not the filter site
        const localDeviceSite = resolver.allDevices.get(localDevice)?.siteName
        const peerSite = siteA === localDeviceSite ? siteZ : siteA
        remoteId = `site:${peerSite}`
        circuitFarEnds.add(remoteId)
      } else {
        continue // Can't determine far end
      }
    }

    const ek = edgeId(localDevice, remoteId)
    const edge = getEdge(edges, localDevice, remoteId)
    addMember(edge, ckt)

    const owner: PortOwner = { edgeKey: ek, member: ckt }
    portOwners.set(aKey, owner)
    if (ckt.b?.deviceName) {
      const bKey = portKey(ckt.b.deviceName, ckt.b.name)
      portOwners.set(bKey, owner)
    }

    nodesWithEdges.add(localDevice)
    nodesWithEdges.add(remoteId)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3: Process observations (collector physical facts, then NAPALM LLDP)
  // Sort facts for determinism
  // ─────────────────────────────────────────────────────────────────────────
  const physicalFacts = (topology?.facts ?? [])
    .filter(f => f.layer === 'physical' && f.iface !== null)
    .sort((a, b) => naturalCompare(a.device, b.device) || naturalCompare(a.iface ?? '', b.iface ?? ''))

  for (const fact of physicalFacts) {
    const edge = processObservation(
      fact.device,
      fact.iface!,
      fact.remote,
      fact.remoteIface,
      resolver,
      portOwners,
      edges,
      nodesWithEdges,
    )
    // Add physical layer for collector physical facts
    if (edge) {
      addLayer(edge, 'physical', fact.up, fact.label)
    }
  }

  // Process NAPALM LLDP (sorted for determinism)
  const lldpDevices = Object.keys(lldp).sort(naturalCompare)
  for (const deviceName of lldpDevices) {
    const byIface = lldp[deviceName]!
    const ifaces = Object.keys(byIface).sort(naturalCompare)
    for (const ifaceName of ifaces) {
      const neighbors = byIface[ifaceName]!
      for (const neighbor of neighbors) {
        processObservation(
          deviceName,
          ifaceName,
          neighbor.hostname,
          neighbor.port,
          resolver,
          portOwners,
          edges,
          nodesWithEdges,
        )
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 4: Process IGP facts (isis, ospf)
  // ─────────────────────────────────────────────────────────────────────────
  const igpFacts = (topology?.facts ?? [])
    .filter(f => (f.layer === 'isis' || f.layer === 'ospf') && f.iface !== null)
    .sort((a, b) => naturalCompare(a.device, b.device) || naturalCompare(a.iface ?? '', b.iface ?? ''))

  for (const fact of igpFacts) {
    const aKey = portKey(fact.device, fact.iface!)
    const owner = portOwners.get(aKey)

    // When remote is null, use the port member's edge if it exists
    if (fact.remote === null) {
      if (owner) {
        const edge = edges.get(owner.edgeKey)!
        addLayer(edge, fact.layer, fact.up, fact.label)
        nodesWithIgp.add(fact.device)
        const [ownerA, ownerB] = owner.edgeKey.split('~')
        const otherNode = ownerA === fact.device ? ownerB : ownerA
        if (otherNode) nodesWithIgp.add(otherNode)
      }
      // No port owner: drop the fact
      continue
    }

    const resolvedRemote = resolveName(fact.remote, fact.device, resolver)
    if (resolvedRemote.startsWith('ext:')) {
      // Unresolved remote: drop the fact
      continue
    }

    // Determine edge: use port's member edge if remote matches, else create new edge
    let edge: EdgeBuilder
    if (owner) {
      const ownerEdgeKey = owner.edgeKey
      const [ownerA, ownerB] = ownerEdgeKey.split('~')
      if (ownerA === resolvedRemote || ownerB === resolvedRemote) {
        // IGP fact goes to same edge as port's member
        edge = edges.get(ownerEdgeKey)!
      } else {
        // IGP remote differs from port's member; own edge
        edge = getEdge(edges, fact.device, resolvedRemote)
        // Add igp: member only if edge has no physical member yet
        if (edge.members.length === 0) {
          const igpMember: TopologyCable = {
            id: `igp:${fact.device}:${fact.iface}`,
            a: { deviceName: fact.device, name: fact.iface! },
            b: { deviceName: resolvedRemote, name: fact.remoteIface ?? '' },
          }
          addMember(edge, igpMember)
        }
      }
    } else {
      // No port owner: check if edge to resolvedRemote already has physical members
      edge = getEdge(edges, fact.device, resolvedRemote)
      if (edge.members.length === 0) {
        const igpMember: TopologyCable = {
          id: `igp:${fact.device}:${fact.iface}`,
          a: { deviceName: fact.device, name: fact.iface! },
          b: { deviceName: resolvedRemote, name: fact.remoteIface ?? '' },
        }
        addMember(edge, igpMember)
      }
    }

    addLayer(edge, fact.layer, fact.up, fact.label)
    nodesWithEdges.add(fact.device)
    nodesWithEdges.add(resolvedRemote)
    nodesWithIgp.add(fact.device)
    nodesWithIgp.add(resolvedRemote)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 5: Process pair facts (sr, later bgp)
  // ─────────────────────────────────────────────────────────────────────────
  const pairFacts = (topology?.facts ?? [])
    .filter(f => f.iface === null)
    .sort((a, b) => naturalCompare(a.device, b.device) || naturalCompare(a.remote ?? '', b.remote ?? ''))

  for (const fact of pairFacts) {
    if (!fact.remote) continue
    const resolvedRemote = resolveName(fact.remote, fact.device, resolver)
    if (resolvedRemote.startsWith('ext:')) continue

    const edge = getEdge(edges, fact.device, resolvedRemote)
    addLayer(edge, fact.layer, fact.up, fact.label)
    nodesWithEdges.add(fact.device)
    nodesWithEdges.add(resolvedRemote)
    if (fact.layer === 'isis' || fact.layer === 'ospf') {
      nodesWithIgp.add(fact.device)
      nodesWithIgp.add(resolvedRemote)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 6: Build nodes
  // ─────────────────────────────────────────────────────────────────────────
  const nodeSids = topology?.nodeSids ?? {}
  const nodeMap = new Map<string, LogicalNode>()

  // Add all devices that have edges or are core/spine/leaf
  for (const d of devices) {
    const hasEdge = nodesWithEdges.has(d.name)
    const tier = classifyTier(d.roleName, nodesWithIgp.has(d.name))

    // In backbone mode (site === null), only include devices with inter-site edges
    if (site === null) {
      // Check if device has an inter-site edge
      let hasInterSite = false
      for (const edge of edges.values()) {
        if (edge.a === d.name || edge.b === d.name) {
          const otherNode = edge.a === d.name ? edge.b : edge.a
          const otherDevice = resolver.allDevices.get(otherNode)
          if (!otherDevice || otherDevice.siteName !== d.siteName) {
            hasInterSite = true
            break
          }
        }
      }
      if (!hasInterSite) continue
    } else {
      // Site mode: include if has edge or is infrastructure tier
      if (!hasEdge && tier === 'end') continue
      // Filter to site
      if (d.siteName !== site) {
        // Out-of-scope device: only include if it has edge
        if (!hasEdge) continue
      }
    }

    const sid = nodeSids[d.name] ?? null
    const nodeTier = d.siteName !== site ? 'remote' : tier

    nodeMap.set(d.name, {
      id: d.name,
      name: d.name,
      tier: nodeTier,
      siteName: d.siteName,
      device: d,
      sid,
    })
  }

  // Add ext: and site: nodes
  for (const nodeId of nodesWithEdges) {
    if (nodeMap.has(nodeId)) continue

    if (nodeId.startsWith('site:')) {
      const siteName = nodeId.slice(5)
      nodeMap.set(nodeId, {
        id: nodeId,
        name: siteName,
        tier: 'remote',
        siteName,
        device: null,
        sid: null,
      })
    } else if (nodeId.startsWith('ext:')) {
      const name = nodeId.slice(4)
      nodeMap.set(nodeId, {
        id: nodeId,
        name,
        tier: 'end',
        siteName: null,
        device: null,
        sid: null,
      })
    } else {
      // Known device from another site
      const d = resolver.allDevices.get(nodeId)
      if (d) {
        // In backbone mode (site === null), only include devices with inter-site edges
        if (site === null) {
          let hasInterSite = false
          for (const edge of edges.values()) {
            if (edge.a === nodeId || edge.b === nodeId) {
              const otherNode = edge.a === nodeId ? edge.b : edge.a
              const otherDevice = resolver.allDevices.get(otherNode)
              if (!otherDevice || otherDevice.siteName !== d.siteName) {
                hasInterSite = true
                break
              }
            }
          }
          if (!hasInterSite) continue
        }
        const hasIgp = nodesWithIgp.has(nodeId)
        const isCircuitEnd = circuitFarEnds.has(nodeId)
        // Out-of-scope: remote if known device elsewhere, circuit far end, or has IGP
        const tier: Tier = d.siteName !== site || hasIgp || isCircuitEnd ? 'remote' : 'end'
        nodeMap.set(nodeId, {
          id: nodeId,
          name: d.name,
          tier,
          siteName: d.siteName,
          device: d,
          sid: nodeSids[nodeId] ?? null,
        })
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 7: Build final graph (sorted for determinism)
  // Filter out empty edges (from observed-replaces-documented)
  // ─────────────────────────────────────────────────────────────────────────
  const nodes = [...nodeMap.values()].sort((a, b) => naturalCompare(a.id, b.id))

  const finalEdges: LogicalEdge[] = [...edges.values()]
    .filter(eb => eb.members.length > 0 || eb.layers.size > 0) // Keep edges with members or layers
    .map(eb => {
      const layers: Partial<Record<LogicalLayer, LayerState>> = {}
      for (const [layer, state] of eb.layers) {
        layers[layer] = {
          up: state.up,
          total: state.total,
          label: [...state.labels].sort().join(', '),
        }
      }
      return {
        id: edgeId(eb.a, eb.b),
        a: eb.a,
        b: eb.b,
        layers,
        members: eb.members.sort((a, b) => naturalCompare(a.id, b.id)),
      }
    })
    .sort((a, b) => naturalCompare(a.id, b.id))

  return { nodes, edges: finalEdges }
}

/**
 * Process a single observation (LLDP or collector physical fact).
 * Returns the edge created/updated, or null if the observation was dropped.
 *
 * Key rules from the design:
 * - Several neighbours on one port give one edge each (only when existing member goes elsewhere)
 * - Owning member joins same device pair → reuse, no new member
 * - Observed beats documented when both remotes are known devices and disagree
 * - Observed remote unresolved + member has known far device → member kept
 */
function processObservation(
  device: string,
  iface: string,
  remoteHostname: string | null,
  remotePort: string | null,
  resolver: NameResolver,
  portOwners: Map<string, PortOwner>,
  edges: Map<string, EdgeBuilder>,
  nodesWithEdges: Set<string>,
): EdgeBuilder | null {
  const resolvedRemote = resolveNameWithPort(remoteHostname, device, iface, resolver)
  const aKey = portKey(device, iface)
  const bKey = remotePort && !resolvedRemote.startsWith('ext:')
    ? portKey(resolvedRemote, remotePort)
    : null

  const existingA = portOwners.get(aKey)
  const existingB = bKey ? portOwners.get(bKey) : null

  // Check if port is already owned
  if (existingA || existingB) {
    const owner = existingA ?? existingB!
    const ownerEdgeKey = owner.edgeKey
    const [ownerA, ownerB] = ownerEdgeKey.split('~')
    const memberRemote = ownerA === device ? ownerB : ownerA

    // Same pair: reuse existing member, no new member added
    if (memberRemote === resolvedRemote) {
      const edge = edges.get(ownerEdgeKey)!
      return edge
    }

    // Different remote: check if we should replace or add
    // A member going to site: (circuit) or known device is considered "known"
    const memberRemoteIsKnown = memberRemote?.startsWith('site:') || resolver.allDevices.has(memberRemote ?? '')
    const observedRemoteIsKnown = !resolvedRemote.startsWith('ext:') && resolver.allDevices.has(resolvedRemote)

    if (memberRemoteIsKnown && observedRemoteIsKnown) {
      // Both known and different: observed wins, remove documented
      const edge = edges.get(ownerEdgeKey)
      if (edge) {
        const oldMemberIdx = edge.members.findIndex(m => m.id === owner.member.id)
        if (oldMemberIdx >= 0) {
          edge.members.splice(oldMemberIdx, 1)
          edge.memberIds.delete(owner.member.id)
        }
      }
      // Create new edge and member for the observed remote
      const newEdge = getEdge(edges, device, resolvedRemote)
      const newMember = factCable({
        device,
        iface,
        remote: resolvedRemote,
        remoteIface: remotePort ?? '',
      })
      addMember(newEdge, newMember)

      // Update port owners
      const newOwner: PortOwner = { edgeKey: edgeId(device, resolvedRemote), member: newMember }
      portOwners.set(aKey, newOwner)
      if (bKey) portOwners.set(bKey, newOwner)

      nodesWithEdges.add(device)
      nodesWithEdges.add(resolvedRemote)
      return newEdge
    } else if (!observedRemoteIsKnown && memberRemoteIsKnown) {
      // Observed unresolved, member has known device: keep documented
      const edge = edges.get(ownerEdgeKey)!
      return edge
    } else {
      // Multiple neighbors on one port to unknown remotes: each gets own edge
      // (but don't replace the port owner)
      const newEdge = getEdge(edges, device, resolvedRemote)
      const newMember = factCable({
        device,
        iface,
        remote: resolvedRemote,
        remoteIface: remotePort ?? '',
      })
      addMember(newEdge, newMember)
      nodesWithEdges.add(device)
      nodesWithEdges.add(resolvedRemote)
      return newEdge
    }
  }

  // No key owned: new factCable claims both keys
  const newEdge = getEdge(edges, device, resolvedRemote)
  const newMember = factCable({
    device,
    iface,
    remote: resolvedRemote,
    remoteIface: remotePort ?? '',
  })
  addMember(newEdge, newMember)

  const newOwner: PortOwner = { edgeKey: edgeId(device, resolvedRemote), member: newMember }
  portOwners.set(aKey, newOwner)
  if (bKey) portOwners.set(bKey, newOwner)

  nodesWithEdges.add(device)
  nodesWithEdges.add(resolvedRemote)

  return newEdge
}
