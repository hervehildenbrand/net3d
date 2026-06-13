# net3d showcase NetBox

A self-contained, anonymous NetBox **4.x** instance for demoing net3d without the
private production NetBox. It models a fictional hyperscale operator:

- **20 real datacenters** worldwide (real coordinates → accurate Leaflet maps)
- **50 racks per site**: server racks packed with servers + ToR (leaf) switches,
  network racks with spine switches + core routers
- a **spine-leaf fabric** wired within each site (~18.6k devices total)
- **inter-DC circuits** from a curated list of real transit providers (Arelion,
  Lumen, Colt, GTT, Telia, Cogent, Zayo, NTT, …) with fictional circuit IDs

Everything here is fake; no production data is used.

## 1. Bring up NetBox

```bash
showcase/setup.sh
```

This clones [netbox-docker](https://github.com/netbox-community/netbox-docker)
(pinned, into `showcase/netbox/`, git-ignored), overlays our customisations
(`docker-compose.override.yml`: host port **8088**, deterministic superuser),
pulls images, and starts the stack. First boot runs DB migrations (~2–4 min).

NetBox: <http://localhost:8088>  ·  login **admin / admin**

### API token

NetBox 4.6 uses "token v2"; `SUPERUSER_API_TOKEN` is not honoured, so create a
deterministic v1 token once (matches `.env.showcase` and the seed default):

```bash
cd showcase/netbox
docker compose exec -T netbox /opt/netbox/venv/bin/python \
  /opt/netbox/netbox/manage.py shell -c "
from users.models import Token, User
u = User.objects.get(username='admin')
Token.objects.filter(user=u).delete()
t = Token(user=u, version=1); t.token = 'abcdef0123456789abcdef0123456789abcdef01'; t.save()
print('token:', t.plaintext)"
```

## 2. Seed the data

```bash
cd showcase/seed
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python seed.py
```

Idempotent and resumable — re-running skips sites whose racks already exist.
Full seed of all 20 sites takes ~10–20 min (bulk REST creates).

### Tunables (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `SERVER_RACKS` | 46 | server racks per site |
| `SERVERS_PER_RACK` | 18 | servers per server rack |
| `SPINES_PER_DC` / `CORES_PER_DC` | 8 / 2 | network-rack devices |
| `SPINE_UPLINKS` | 4 | leaf→spine uplinks per leaf |
| `SERVER_CABLING` | `sample` | `none` \| `sample` \| `full` server→ToR cabling |
| `ONLY_SITES` | (all) | comma list, e.g. `IAD1,FRA1` |

`SERVER_CABLING=full` produces ~33k cables (slow seed, heavy render); the default
`sample` keeps the fabric the visual centrepiece while racks still look wired.

## 3. Run net3d against it

```bash
pnpm dev:showcase   # server reads ../../.env.showcase (NETBOX_URL=:8088)
```

The default `pnpm dev` still targets the private 3.7.8 instance via `.env`.

## Teardown

```bash
cd showcase/netbox && docker compose down         # keep data (volumes)
cd showcase/netbox && docker compose down -v      # wipe data
```
