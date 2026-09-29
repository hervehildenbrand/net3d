# Live telemetry: the collector contract

net3d can colour cables, map circuit arcs and room DC links by live utilisation, and
show per-port rates in the device panel. The rates come from a **telemetry collector**
that the net3d **server** polls over HTTP. The feature is optional: without a
collector, net3d looks and behaves as if the feature did not exist.

This page is the whole contract. net3d reads two endpoints, a list of device names and
five fields per interface, so any collector that serves them works.

## Turning it on

| Variable | Meaning |
|---|---|
| `NETSTATEX_URL` | Collector base URL, e.g. `http://collector:8090`. net3d appends `/api/v1/...`; surrounding spaces and a trailing `/` are ignored. Unset or blank = off. Any other value turns the feature on and is not validated: a wrong or unreachable URL makes the telemetry routes answer `503`, it does not stop net3d from starting. |
| `NETSTATEX_TOKEN` | Optional. Sent as `Authorization: Bearer <token>` on every collector request. Surrounding spaces are trimmed; blank = no header. Ignored when `NETSTATEX_URL` is unset. |

The variable names come from netstatex, the collector net3d was built against; they
work with any collector.

With `NETSTATEX_URL` set, `GET /api/meta` includes `"telemetryAvailable": true` and the
Layers panel offers the **live** cable colouring. Unset, the key is absent, the
telemetry routes don't exist (`404`) and the browser makes no telemetry requests.

For a Docker Compose setup, see [Live telemetry](../README.md#live-telemetry-optional)
in the README.

## Endpoints the collector serves

Both are `GET` requests with `Accept: application/json` (plus the bearer token when
set) and must answer with a 2xx status and a JSON array. Any other status, invalid
JSON, or no answer within **1.5 s** (shorter than the browser's 2 s poll, so slow calls
never pile up) counts as a failure of that call.

### `GET /api/v1/devices`

```json
[{ "name": "FRA1-core-01" }, { "name": "FRA1-core-02" }]
```

Only `name` is read. Any other field (addresses included) is ignored and never
forwarded.

### `GET /api/v1/devices/{device}/interfaces`

`{device}` is a name from the list above, URL-encoded (`/` arrives as `%2F`).

```json
[
  { "interface": "et-0/0/0", "telemetry_state": "LIVE", "capacity_bps": 100000000000, "rx_bps": 12500000000, "tx_bps": 830000000 },
  { "interface": "et-0/0/1", "telemetry_state": "STALE", "capacity_bps": 100000000000, "rx_bps": null, "tx_bps": null }
]
```

| Field | Type | Meaning |
|---|---|---|
| `interface` | string | Interface name, exactly as in your source of truth. |
| `telemetry_state` | string | Only `STALE` matters: the port shows `stale` and turns grey. Any other value (netstatex sends `LIVE` or `UNKNOWN`) counts as healthy. |
| `capacity_bps` | number or null | Line rate in bits per second. Drives every % and colour. `null` or `0`: rates show without a %, and the cable keeps its normal "up" colour. |
| `rx_bps` | number or null | Bits per second received on this port. `null` = not known yet. |
| `tx_bps` | number or null | Bits per second sent from this port. `null` = not known yet. |

Other fields (counters, descriptions, ...) are dropped by net3d's collector client and
never reach the browser. A port whose rates are both `null` and that is not `STALE`
(for example, a collector still waiting for its second sample) renders as if it had no
telemetry.

## Logical topology endpoints (optional)

net3d can display a **logical topology view** when the collector serves four additional
endpoints. All four are fetched in parallel with a 5 s timeout; any that answers
contributes its layer to the graph.

### `GET /api/v1/links`

LLDP adjacencies joined from both ends of each link.

```json
[{
  "a": { "device": "core-01", "interface": "et-0/0/0", "chassis_id": "02:…", "port_id": "et-0/0/0", "system_name": "core-01.example.net" },
  "b": { "device": "core-02", "interface": "et-0/0/1", "chassis_id": "02:…", "port_id": "et-0/0/1", "system_name": "core-02.example.net" },
  "state": "PRESENT",
  "confirmed": true,
  "last_seen": "2026-01-01T00:00:00Z"
}]
```

| Field | Meaning |
|---|---|
| `state` | Only `PRESENT` links are kept; `REMOVED` links are dropped. |
| `confirmed` | When `true`, the pair is emitted once (from the alphabetically-first device); unconfirmed links appear twice. |
| `b.device` | `null` for an unmonitored far end; `system_name` is used as the node name. |

net3d's server strips `chassis_id` before facts reach the browser.

### `GET /api/v1/isis/adjacencies`

IS-IS adjacencies per device and interface.

```json
[{
  "device": "core-01",
  "interface": "et-0/0/0.0",
  "level": 2,
  "system_id": "0000.0000.0001",
  "state": "UP",
  "neighbor_hostname": "core-02",
  "telemetry_state": "LIVE",
  "last_update": "2026-01-01T00:00:00Z"
}]
```

| Field | Meaning |
|---|---|
| `state` | `UP` = adjacency up. `REMOVED` adjacencies are dropped. |
| `telemetry_state` | `STALE` appends "stale" to the label and marks the adjacency down. |
| `neighbor_hostname` | Resolved from the LSDB when available; `null` before sync or without an LSDB source. |

net3d's server strips `system_id`, `neighbor_ipv4` and `neighbor_ipv6` before facts reach
the browser.

### `GET /api/v1/isis/topology`

IS-IS link-state database: nodes with Segment Routing info and links with metrics.
Returns empty arrays (`{sources:[], nodes:[], links:[]}`) when no device has LSDB
collection enabled.

```json
{
  "sources": [{ "device": "core-01", "telemetry_state": "LIVE", "synced_at": "2026-01-01T00:00:00Z" }],
  "nodes": [{
    "level": 2,
    "system_id": "0000.0000.0001",
    "hostname": "core-01",
    "prefix_sids": [{ "prefix": "192.0.2.1/32", "index": 1, "label": 16001, "flags": ["NODE"], "algorithm": 0 }]
  }],
  "links": [{
    "level": 2,
    "two_way": true,
    "a": { "system_id": "0000.0000.0001", "hostname": "core-01", "metric": 10, "adj_sids": [{ "value": 24001, "label": null, "flags": ["VALUE", "LOCAL"], "weight": 0 }] },
    "b": { "system_id": "0000.0000.0002", "hostname": "core-02", "metric": 10, "adj_sids": [{ "value": 24002, "label": null, "flags": ["VALUE", "LOCAL"], "weight": 0 }] }
  }]
}
```

net3d uses the LSDB only when at least one source has `telemetry_state: "LIVE"`. SR node
SIDs and adj-SIDs are extracted from `prefix_sids` (flags include `NODE`, algorithm 0)
and `adj_sids` (label from `label ?? value`). Without a live LSDB source, SR labels and
metrics stay dark.

net3d's server strips `system_id`, `router_id`, and all IP addresses (`prefix`,
`addresses`, `neighbor_addresses`) before facts reach the browser.

