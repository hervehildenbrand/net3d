#!/usr/bin/env python3
"""Seed the net3d Infrahub showcase with the same topology as the NetBox showcase.

Reuses the NetBox seed's data fixtures (showcase/seed/data/*.json) and its
server-role + power helpers, reproducing the same global fabric (sites, racks,
servers + leaf/spine/core + OOB switches, spine-leaf cabling, A/B power, inter-DC
circuits) but writing through the Infrahub Python SDK against the DCIM schema in
../schema/dcim.yml.

Defaults to a small multi-region SUBSET so it seeds in a couple of minutes; scale
up with the env knobs (or ONLY_SITES=<all codes>) for a fuller mirror.

Idempotent: every node is saved with allow_upsert=True, keyed by its schema HFID,
so the script can be re-run or resumed.

Env:
  INFRAHUB_ADDRESS (default http://localhost:8000)
  INFRAHUB_API_TOKEN (default the showcase admin token)
  ONLY_SITES=IAD1,AMS1,SIN1,MIA1   SERVER_RACKS=4  SERVERS_PER_RACK=8
  NETWORK_RACKS=2  SPINES_PER_DC=4  CORES_PER_DC=2  SPINE_UPLINKS=2
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

from infrahub_sdk import Config, InfrahubClientSync
from infrahub_sdk.exceptions import ServerNotResponsiveError

# Reuse the NetBox showcase's generation helpers + data fixtures.
NB_SEED = Path(__file__).resolve().parents[2] / "seed"  # showcase/seed
sys.path.insert(0, str(NB_SEED))
from server_roles import SERVER_ROLE_DEFS, server_role, server_device_type_slug  # noqa: E402
from power import FEED_ELECTRICAL, PDU_ROLE, feed_name, feed_type, panel_name, pdu_name  # noqa: E402

DATA = NB_SEED / "data"

ADDR = os.environ.get("INFRAHUB_ADDRESS", "http://localhost:8000")
TOKEN = os.environ.get("INFRAHUB_API_TOKEN", "06438eb2-8019-4776-878c-0941b1f1d1ec")

ONLY_SITES = {
    s.strip().upper()
    for s in os.environ.get("ONLY_SITES", "IAD1,AMS1,SIN1,MIA1").split(",")
    if s.strip()
}
SERVER_RACKS = int(os.environ.get("SERVER_RACKS", "4"))
SERVERS_PER_RACK = int(os.environ.get("SERVERS_PER_RACK", "8"))
NETWORK_RACKS = int(os.environ.get("NETWORK_RACKS", "2"))
SPINES_PER_DC = int(os.environ.get("SPINES_PER_DC", "4"))
CORES_PER_DC = int(os.environ.get("CORES_PER_DC", "2"))
SPINE_UPLINKS = int(os.environ.get("SPINE_UPLINKS", "2"))
SERVER_CABLING_SAMPLE = int(os.environ.get("SERVER_CABLING_SAMPLE", "2"))
# Seed sites without circuits (for resumable per-site runs over a big mirror); the
# circuit ring needs the full site list, so a final CIRCUITS_ONLY pass creates them.
SKIP_CIRCUITS = os.environ.get("SKIP_CIRCUITS", "") in ("1", "true")
CIRCUITS_ONLY = os.environ.get("CIRCUITS_ONLY", "") in ("1", "true")
# One-off cleanup: delete cables that duplicate an endpoint pair (left over from
# earlier re-seeds before cable creation became idempotent).
DEDUPE_CABLES = os.environ.get("DEDUPE_CABLES", "") in ("1", "true")

RACK_HEIGHT = 42
OOB_SWITCH_POS = 40
OOB_AGGS = 2

# Network role colors (6-hex, no '#'); stored in Infrahub as '#rrggbb'.
ROLE_COLORS = {
    "server": "2196f3", "leaf": "4caf50", "spine": "ff9800",
    "core": "9c27b0", "oob": "607d8b",
}
REGION_NAMES = {"amer": "Americas", "emea": "EMEA", "apac": "APAC"}


def server_status(idx: int) -> str:
    if idx % 30 == 0:
        return "offline"
    if idx % 50 == 0:
        return "planned"
    return "active"


def load(name: str):
    return json.loads((DATA / name).read_text())


def hexcolor(c: str) -> str:
    return c if c.startswith("#") else f"#{c}"


# A loaded host can make the server briefly unresponsive; every write is an
# idempotent upsert, so retrying with backoff is safe.
BATCH_CONCURRENCY = int(os.environ.get("SEED_BATCH_CONCURRENCY", "2"))
MAX_RETRIES = int(os.environ.get("SEED_MAX_RETRIES", "6"))
# Cap how many nodes go in one batch so a server timeout only re-runs that slice,
# not a whole full-density site (~1k devices / ~2k interfaces) at once.
BATCH_CHUNK = int(os.environ.get("SEED_BATCH_CHUNK", "250"))


def _chunks(seq: list, size: int) -> list:
    return [seq[i : i + size] for i in range(0, len(seq), size)]


def cable_pairs(cables: list[dict]) -> set:
    """Order-independent endpoint-pair keys from cables [{'a','b'}] — a cable is
    identified by the two interfaces it joins (DcimCable has no natural unique key),
    so this is the set used to skip cables that already exist."""
    return {frozenset((c["a"], c["b"])) for c in cables}


def duplicate_cable_ids(cables: list[dict]) -> list:
    """Ids of cables that repeat an endpoint pair already seen (keep the first)."""
    seen: set = set()
    dups: list = []
    for c in cables:
        key = frozenset((c["a"], c["b"]))
        if key in seen:
            dups.append(c["id"])
        else:
            seen.add(key)
    return dups


# infrahub-sdk >=1.x sets batch concurrency on the client Config; create_batch()
# no longer accepts a max_concurrent_execution kwarg.
client = InfrahubClientSync(
    address=ADDR,
    config=Config(api_token=TOKEN, max_concurrent_execution=BATCH_CONCURRENCY),
)


def _retry(fn):
    for attempt in range(MAX_RETRIES):
        try:
            return fn()
        except ServerNotResponsiveError:
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("unreachable")


def upsert(kind: str, data: dict):
    obj = client.create(kind=kind, data=data)
    _retry(lambda: obj.save(allow_upsert=True))
    return obj


def batch_upsert(specs: list[tuple[str, dict]]):
    """Create+save a list of (kind, data) via bounded, chunked batches; retry on timeout.

    Each chunk is idempotent (upsert), so on a transient server timeout we rebuild
    and re-run just that chunk rather than tracking partial completion.
    """
    out = []
    for chunk in _chunks(specs, BATCH_CHUNK):
        def run(chunk=chunk):
            batch = client.create_batch()
            built = [client.create(kind=kind, data=data) for kind, data in chunk]
            for node in built:
                batch.add(task=node.save, node=node, allow_upsert=True)
            return [node for node, _ in batch.execute()]

        out.extend(_retry(run))
    return out


def _fetch_cables(filter_str: str = "") -> list[dict]:
    """Fetch cables (optionally filtered) as [{'id','a','b'}] via GraphQL, where a/b
    are the endpoint interface ids."""
    q = (f"{{ DcimCable{filter_str} {{ edges {{ node {{ id "
         f"endpoint_a {{ node {{ id }} }} endpoint_b {{ node {{ id }} }} }} }} }} }}")
    data = _retry(lambda: client.execute_graphql(query=q))
    out = []
    for e in data["DcimCable"]["edges"]:
        n = e["node"]
        a = (n.get("endpoint_a") or {}).get("node") or {}
        b = (n.get("endpoint_b") or {}).get("node") or {}
        if a.get("id") and b.get("id"):
            out.append({"id": n["id"], "a": a["id"], "b": b["id"]})
    return out


def _existing_cable_pairs(iface_ids: list[str]) -> set:
    """Endpoint-pair keys of cables already terminating on any of these interfaces
    (both sides, chunked to bound query size). Empty on a first-time site seed."""
    cables: list[dict] = []
    for side in ("endpoint_a", "endpoint_b"):
        for chunk in _chunks(iface_ids, 500):
            ids = ", ".join(f'"{i}"' for i in chunk)
            cables += _fetch_cables(f"({side}__ids: [{ids}])")
    return cable_pairs(cables)


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------
def seed_reference():
    print("== reference data ==", flush=True)
    roles = {}
    for slug, color in ROLE_COLORS.items():
        name = slug.upper() if slug == "oob" else slug.capitalize()
        roles[slug] = upsert("DcimDeviceRole", {"name": name, "color": hexcolor(color)})
    for d in SERVER_ROLE_DEFS:
        roles[d["slug"]] = upsert("DcimDeviceRole", {"name": d["name"], "color": hexcolor(d["color"])})
    roles["pdu"] = upsert("DcimDeviceRole", {"name": PDU_ROLE["name"], "color": hexcolor(PDU_ROLE["color"])})

    manufacturers = {}
    types_by_role = defaultdict(list)
    type_by_slug = {}
    for dt in load("device_types.json"):
        man = dt["manufacturer"]
        if man not in manufacturers:
            manufacturers[man] = upsert("DcimManufacturer", {"name": man})
        data = {
            "model": dt["model"],
            "u_height": dt["u_height"],
            "is_full_depth": dt["is_full_depth"],
            "manufacturer": manufacturers[man].id,
        }
        for k in ("cpu_model", "cpu_cores", "ram_gb", "storage_tb", "power_draw_w"):
            if dt.get("specs", {}).get(k) is not None:
                # storage_tb is Text (decimal); the rest are ints/text as-is.
                data[k] = str(dt["specs"][k]) if k == "storage_tb" else dt["specs"][k]
        rec = upsert("DcimDeviceType", data)
        rec._u_height = dt["u_height"]
        types_by_role[dt["role"]].append(rec)
        type_by_slug[dt["slug"]] = rec

    providers = {p["name"]: upsert("CircuitProvider", {"name": p["name"]}) for p in load("providers.json")}
    return roles, types_by_role, type_by_slug, providers


# ---------------------------------------------------------------------------
# Per-site fabric
# ---------------------------------------------------------------------------
def seed_site(dc, roles, types_by_role, type_by_slug):
    code = dc["code"]
    srv_racks = int(dc.get("server_racks", SERVER_RACKS))
    print(f"== {code} ({dc['name']}) ==", flush=True)

    site = upsert("DcimSite", {
        "name": code,
        # latitude/longitude/storage_tb are Text in the schema (Infrahub Number is
        # integer-only); store decimals as strings.
        "latitude": str(dc["latitude"]),
        "longitude": str(dc["longitude"]),
        "region": REGION_NAMES.get(dc["region"], dc["region"]),
        "status": "active",
        "physical_address": dc.get("address", ""),
        "facility": dc.get("facility", ""),
        "role": dc.get("role", "compute"),
    })

    # racks
    rack_specs = []
    for i in range(1, srv_racks + 1):
        hall = "server-hall-1" if i <= srv_racks // 2 else "server-hall-2"
        rack_specs.append(("DcimRack", {
            "name": f"{code}-SRV-{i:02d}", "site": site.id, "location": hall, "u_height": RACK_HEIGHT,
        }))
    for i in range(1, NETWORK_RACKS + 1):
        rack_specs.append(("DcimRack", {
            "name": f"{code}-NET-{i:02d}", "site": site.id, "location": "network-core", "u_height": RACK_HEIGHT,
        }))
    racks = {n.name.value: n for n in batch_upsert(rack_specs)}
    print(f"   {len(racks)} racks", flush=True)

    leaf_type = types_by_role["leaf"][0]
    spine_type = types_by_role["spine"][0]
    core_type = types_by_role["core"][0]
    oob_type = types_by_role["oob"][0]
    oob_agg_type = types_by_role["oob-agg"][0]
    pdu_type = type_by_slug["apc-ap8853"]

    dev_specs = []  # (name, dtype, role_slug, rack_name, pos, face, status)
    leaf_names, spine_names, core_names, oob_agg_names = [], [], [], []
    oob_by_rack = {}
    server_names_by_rack = defaultdict(list)
    server_seq = 0

    def dev(name, dtype, role, rack_name, pos, face="front", status="active"):
        dev_specs.append((name, dtype, role, rack_name, pos, face, status))

    for i in range(1, srv_racks + 1):
        rname = f"{code}-SRV-{i:02d}"
        for li in (1, 2):
            ln = f"{code}-SRV-{i:02d}-leaf-{li}"
            dev(ln, leaf_type, "leaf", rname, RACK_HEIGHT - (li - 1))
            leaf_names.append(ln)
        on = f"{code}-SRV-{i:02d}-oob"
        dev(on, oob_type, "oob", rname, OOB_SWITCH_POS)
        oob_by_rack[rname] = on
        u = 1
        for s in range(SERVERS_PER_RACK):
            role = server_role(i - 1, s)
            # hardware tracks the server's role (specs live on the device type), so a
            # rack's primary function reads as its capacity in the room-view heatmap
            dt = type_by_slug[server_device_type_slug(role)]
            if u + dt._u_height - 1 >= OOB_SWITCH_POS:
                break
            sn = f"{code}-SRV-{i:02d}-srv-{s + 1:02d}"
            server_seq += 1
            dev(sn, dt, role, rname, u, status=server_status(server_seq))
            server_names_by_rack[rname].append(sn)
            u += dt._u_height

    for i in range(SPINES_PER_DC):
        rname = f"{code}-NET-{(i // 2) % NETWORK_RACKS + 1:02d}"
        sn = f"{code}-spine-{i + 1:02d}"
        dev(sn, spine_type, "spine", rname, 30 + (i % 2) * 2)
        spine_names.append(sn)
    for c in range(CORES_PER_DC):
        cn = f"{code}-core-{c + 1:02d}"
        dev(cn, core_type, "core", f"{code}-NET-01", 1 + c * 6)
        core_names.append(cn)
    for a in range(OOB_AGGS):
        an = f"{code}-oob-agg-{a + 1}"
        rname = f"{code}-NET-{(a % NETWORK_RACKS) + 1:02d}"
        dev(an, oob_agg_type, "oob", rname, 20)
        oob_agg_names.append(an)

    # PDUs: two 0U vertical units per rack (the power source devices).
    for rname in racks:
        for side in ("A", "B"):
            dev_specs.append((pdu_name(rname, side), pdu_type, "pdu", rname, None, None, "active"))

    device_specs = [
        ("DcimDevice", {
            "name": name, "device_type": dtype.id, "role": roles[role].id, "site": site.id,
            "rack": racks[rname].id, "position": pos, "face": face, "status": status,
        })
        for (name, dtype, role, rname, pos, face, status) in dev_specs
    ]
    devices = {n.name.value: n for n in batch_upsert(device_specs)}
    print(f"   {len(devices)} devices", flush=True)

    # ---- cabling plan (mirrors the NetBox seed) ----
    ifaces = defaultdict(dict)  # device_name -> {iface: type}
    plan = []  # (a_dev, a_if, b_dev, b_if, cable_type)

    def link(a_dev, a_if, a_t, b_dev, b_if, b_t, ctype):
        ifaces[a_dev][a_if] = a_t
        ifaces[b_dev][b_if] = b_t
        plan.append((a_dev, a_if, b_dev, b_if, ctype))

    for li, leaf in enumerate(leaf_names):
        for u in range(SPINE_UPLINKS):
            spine = spine_names[(li * SPINE_UPLINKS + u) % len(spine_names)]
            link(leaf, f"Ethernet{u + 1}", "100gbase-x-qsfp28",
                 spine, f"leaf{li + 1}-{u + 1}", "100gbase-x-qsfp28", "smf")
    for si, spine in enumerate(spine_names):
        for c in range(CORES_PER_DC):
            core = core_names[c % len(core_names)]
            link(spine, f"Core{c + 1}", "100gbase-x-qsfp28",
                 core, f"spine{si + 1}-{c + 1}", "100gbase-x-qsfp28", "smf")
    for i in range(1, srv_racks + 1):
        rname = f"{code}-SRV-{i:02d}"
        oob = oob_by_rack[rname]
        for sn in server_names_by_rack[rname][:SERVER_CABLING_SAMPLE]:
            num = sn.split("-")[-1]
            for li in (1, 2):
                leaf = f"{code}-SRV-{i:02d}-leaf-{li}"
                link(sn, f"eth{li - 1}", "25gbase-x-sfp28", leaf, f"Server-{num}", "25gbase-x-sfp28", "cat6a")
            link(sn, "mgmt0", "1000base-t", oob, f"Server-{num}", "1000base-t", "cat6a")
    for i in range(1, srv_racks + 1):
        rname = f"{code}-SRV-{i:02d}"
        oob = oob_by_rack[rname]
        for a, agg in enumerate(oob_agg_names):
            link(oob, f"TenGig{a + 1}", "10gbase-x-sfpp", agg, f"Rack-{i:02d}", "10gbase-x-sfpp", "mmf")
        for li in (1, 2):
            link(f"{code}-SRV-{i:02d}-leaf-{li}", "mgmt0", "1000base-t", oob, f"Leaf-{li}", "1000base-t", "cat6a")
    for di, dn in enumerate(spine_names + core_names):
        agg = oob_agg_names[di % len(oob_agg_names)]
        link(dn, "mgmt0", "1000base-t", agg, f"Mgmt-{dn.removeprefix(code + '-')}", "1000base-t", "cat6a")

    iface_specs = [
        ("DcimInterface", {"device": devices[dn].id, "name": name, "interface_type": t})
        for dn, ports in ifaces.items()
        for name, t in ports.items()
    ]
    iface_nodes = batch_upsert(iface_specs)
    iface_id = {(n.device.id, n.name.value): n.id for n in iface_nodes}
    print(f"   {len(iface_id)} interfaces", flush=True)

    # DcimCable has no natural unique key, so allow_upsert can't dedupe — skip cables
    # whose endpoint pair already exists, keeping re-seeds idempotent (no duplicates).
    existing = _existing_cable_pairs(list(iface_id.values()))
    cable_specs = []
    for a_dev, a_if, b_dev, b_if, ctype in plan:
        aid = iface_id[(devices[a_dev].id, a_if)]
        bid = iface_id[(devices[b_dev].id, b_if)]
        if frozenset((aid, bid)) in existing:
            continue
        cable_specs.append(("DcimCable", {
            "status": "connected", "cable_type": ctype, "endpoint_a": aid, "endpoint_b": bid,
        }))
    batch_upsert(cable_specs)
    print(f"   {len(cable_specs)} cables ({len(plan) - len(cable_specs)} already present)", flush=True)

    # ---- power: panels (A/B) + per-rack feeds (A/B) ----
    panels = {}
    for side in ("A", "B"):
        pname = panel_name(code, side)
        panels[side] = upsert("DcimPowerPanel", {"name": pname, "location": "network-core", "site": site.id})
    feed_specs = []
    for rname, rack in racks.items():
        for side in ("A", "B"):
            feed_specs.append(("DcimPowerFeed", {
                "name": feed_name(rname, side),
                "status": "active",
                "voltage": FEED_ELECTRICAL["voltage"],
                "amperage": FEED_ELECTRICAL["amperage"],
                "phase": FEED_ELECTRICAL["phase"],
                "supply": FEED_ELECTRICAL["supply"],
                "feed_type": feed_type(side),
                "max_utilization": FEED_ELECTRICAL["max_utilization"],
                "power_panel": panels[side].id,
                "rack": rack.id,
            }))
    batch_upsert(feed_specs)
    print(f"   {len(panels)} panels, {len(feed_specs)} feeds", flush=True)
    return site


# ---------------------------------------------------------------------------
# Inter-DC circuits (ring over the seeded subset)
# ---------------------------------------------------------------------------
def circuit_rate_kbps(hop: int, seq: int) -> int:
    if hop == 7:
        return 400_000_000
    if hop == 2 and seq % 2 == 0:
        return 10_000_000
    return 100_000_000


def seed_circuits(dcs, sites, providers):
    print("== inter-DC circuits ==", flush=True)
    prov_list = list(providers.values())
    n = len(dcs)
    seq = 0
    made = 0
    for i in range(n):
        for hop in (1, 2, 7):
            j = (i + hop) % n
            if j == i:
                continue
            a, z = dcs[i]["code"], dcs[j]["code"]
            if a not in sites or z not in sites:
                continue
            provider = prov_list[seq % len(prov_list)]
            seq += 1
            rate = circuit_rate_kbps(hop, seq)
            cid = f"{provider.name.value.upper().replace(' ', '-')}-{a}-{z}-{seq:03d}"
            circuit = upsert("CircuitCircuit", {
                "cid": cid, "provider": provider.id, "status": "active", "commit_rate": rate,
                "description": f"{a} <-> {z} transport via {provider.name.value} ({rate // 1_000_000}G)",
            })
            for term, scode in (("A", a), ("Z", z)):
                upsert("CircuitEndpoint", {
                    "name": f"{cid}-{term}", "term_side": term,
                    "circuit": circuit.id, "site": sites[scode].id,
                })
            made += 1
    print(f"   {made} circuits", flush=True)


def main():
    print(f"Seeding Infrahub at {ADDR}", flush=True)
    full_dcs = load("datacenters.json")

    # Dedupe-only: delete cables that repeat an endpoint pair (left over from
    # pre-idempotency re-seeds), keeping one cable per pair. No site/circuit work.
    if DEDUPE_CABLES:
        all_cables = _fetch_cables()
        dup_ids = set(duplicate_cable_ids(all_cables))
        print(f"Dedupe: {len(all_cables)} cables, {len(dup_ids)} duplicates to delete", flush=True)
        if dup_ids:
            nodes = [n for n in client.all("DcimCable") if n.id in dup_ids]
            for chunk in _chunks(nodes, BATCH_CHUNK):
                batch = client.create_batch()
                for n in chunk:
                    batch.add(task=n.delete, node=n)
                _retry(lambda b=batch: list(b.execute()))
            print(f"   deleted {len(nodes)} duplicate cables", flush=True)
        print("Done (dedupe cables).", flush=True)
        return

    # Circuits-only: don't (re)seed sites — read the ones already in Infrahub and
    # build the ring over the FULL dc list (so a site-by-site mirror gets its
    # inter-DC circuits in one final pass).
    if CIRCUITS_ONLY:
        providers = {p["name"]: upsert("CircuitProvider", {"name": p["name"]}) for p in load("providers.json")}
        sites = {s.name.value: s for s in client.all("DcimSite")}
        print(f"Circuits-only pass over {len(sites)} existing sites", flush=True)
        # Clear any prior circuits (e.g. from a smaller earlier seed) so the
        # full-list ring yields exactly the canonical set, re-runnably. Endpoints
        # first (they parent onto a circuit), then the circuits themselves.
        old_circuits = client.all("CircuitCircuit")
        for ep in client.all("CircuitEndpoint"):
            _retry(ep.delete)
        for c in old_circuits:
            _retry(c.delete)
        if old_circuits:
            print(f"   cleared {len(old_circuits)} prior circuits", flush=True)
        seed_circuits(full_dcs, sites, providers)
        print("Done (circuits only).", flush=True)
        return

    dcs = [d for d in full_dcs if d["code"].upper() in ONLY_SITES] if ONLY_SITES else full_dcs
    roles, types_by_role, type_by_slug, providers = seed_reference()
    sites = {}
    for dc in dcs:
        sites[dc["code"]] = seed_site(dc, roles, types_by_role, type_by_slug)
    if SKIP_CIRCUITS:
        print("(circuits skipped)", flush=True)
    else:
        seed_circuits(dcs, sites, providers)
    print("Done.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
