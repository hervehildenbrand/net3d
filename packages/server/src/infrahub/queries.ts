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

// Cables carry no site of their own; we resolve each end's device->site and filter
// client-side. For the showcase subset this fetches all cables in one query.
export const CABLES_QUERY = `
query {
  DcimCable {
    edges { node {
      id
      cable_type { value }
      status { value }
      color { value }
      endpoint_a { node {${ENDPOINT_NODE}
      } }
      endpoint_b { node {${ENDPOINT_NODE}
      } }
    } }
  }
}`

export function sitePowerQuery(site: string): string {
  return `
query {
  DcimPowerPanel(site__name__value: "${site}") {
    edges { node {
      id
      name { value }
      location { value }
    } }
  }
  DcimPowerFeed(rack__site__name__value: "${site}") {
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
