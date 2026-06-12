# net3d

**Zoom from the world map into a rack unit.** net3d turns any [NetBox](https://netbox.dev)
instance into an explorable visualization: a real-tile world map of your sites, 3D
buildings with your racks, devices at their true U-positions — connected by one
continuous mouse-wheel journey.

## Features

- 🗺 **World map** (Leaflet + CARTO Positron) auto-fitted to your geocoded sites, with
  inter-DC circuits drawn as geodesic lines weighted by circuit count.
- 🔍 **Zoom-through navigation** — scroll into a site on the map and you crossfade into
  its 3D building; keep scrolling toward a rack and you're inside it; scroll out to
  retrace every step. Clicks work as shortcuts; hysteresis prevents level flapping.
- 🏢 **Procedural site view** — racks laid out in rows per NetBox location inside a
  glass building (NetBox stores no rack coordinates, so the floor plan is schematic).
- 🗄 **Rack view** — devices at their real U-positions, sized by device-type height,
  colored by NetBox role color; documented cables routed down the side channel.
- 🔌 **Cabling, documented and discovered** — solid lines are NetBox cables (all
  termination types: interfaces, front/rear ports, console, power, circuits). Entering
  a rack auto-discovers **LLDP neighbors via the NetBox NAPALM plugin** (the app never
  contacts devices directly); undocumented links appear as dashed cyan cables, with
  inter-rack discoveries shown as dashed overhead trays in the site view.
- 📟 **Live device panel** — NAPALM facts, environment sensors, interface up/down
  states (auto-refresh), live green/red cable coloring, and an LLDP-vs-NetBox audit.
- 🪶 **Graceful degradation** — without the NAPALM plugin, all live features hide and
  the app runs on documented NetBox data alone.

## Requirements

- Node.js ≥ 20 and [pnpm](https://pnpm.io)
- A NetBox instance (tested against **3.7.x**) and an API token with read access
- Optional, for live data: [netbox-napalm-plugin](https://github.com/netbox-community/netbox-napalm-plugin)
  configured with platform → NAPALM driver mappings and device credentials

No NetBox handy? Stand one up in minutes with
[netbox-docker](https://github.com/netbox-community/netbox-docker) and load the
[demo data](https://github.com/netbox-community/netbox-demo-data).

## Quickstart

```sh
cp .env.example .env     # set NETBOX_URL + NETBOX_TOKEN (NETBOX_TLS_VERIFY=false for internal CAs)
pnpm install
pnpm dev                 # API proxy on :3001, app on http://localhost:5173
pnpm test                # vitest across all packages
```

The API token never reaches the browser — a small Fastify proxy holds it, queries
NetBox GraphQL, normalizes the data, and caches responses (topology minutes, NAPALM
seconds-to-minutes per method).

## Architecture

```
packages/
├── shared/   pure, fully-tested logic: map bounds & geodesics, rack layout,
│             device U-transforms, cable paths, zoom-navigation state machine,
│             LLDP↔cable diffing
├── server/   Fastify proxy: GraphQL queries, polymorphic cable-termination
│             normalization, TTL caches, NAPALM method allowlist + load shedding,
│             /api/meta capability probe
└── web/      Vite + React 19 + react-leaflet 5 + react-three-fiber 9 + zustand
```

### Good to know

- **NAPALM calls are live SSH sessions** opened by NetBox (~25 s per device on real
  hardware). net3d bounds concurrency (3 client-side, 8 server-side with 429 shedding)
  and caches LLDP answers for 10 minutes — discovery is progressive, not blocking.
- **NetBox 3.7 GraphQL quirks** handled here: no `limit` argument on `*_list`, `role`
  (not `device_role`) on Device, polymorphic cable terminations needing one inline
  fragment per type.
- Sites without latitude/longitude don't appear on the map but stay reachable through
  the search box.

## License

[MIT](LICENSE)
