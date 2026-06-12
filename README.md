# net3d

Interactive 3D visualization of network infrastructure documented in NetBox.

Three continuous zoom levels in one WebGL scene:

1. **Globe** — datacenter sites at their real coordinates, inter-DC circuits drawn as
   great-circle arcs (brightness/lift scale with circuit count per site pair).
2. **Site** — procedural translucent building containing the site's racks, laid out in
   rows per NetBox location (NetBox stores no rack coordinates — the floor plan is
   schematic). Overhead trays show inter-rack cabling density.
3. **Rack** — devices at their true U-positions, sized by device-type height and colored
   by NetBox role color. Intra-rack cables route down a side channel.

Clicking a device opens a panel with **live NAPALM data** (facts, environment sensors,
interface states — refreshed every 10 s) and an opt-in **LLDP audit** that diffs
LLDP-discovered neighbors against NetBox-documented cables. Live interface state also
recolors the selected device's cables green/red in the 3D scene.

## Architecture

```
packages/
├── shared/   pure, fully-tested logic: geo projection, arcs, rack layout,
│             device transforms, cable paths, live-status & LLDP diffing
├── server/   Fastify proxy — holds the NetBox token, queries GraphQL,
│             normalizes polymorphic cable terminations, caches (TTL),
│             proxies allowlisted NAPALM methods with 429 load-shedding
└── web/      Vite + React 19 + react-three-fiber 9 + zustand + react-query
```

The browser never sees the NetBox token; all NetBox/NAPALM traffic goes through the
server. NAPALM calls are live SSH sessions (~25 s on first hit) — cached per
device+method (facts 30 s, environment 15 s, interfaces 10 s, LLDP 15 s).

## Setup

```sh
cp .env.example .env     # set NETBOX_URL, NETBOX_TOKEN (NETBOX_TLS_VERIFY=false for internal CAs)
pnpm install
pnpm dev                 # server on :3001, web on :5173
pnpm test                # vitest across all packages
```

Built against NetBox **3.7.8** with `netbox_napalm_plugin` 0.1.9. NetBox 3.7 GraphQL
specifics this code relies on: no `limit` argument on `*_list`, `role` (not
`device_role`) on Device, and the NAPALM endpoint at
`/api/plugins/netbox_napalm_plugin/napalmplatformconfig/{device_id}/napalm/?method=…`.