### `GET /api/v1/ospf/adjacencies`

OSPF adjacencies per device and interface. **Optional: a 404 response means the OSPF
layer stays dark.** netstatex v0.2.0 does not serve this endpoint.

```json
[{
  "device": "core-01",
  "interface": "TenGigE0/0/0/3",
  "area": "0.0.0.0",
  "neighbor_router_id": "192.0.2.2",
  "state": "FULL",
  "telemetry_state": "LIVE",
  "last_update": "2026-01-01T00:00:00Z"
}]
```

| Field | Meaning |
|---|---|
| `state` | `FULL` or `TWO_WAY` = adjacency up. `REMOVED` adjacencies are dropped. |
| `area` | Dotted-quad or integer; net3d converts dotted-quad to integer for display. |
| `telemetry_state` | `STALE` appends "stale" to the label and marks the adjacency down. |

OSPF has no hostname TLV, so the remote device is resolved only by LLDP coincidence.

net3d's server strips `neighbor_router_id`, `neighbor_address`, `designated_router` and
`backup_designated_router` before facts reach the browser.

## How rates are matched to cables

**Names.** Device and interface names must equal the names in your source of truth
(NetBox or Infrahub) exactly, case included. There is no normalisation and no
subinterface folding: report the physical port the cable lands on. A site view only
asks for devices that are mounted in a rack at that site and appear in the collector's
device list.

**Direct cables only.** Each cable is coloured from the ports at its own two ends, so
at least one end must be a monitored device interface. Rates are not carried through
patch panels: a panel-to-panel cable stays uncoloured.

**Direction.** For a cable between ends A and B (either may be unmonitored):

- A→B = A's `tx_bps`, else B's `rx_bps`
- B→A = B's `tx_bps`, else A's `rx_bps`
- the cable's rate is the larger direction; its % is that rate over the smaller
  `capacity_bps` of its monitored ends
- the cable turns grey only when **every** monitored end is `STALE`

That fallback still uses rates sent alongside `STALE`, so send `null` rates once they
are no longer valid. The device panel shows each port from its own side: ↓ `rx_bps`,
↑ `tx_bps`, and % = max(rx, tx) over `capacity_bps`. net3d does not sum LAG member
speeds: an aggregate interface sent with `capacity_bps: null` shows rates but no %.

**Circuits** (map arcs and room DC links) need:

1. terminations scoped to sites: that is what draws the arc between two sites;
2. at least one termination (ideally both) cabled **directly** to a monitored router
   interface. A termination cabled to a patch panel contributes no rates, because no
   collector reports the panel port, so a circuit with panels at both ends stays
   uncoloured.

