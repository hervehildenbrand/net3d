// NetBox 4.0 swapped Graphene for Strawberry, which changed how list queries are
// filtered: `rack_list(site: "x")` became `rack_list(filters: {site: {name: {exact: "x"}}})`.
// Unfiltered list queries (site_list, circuit_list) are unaffected. The field
// selections below are identical across versions — only the filter clause differs.

export type NetBoxMajor = 3 | 4

/** Major version driving the GraphQL dialect. Defaults to 3 (the existing instance). */
export function parseNetBoxMajor(version: string | null | undefined): NetBoxMajor {
  if (!version) return 3
  const m = /(\d+)/.exec(version)
  if (!m) return 3
  return Number(m[1]) >= 4 ? 4 : 3
}

/** `list(...)` filter clause for a single site name, per dialect. */
function siteFilter(site: string, version: NetBoxMajor): string {
  return version >= 4 ? `filters: {site: {name: {exact: "${site}"}}}` : `site: "${site}"`
}

export function siteRacksQuery(site: string, version: NetBoxMajor): string {
  return `{
  rack_list(${siteFilter(site, version)}) {
    id
    name
    u_height
    location { name }
    devices {
      id
      name
      position
      face
      status
      serial
      asset_tag
      description
      platform { name }
      primary_ip4 { address }
      oob_ip { address }
      role { name color }
      device_type { u_height model is_full_depth manufacturer { name } custom_fields }
    }
  }
}`
}

const DEVICE_TERM = `name device { name rack { name } }`
// Note: CircuitTerminationType.site exists in 3.7 but was removed in 4.x (scope).
// cables.ts only needs circuit.cid, so we never select site here — valid on both.
const TERMINATION_FRAGMENTS = `__typename
      ... on InterfaceType { ${DEVICE_TERM} }
      ... on FrontPortType { ${DEVICE_TERM} }
      ... on RearPortType { ${DEVICE_TERM} }
      ... on ConsolePortType { ${DEVICE_TERM} }
      ... on ConsoleServerPortType { ${DEVICE_TERM} }
      ... on PowerPortType { ${DEVICE_TERM} }
      ... on PowerOutletType { ${DEVICE_TERM} }
      ... on PowerFeedType { name rack { name } }
      ... on CircuitTerminationType { circuit { cid } }`

export interface CablePage {
  offset: number
  limit: number
}

// CableFilter has no direct site field in 4.x; filter via the termination's site.
// That matches once per termination (twice for an intra-site cable) and caps at
// 1000 rows, so DISTINCT is required to return unique, complete cables — and any
// site with >1000 cables must be fetched page by page (OffsetPaginationInput).
function cableFilter(site: string, version: NetBoxMajor, page?: CablePage): string {
  if (version < 4) return `site: "${site}"`
  const filters = `filters: {terminations: {site: {name: {exact: "${site}"}}}, DISTINCT: true}`
  return page ? `${filters}, pagination: {offset: ${page.offset}, limit: ${page.limit}}` : filters
}

export function siteCablesQuery(site: string, version: NetBoxMajor, page?: CablePage): string {
  return `{
  cable_list(${cableFilter(site, version, page)}) {
    id
    type
    status
    color
    a_terminations {
      ${TERMINATION_FRAGMENTS}
    }
    b_terminations {
      ${TERMINATION_FRAGMENTS}
    }
  }
}`
}

// Power panels filter by their own site; feeds have no direct site, so they
// filter via their panel's site. Field selections are identical across dialects.
export function sitePowerQuery(site: string, version: NetBoxMajor): string {
  const panelFilter = version >= 4 ? `filters: {site: {name: {exact: "${site}"}}}` : `site: "${site}"`
  const feedFilter =
    version >= 4 ? `filters: {power_panel: {site: {name: {exact: "${site}"}}}}` : `site: "${site}"`
  return `{
  power_panel_list(${panelFilter}) {
    id
    name
    location { name }
  }
  power_feed_list(${feedFilter}) {
    id
    name
    status
    voltage
    amperage
    phase
    supply
    type
    max_utilization
    power_panel { name }
    rack { name }
  }
}`
}

// circuit_list itself isn't filtered, but the per-termination site field moved:
// 3.7 exposes `site` directly; 4.x exposes it via the `termination` scope union.
export function circuitsQuery(version: NetBoxMajor): string {
  const termSite =
    version >= 4
      ? `termination { __typename ... on SiteType { name } }`
      : `site { name }`
  return `{
  circuit_list {
    id
    cid
    status
    commit_rate
    description
    provider { name }
    terminations { term_side ${termSite} }
  }
}`
}
