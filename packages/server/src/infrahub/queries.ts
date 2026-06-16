// GraphQL queries against the net3d Infrahub DCIM schema (showcase/infrahub/schema).
// Infrahub wraps attributes as `{ value }`, cardinality-many relationships as
// `{ edges { node } }`, cardinality-one as `{ node }`, and exposes `count` on every
// node query. Kinds are namespaced (DcimSite, CircuitCircuit, ...).

export const SITES_QUERY = `
query {
  DcimSite {
    edges { node {
      id
      name { value }
      latitude { value }
      longitude { value }
      region { value }
      status { value }
      physical_address { value }
      facility { value }
      role { value }
      racks { count }
      devices { count }
    } }
  }
}`

// Device sub-selection reused by the per-rack query.
const DEVICE_NODE = `
  id
  name { value }
  position { value }
  face { value }
  status { value }
  serial { value }
  asset_tag { value }
  description { value }
  primary_ip { value }
  oob_ip { value }
  role { node { name { value } color { value } } }
  platform { node { name { value } } }
  device_type { node {
    model { value }
    u_height { value }
    is_full_depth { value }
    cpu_model { value }
    cpu_cores { value }
    ram_gb { value }
    storage_tb { value }
    manufacturer { node { name { value } } }
  } }`

export function siteRacksQuery(site: string): string {
  return `
query {
  DcimRack(site__name__value: "${site}") {
    edges { node {
      id
      name { value }
      u_height { value }
      location { value }
      devices { edges { node {${DEVICE_NODE}
      } } }
    } }
  }
}`
}

// Endpoint sub-selection: a cable end is an interface (device) or a circuit endpoint.
const ENDPOINT_NODE = `
  __typename
  ... on DcimInterface {
    name { value }
    device { node { name { value }
      site { node { name { value } } }
      rack { node { name { value } } }
    } }
  }
  ... on CircuitEndpoint {
    name { value }
    circuit { node { cid { value } } }
  }`

// A cable's queryable fields (id, attrs, both endpoints).
const CABLE_NODE = `
      id
      cable_type { value }
      status { value }
      color { value }
      endpoint_a { node {${ENDPOINT_NODE}
      } }
      endpoint_b { node {${ENDPOINT_NODE}
      } }`

// All interface ids belonging to a site's devices. `site__name__value` is a valid
// single-hop filter on Device, and the nested interface list returns in full — so
// this scopes the cable fetch without scanning every cable in the instance.
export function siteInterfaceIdsQuery(site: string): string {
  return `
query {
  DcimDevice(site__name__value: "${site}") {
    edges { node { interfaces { edges { node { id } } } } }
  }
}`
}

// Cables whose endpoint_a (or endpoint_b) is one of the given interface ids. Cables
// can't be filtered by site directly (cable->endpoint->device->site is multi-hop),
// but `endpoint_a__ids` / `endpoint_b__ids` are valid single-hop relationship filters.
export function cablesByEndpointQuery(side: 'endpoint_a' | 'endpoint_b', ids: string[]): string {
  const idList = ids.map((id) => `"${id}"`).join(', ')
  return `
query {
  DcimCable(${side}__ids: [${idList}]) {
    edges { node {${CABLE_NODE}
    } }
  }
}`
}

// Panels filter directly by site. Feeds can't be filtered by rack->site (Infrahub
// only generates single-hop relationship filters), so getSitePower resolves the
// site's panel ids first and filters feeds by power_panel__ids.
export function sitePanelsQuery(site: string): string {
  return `
query {
  DcimPowerPanel(site__name__value: "${site}") {
    edges { node {
      id
      name { value }
      location { value }
    } }
  }
}`
}

export function feedsByPanelsQuery(panelIds: string[]): string {
  const ids = panelIds.map((id) => `"${id}"`).join(', ')
  return `
query {
  DcimPowerFeed(power_panel__ids: [${ids}]) {
    edges { node {
      id
      name { value }
      status { value }
      voltage { value }
      amperage { value }
      phase { value }
      supply { value }
      feed_type { value }
      max_utilization { value }
      power_panel { node { name { value } } }
      rack { node { name { value } } }
    } }
  }
}`
}

export const CIRCUITS_QUERY = `
query {
  CircuitCircuit {
    edges { node {
      id
      cid { value }
      status { value }
      commit_rate { value }
      description { value }
      provider { node { name { value } } }
      endpoints { edges { node {
        term_side { value }
        site { node { name { value } } }
      } } }
    } }
  }
}`
