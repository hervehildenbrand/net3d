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
      role { name color }
      device_type { u_height model is_full_depth manufacturer { name } }
    }
  }
}`
}

const DEVICE_TERM = `name device { name rack { name } }`
const TERMINATION_FRAGMENTS = `__typename
      ... on InterfaceType { ${DEVICE_TERM} }
      ... on FrontPortType { ${DEVICE_TERM} }
      ... on RearPortType { ${DEVICE_TERM} }
      ... on ConsolePortType { ${DEVICE_TERM} }
      ... on ConsoleServerPortType { ${DEVICE_TERM} }
      ... on PowerPortType { ${DEVICE_TERM} }
      ... on PowerOutletType { ${DEVICE_TERM} }
      ... on PowerFeedType { name rack { name } }
      ... on CircuitTerminationType { circuit { cid } site { name } }`

export function siteCablesQuery(site: string, version: NetBoxMajor): string {
  return `{
  cable_list(${siteFilter(site, version)}) {
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
