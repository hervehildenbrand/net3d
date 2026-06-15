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
from collections import defaultdict
from pathlib import Path

from infrahub_sdk import Config, InfrahubClientSync

# Reuse the NetBox showcase's generation helpers + data fixtures.
NB_SEED = Path(__file__).resolve().parents[2] / "seed"  # showcase/seed
sys.path.insert(0, str(NB_SEED))
from server_roles import SERVER_ROLE_DEFS, server_role  # noqa: E402
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


client = InfrahubClientSync(address=ADDR, config=Config(api_token=TOKEN))


def upsert(kind: str, data: dict):
    obj = client.create(kind=kind, data=data)
    obj.save(allow_upsert=True)
    return obj


def batch_upsert(specs: list[tuple[str, dict]]):
    """Create+save a list of (kind, data) via a concurrent batch; return saved nodes."""
    batch = client.create_batch()
    nodes = []
    for kind, data in specs:
        node = client.create(kind=kind, data=data)
        nodes.append(node)
        batch.add(task=node.save, node=node, allow_upsert=True)
    saved = []
    for node, _ in batch.execute():
        saved.append(node)
    return saved


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
        for k in ("cpu_model", "cpu_cores", "ram_gb", "storage_tb"):
            if dt.get("specs", {}).get(k) is not None:
                data[k] = dt["specs"][k]
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
        "latitude": dc["latitude"],
        "longitude": dc["longitude"],
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

    server_types = types_by_role["server"]
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
            dt = server_types[s % len(server_types)]
            if u + dt._u_height - 1 >= OOB_SWITCH_POS:
                break
            sn = f"{code}-SRV-{i:02d}-srv-{s + 1:02d}"
            server_seq += 1
            dev(sn, dt, server_role(i - 1, s), rname, u, status=server_status(server_seq))
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

    cable_specs = []
    for a_dev, a_if, b_dev, b_if, ctype in plan:
        aid = iface_id[(devices[a_dev].id, a_if)]
        bid = iface_id[(devices[b_dev].id, b_if)]
        cable_specs.append(("DcimCable", {
            "status": "connected", "cable_type": ctype, "endpoint_a": aid, "endpoint_b": bid,
        }))
    batch_upsert(cable_specs)
    print(f"   {len(cable_specs)} cables", flush=True)

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
    dcs = [d for d in load("datacenters.json") if d["code"].upper() in ONLY_SITES] if ONLY_SITES else load("datacenters.json")
    roles, types_by_role, type_by_slug, providers = seed_reference()
    sites = {}
    for dc in dcs:
        sites[dc["code"]] = seed_site(dc, roles, types_by_role, type_by_slug)
    seed_circuits(dcs, sites, providers)
    print("Done.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
