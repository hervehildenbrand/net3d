# net3d showcase — Infrahub

A local [Infrahub](https://docs.infrahub.app) instance holding the **same demo
topology** as the NetBox showcase, so net3d can be pointed at either source of
truth and render the same globe / sites / racks / power / circuits.

The net3d server picks its backend at startup via `SOT_BACKEND` (see the repo
README); this directory only stands up Infrahub and loads it with data.

## Stack

The official Opsmill compose (pinned in `.env`), published on **:8000** so it
coexists with the NetBox showcase on :8088:

| Service | Purpose |
|---------|---------|
| `infrahub-server` | API + GraphQL on :8000 |
| `database` | Neo4j (graph store) |
| `cache` | Redis |
| `message-queue` | RabbitMQ |
| `task-manager` / `task-manager-db` | Prefect workflow engine + its Postgres |
| `task-worker` | Prefect worker (1 replica) |

Admin token (demo only): `06438eb2-8019-4776-878c-0941b1f1d1ec` — login `admin` / `infrahub`.

## 1. Bring it up + load the schema

```bash
cd showcase/infrahub
python3 -m venv .venv && ./.venv/bin/pip install "infrahub-sdk[all]"   # provides infrahubctl + the seed SDK
./setup.sh        # docker compose up -d, wait for health, infrahubctl schema load schema/
```

First boot bootstraps Neo4j + Prefect (~1-3 min). The Neo4j healthcheck only
probes HTTP :7474, so the server may restart once before Bolt :7687 is ready —
the `restart: unless-stopped` policy recovers it automatically.

The DCIM schema (`schema/dcim.yml`) is a focused model in the `Dcim`/`Circuit`
namespaces matching exactly what net3d reads (sites, racks, devices, interfaces,
cables, power panels/feeds, circuits).

## 2. Seed the data (subset by default)

```bash
./.venv/bin/python seed/seed_infrahub.py
```

Reuses the NetBox showcase's `showcase/seed/data/*.json` fixtures and its
`server_roles` / `power` helpers. Defaults to a 4-site subset
(`ONLY_SITES=IAD1,AMS1,SIN1,MIA1`) at reduced rack/server counts so it seeds in a
couple of minutes. Scale up via env:

```bash
ONLY_SITES=IAD1,AMS1,SIN1,MIA1 SERVER_RACKS=8 SERVERS_PER_RACK=18 \
  ./.venv/bin/python seed/seed_infrahub.py
```

It is idempotent (every node upserts by HFID), so it is safe to re-run.

## 3. Run net3d against it

```bash
# from the repo root
scripts/dev-restart.sh infrahub        # uses .env.showcase-infrahub (SOT_BACKEND=infrahub)
# or: pnpm dev:showcase-infrahub
```

Open http://localhost:5173 and pick a seeded site.

## Verify parity with NetBox

With both showcases seeded, compare a seeded site across backends:

```bash
# NetBox backend running on :3001
curl -s http://localhost:3001/api/sites/AMS1 | jq -S '{racks: (.racks|length), cables: (.cables|length), feeds: (.power.feeds|length)}'
# restart against Infrahub, then the same — counts/shape should match
```

## Teardown

```bash
cd showcase/infrahub
docker compose down -v        # -v also drops the Neo4j/Prefect volumes
```
