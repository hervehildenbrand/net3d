# telemetry-sim

A dependency-free Node script that stands in for a live-telemetry collector, so the
showcase's fictional routers and switches can show link utilisation. It serves the two
read-only endpoints net3d reads (the contract is in [docs/telemetry.md](../../docs/telemetry.md)):

- `GET /api/v1/devices` → `[{ "name": "…" }]`
- `GET /api/v1/devices/{device}/interfaces` → `[{ "interface", "telemetry_state",
  "capacity_bps", "rx_bps", "tx_bps" }]`

Anything else, including an unknown device, gets `404 {"error":{"code":"NOT_FOUND"}}`.

## How it works

- **Names come from net3d itself.** It reads `GET /api/sites` and each
  `GET /api/sites/:name` from every URL in `NET3D_URLS`, so device and port names match
  the seed exactly, for NetBox or Infrahub and any seed size. Only switches and routers
  (roles `Core`, `Spine`, `Leaf`, `OOB`) and only their cabled interfaces are monitored.
- **It listens only after the first discovery finds a device.** An empty device list
  would make net3d report "nothing monitored here", and the browser would stop polling.
  Until then net3d answers 503 and the browser keeps trying.
- **It rediscovers every `REFRESH_MS`, and sooner after a failed call** (2 s, doubling
  up to 60 s). A site whose first load timed out therefore gets live data within a
  minute. Devices are only ever added, so a failed call never blanks a site.
- **Rates are a pure function of link and time:** a per-link base of 0.05–60 % of the
  port speed (taken from the interface type), a day/night swing by the site's longitude,
  and small 20–120 s wobbles. Both ends of a direct cable, and both ends of a circuit
  cabled at two sites, report mirrored rates (A's tx is Z's rx).
- About 1.5 % of devices go `STALE` (null rates) for one minute in every ten.

Circuit arcs on the map and room-view DC links go live only where the seed cables
circuits to core-router ports.

## Run

```bash
pnpm dev:showcase-live   # the NetBox showcase with NETSTATEX_URL=http://127.0.0.1:8090, plus this simulator
```

A full-mirror Infrahub (`run_full_mirror.sh`) cables exactly like the NetBox showcase, so
one simulator can serve both: `NET3D_URLS=http://127.0.0.1:3001,http://127.0.0.1:3002 pnpm sim:telemetry`.
If your Infrahub is the default 4-site subset, run one simulator per backend (below): the
subset cables different circuits to the same port names.

```bash
pnpm --filter @net3d/web dev &
NETSTATEX_URL=http://127.0.0.1:8090 pnpm --filter @net3d/server dev:showcase &
NETSTATEX_URL=http://127.0.0.1:8091 PORT=3002 pnpm --filter @net3d/server dev:showcase-infrahub &
pnpm sim:telemetry &
NET3D_URLS=http://127.0.0.1:3002 PORT=8091 pnpm sim:telemetry &
wait
```

| Env | Default | Meaning |
|-----|---------|---------|
| `NET3D_URLS` | `http://127.0.0.1:3001` | comma list of net3d servers to discover names from |
| `HOST` | `127.0.0.1` | listen address (`0.0.0.0` inside a container) |
| `PORT` | `8090` | listen port |
| `REFRESH_MS` | `600000` | full rediscovery interval; after a failed call it retries sooner |

## Test

```bash
node --test showcase/telemetry-sim/model.test.mjs showcase/telemetry-sim/sim.test.mjs
```

## Limits

- Showcase only: `showcase/` is outside the Docker build context, so the simulator never
  ships in the net3d image. Point production net3d at a real collector.
- No auth: it can't discover from a net3d that sets `NET3D_API_TOKEN`, and it ignores any
  bearer token sent to it.
- Leaf uplinks routed through patch panels get independent rates at each end.
- Several `NET3D_URLS` share one device list. A device + port name found in more than one
  backend uses the first URL's cabling, which is only right when the backends cable
  identically. Otherwise run one simulator per backend, as above.
- A device removed from the seed stays listed until the simulator restarts.