net3d groups the ports cabled to each circuit by circuit ID and treats the circuit as
one cable between them, with the rules above: with a single monitored end, both
directions come from that router port. The % uses the `capacity_bps` your collector
reports for those router ports, not the circuit's commit rate: a 10G circuit on a
100G port shows its % of 100G.

Circuit rates are built only from sites whose cables net3d has already cached. Set
`PREWARM=1` so every site loads at start; otherwise arcs go live only for sites net3d
has loaded so far (for example, sites someone has opened).

## What net3d serves to the browser

### Rate endpoints

| Route | Response | Polled |
|---|---|---|
| `GET /api/telemetry/sites/:site` | `{ "devices": { "<device>": { "<interface>": { "rxBps", "txBps", "capacityBps", "stale" } } } }` | every 2 s, only while the **live** cable colouring is on or a device panel is open |
| `GET /api/telemetry/circuits` | `{ "circuits": { "<cid>": { "pct", "bps", "stale", "dirs": { "<site>": { "bps", "pct" } } } } }` | every 5 s, only while the map is visible, or in a site with **live** colouring and **DC links** shown |

### Topology endpoints

| Route | Response | Failure |
|---|---|---|
| `GET /api/telemetry/topology/sites/:site` | `{ facts, nodeSids, circuits }` | 404 `unknown_site` when the site isn't cached; 503 `telemetry_unavailable` when every collector endpoint failed |
| `GET /api/telemetry/topology/backbone` | `{ facts, nodeSids, circuits }` | 200 with empty arrays when the site cache is cold; 503 as above |

Topology endpoints share one upstream fetch (30 s cache) and skip the rate limit. A
partial collector failure returns what succeeded.

### Gating

The **Physical | Logical** switch appears when at least one capability enables it:

- **Site level**: telemetry available (`NETSTATEX_URL` set) **or** NAPALM available
  (NetBox with the NAPALM plugin).
- **Map level**: telemetry available only. NAPALM is never queried at map level.
- **Rack level**: logical view is not available (always physical).

No new env var or `/api/meta` flag is needed; the existing `telemetryAvailable` and
`napalmAvailable` flags gate the feature.

### What production shows

A production deployment with a gNMI collector typically shows:

- **IS-IS**: adjacencies and LSDB are live.
- **SR**: node SIDs and adj-SIDs appear when at least one LSDB source is `LIVE`.
- **Metrics**: link metrics from the LSDB.
- **OSPF**: dark unless the collector serves `/ospf/adjacencies` (netstatex v0.2.0 does
  not).

Without an LSDB source (collector has `isis_lsdb: false` for all devices), SR labels
and link metrics stay dark. A neighbour reached only over LLDP-less links stays
unresolved until the LSDB provides a hostname.

`pct`/`bps` describe a circuit's busier direction. `dirs` gives each direction, keyed by the
site the traffic leaves: the rate out of a site is that site's own router port tx, else the far
port's rx. A circuit seen from only one site still reports both directions once the circuit list
is loaded (`dirs` is `{}` until then).

Polling pauses in background tabs. Both routes only read what net3d has already cached
from the source of truth; they never query it. `{ "devices": {} }` means "no monitored
device at this site", and the browser stops polling that site. Errors: `GET
/api/telemetry/sites/:site` answers `404 unknown_site` when the site isn't loaded yet;
both routes answer `503 telemetry_unavailable` when the device list failed, or every
device call failed (a partial failure returns what succeeded).

Both routes skip net3d's per-IP rate limit, because every viewer polls and viewers
behind one reverse proxy share one IP. Server-side caches bound the collector load
instead:

| Cached | For | Effect |
|---|---|---|
| device list | 30 s | a device added to the collector appears within 30 s |
| one device's interfaces | 1 s | shared by both routes; concurrent viewers share one collector call |
| circuits response | 1 s | computed at most once per second |

While the collector answers, however many viewers are open, it sees at most one
`/devices` call per 30 s and one `/interfaces` call per device per second. Failed calls
are not cached: while the collector is failing, requests that arrive together still
share one call, but every later poll tries again. All live views share one logarithmic
colour scale from 0.01 % to 100 %.

## Security

- Only the net3d server talks to the collector. The browser never does, so the Content
  Security Policy needs no change.
- Make the collector reachable **only** by the net3d server: bind it to loopback on the
  same host, or run it as a Compose service with no published port. Never expose it
  publicly.
- Set `NETSTATEX_TOKEN` if your collector supports bearer auth.
- Responses carry only names, rates, utilisation, capacity and a stale flag: no device
  addresses and no raw counters.

## Implementations

- **netstatex**, the author's gNMI collector, implements this contract (it serves more
  under `/api/v1`, which net3d ignores). A link will be added here once it is published.

## Reference simulator

[`showcase/telemetry-sim/`](../showcase/telemetry-sim/) is a dependency-free Node
implementation of exactly these two endpoints. The showcase runs it
(`pnpm dev:showcase-live`) to show live data without real routers, and it is the
smallest example of a compatible collector.
