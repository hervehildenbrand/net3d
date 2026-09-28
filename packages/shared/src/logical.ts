import type { LldpNeighbor } from './lldp'

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
