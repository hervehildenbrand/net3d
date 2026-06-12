#!/usr/bin/env python3
"""Seed the net3d showcase NetBox with an anonymous, hyperscale global fabric.

20 real datacenters (compute DCs + smaller PoPs) x up to 50 racks, packed with
servers + ToR (leaf) switches, per-rack OOB switches feeding OOB aggregation
switches in the network racks, spine switches + core routers wired in a
spine-leaf fabric, and inter-DC circuits (10G/100G/400G commit rates) from a
curated list of real transit providers. Server hardware specs live as custom
fields on the device types; a deterministic ~4%% of servers are offline/planned.

Idempotent: top-level objects are get-or-created by slug; a site whose racks
already exist is skipped, so the script is safe to re-run / resume.

Tunable via env:
  NETBOX_URL (default http://localhost:8088)
  NETBOX_TOKEN (default the showcase superuser token)
  SERVER_RACKS=46  SERVERS_PER_RACK=18
  SPINES_PER_DC=8  CORES_PER_DC=2  SPINE_UPLINKS=4
  SERVER_CABLING=sample|full|none (default sample)  SERVER_CABLING_SAMPLE=4
  ONLY_SITES=IAD1,FRA1  (comma list; default all)
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import pynetbox
import urllib3

urllib3.disable_warnings()

URL = os.environ.get("NETBOX_URL", "http://localhost:8088")
TOKEN = os.environ.get("NETBOX_TOKEN", "abcdef0123456789abcdef0123456789abcdef01")
DATA = Path(__file__).parent / "data"

SERVER_RACKS = int(os.environ.get("SERVER_RACKS", "46"))
SERVERS_PER_RACK = int(os.environ.get("SERVERS_PER_RACK", "18"))
NETWORK_RACKS = int(os.environ.get("NETWORK_RACKS", "4"))
SPINES_PER_DC = int(os.environ.get("SPINES_PER_DC", "8"))
CORES_PER_DC = int(os.environ.get("CORES_PER_DC", "2"))
SPINE_UPLINKS = int(os.environ.get("SPINE_UPLINKS", "4"))
SERVER_CABLING = os.environ.get("SERVER_CABLING", "sample")  # sample|full|none
SERVER_CABLING_SAMPLE = int(os.environ.get("SERVER_CABLING_SAMPLE", "4"))
ONLY_SITES = {s.strip().upper() for s in os.environ.get("ONLY_SITES", "").split(",") if s.strip()}

RACK_HEIGHT = 42
ROLE_COLORS = {
    "server": "2196f3", "leaf": "4caf50", "spine": "ff9800", "core": "9c27b0",
    "oob": "607d8b",
}
SITE_TAGS = {"compute": "2196f3", "pop": "ff5722"}
OOB_AGGS = 2
OOB_SWITCH_POS = 40  # below leaf-2 (U41) / leaf-1 (U42)

# DeviceType custom fields carrying server hardware specs (keys match
# the `specs` blocks in device_types.json).
SPEC_CUSTOM_FIELDS = [
    {"name": "cpu_model", "label": "CPU model", "type": "text"},
    {"name": "cpu_cores", "label": "CPU cores", "type": "integer"},
    {"name": "ram_gb", "label": "RAM (GB)", "type": "integer"},
    {"name": "storage_tb", "label": "Storage (TB)", "type": "decimal"},
]

# Deterministic non-active sprinkling for servers (per-site counter).
def server_status(idx: int) -> str:
    if idx % 30 == 0:
        return "offline"
    if idx % 50 == 0:
        return "planned"
    return "active"

nb = pynetbox.api(URL, token=TOKEN)
nb.http_session.verify = False


def load(name: str):
    return json.loads((DATA / name).read_text())


def goc(endpoint, slug_field: str, data: dict):
    """Get-or-create an object by a unique field (usually slug)."""
    existing = endpoint.get(**{slug_field: data[slug_field]})
    if existing:
        return existing
    return endpoint.create(data)


def chunked(seq, n=200):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def bulk_create(endpoint, specs):
    """Bulk-create in batches; return the flat list of created records."""
    out = []
    for batch in chunked(specs):
        if batch:
            res = endpoint.create(batch)
            out.extend(res if isinstance(res, list) else [res])
    return out


# ---------------------------------------------------------------------------
# Reference data (regions, manufacturers, roles, device types, providers)
# ---------------------------------------------------------------------------
def seed_custom_fields():
    """DeviceType custom fields holding server hardware specs."""
    for cf in SPEC_CUSTOM_FIELDS:
        spec = {**cf, "required": False}
        try:
            goc(nb.extras.custom_fields, "name", {**spec, "object_types": ["dcim.devicetype"]})
        except Exception:
            # NetBox < 4.0 calls the field content_types
            goc(nb.extras.custom_fields, "name", {**spec, "content_types": ["dcim.devicetype"]})


def seed_reference():
    print("== reference data ==", flush=True)
    regions = {}
    for slug, name in [("amer", "Americas"), ("emea", "EMEA"), ("apac", "APAC")]:
        regions[slug] = goc(nb.dcim.regions, "slug", {"name": name, "slug": slug})

    roles = {}
    for slug, color in ROLE_COLORS.items():
        roles[slug] = goc(
            nb.dcim.device_roles,
            "slug",
            {"name": slug.upper() if slug == "oob" else slug.capitalize(), "slug": slug, "color": color},
        )

    tags = {}
    for slug, color in SITE_TAGS.items():
        tags[slug] = goc(
            nb.extras.tags,
            "slug",
            {"name": slug.capitalize() if slug == "compute" else slug.upper(), "slug": slug, "color": color},
        )

    seed_custom_fields()

    manufacturers = {}
    device_types = load("device_types.json")
    types_by_role = defaultdict(list)
    for dt in device_types:
        man = dt["manufacturer"]
        if man not in manufacturers:
            manufacturers[man] = goc(
                nb.dcim.manufacturers,
                "slug",
                {"name": man, "slug": man.lower().replace(" ", "-")},
            )
        rec = goc(
            nb.dcim.device_types,
            "slug",
            {
                "manufacturer": manufacturers[man].id,
                "model": dt["model"],
                "slug": dt["slug"],
                "u_height": dt["u_height"],
                "is_full_depth": dt["is_full_depth"],
            },
        )
        specs = dt.get("specs")
        if specs and not (rec.custom_fields or {}).get("cpu_model"):
            rec.update({"custom_fields": specs})
        rec._u_height = dt["u_height"]
        types_by_role[dt["role"]].append(rec)

    providers = []
    for p in load("providers.json"):
        providers.append(goc(nb.circuits.providers, "slug", p))
    ctype = goc(nb.circuits.circuit_types, "slug", {"name": "Transport", "slug": "transport"})

    return regions, roles, types_by_role, providers, ctype, tags


# ---------------------------------------------------------------------------
# Per-site fabric
# ---------------------------------------------------------------------------
def seed_site(dc, regions, roles, types_by_role, tags):
    code = dc["code"]
    srv_racks = int(dc.get("server_racks", SERVER_RACKS))
    role_tag = tags[dc.get("role", "compute")]
    site = goc(
        nb.dcim.sites,
        "slug",
        {
            "name": code,
            "slug": code.lower(),
            "status": "active",
            "region": regions[dc["region"]].id,
            "latitude": dc["latitude"],
            "longitude": dc["longitude"],
            "description": f"{dc['name']} ({dc['region'].upper()})",
            "physical_address": dc.get("address", ""),
            "facility": dc.get("facility", ""),
            "tags": [role_tag.id],
        },
    )

    if len(list(nb.dcim.racks.filter(site_id=site.id))) >= srv_racks + NETWORK_RACKS:
        print(f"   {code}: racks already present — skipping", flush=True)
        return site

    print(f"== {code} ({dc['name']}) ==", flush=True)

    # locations + racks
    halls = {}
    for hall in ["server-hall-1", "server-hall-2", "network-core"]:
        halls[hall] = goc(
            nb.dcim.locations,
            "slug",
            {"name": hall, "slug": f"{code.lower()}-{hall}", "site": site.id},
        )

    rack_specs = []
    for i in range(1, srv_racks + 1):
        hall = "server-hall-1" if i <= srv_racks // 2 else "server-hall-2"
        rack_specs.append(
            {"name": f"{code}-SRV-{i:02d}", "site": site.id, "location": halls[hall].id,
             "u_height": RACK_HEIGHT, "status": "active"}
        )
    for i in range(1, NETWORK_RACKS + 1):
        rack_specs.append(
            {"name": f"{code}-NET-{i:02d}", "site": site.id, "location": halls["network-core"].id,
             "u_height": RACK_HEIGHT, "status": "active"}
        )
    racks = {r.name: r for r in bulk_create(nb.dcim.racks, rack_specs)}

    server_types = types_by_role["server"]
    leaf_type = types_by_role["leaf"][0]
    spine_type = types_by_role["spine"][0]
    core_type = types_by_role["core"][0]
    oob_type = types_by_role["oob"][0]
    oob_agg_type = types_by_role["oob-agg"][0]

    # device specs
    dev_specs = []
    leaf_names, spine_names, core_names = [], [], []
    oob_by_rack = {}  # SRV rack name -> oob switch name
    oob_agg_names = []
    server_names_by_rack = defaultdict(list)
    server_seq = 0  # per-site counter driving deterministic status sprinkling

    def dev(name, dtype, role, rack_id, pos, face="front", status="active"):
        dev_specs.append({
            "name": name, "device_type": dtype.id, "role": roles[role].id,
            "site": site.id, "rack": rack_id, "position": pos, "face": face, "status": status,
        })

    for i in range(1, srv_racks + 1):
        rname = f"{code}-SRV-{i:02d}"
        rid = racks[rname].id
        # ToR leaf switches at the top of the rack
        for li in (1, 2):
            ln = f"{code}-SRV-{i:02d}-leaf-{li}"
            dev(ln, leaf_type, "leaf", rid, RACK_HEIGHT - (li - 1))
            leaf_names.append(ln)
        # per-rack OOB access switch just below the leafs
        on = f"{code}-SRV-{i:02d}-oob"
        dev(on, oob_type, "oob", rid, OOB_SWITCH_POS)
        oob_by_rack[rname] = on
        # servers from the bottom up (stay below the OOB switch)
        u = 1
        for s in range(SERVERS_PER_RACK):
            dt = server_types[s % len(server_types)]
            if u + dt._u_height - 1 >= OOB_SWITCH_POS:
                break
            sn = f"{code}-SRV-{i:02d}-srv-{s + 1:02d}"
            server_seq += 1
            dev(sn, dt, "server", rid, u, status=server_status(server_seq))
            server_names_by_rack[rname].append(sn)
            u += dt._u_height

    for i in range(SPINES_PER_DC):
        rname = f"{code}-NET-{(i // 2) % NETWORK_RACKS + 1:02d}"
        sn = f"{code}-spine-{i + 1:02d}"
        dev(sn, spine_type, "spine", racks[rname].id, 30 + (i % 2) * 2)
        spine_names.append(sn)
    for c in range(CORES_PER_DC):
        cn = f"{code}-core-{c + 1:02d}"
        dev(cn, core_type, "core", racks[f"{code}-NET-01"].id, 1 + c * 6)
        core_names.append(cn)
    # OOB aggregation switches in the first network racks
    for a in range(OOB_AGGS):
        an = f"{code}-oob-agg-{a + 1}"
        rname = f"{code}-NET-{(a % NETWORK_RACKS) + 1:02d}"
        dev(an, oob_agg_type, "oob", racks[rname].id, 20)
        oob_agg_names.append(an)

    devices = {d.name: d for d in bulk_create(nb.dcim.devices, dev_specs)}
    print(f"   {len(devices)} devices", flush=True)

    # cabling plan: collect interfaces per device, then the cables between them
    ifaces = defaultdict(dict)  # device_name -> {iface_name: type}
    plan = []  # (a_dev, a_if, b_dev, b_if, cable_type)

    def link(a_dev, a_if, a_type, b_dev, b_if, b_type, ctype):
        ifaces[a_dev][a_if] = a_type
        ifaces[b_dev][b_if] = b_type
        plan.append((a_dev, a_if, b_dev, b_if, ctype))

    # leaf -> spine uplinks (spine-leaf fabric)
    for li, leaf in enumerate(leaf_names):
        for u in range(SPINE_UPLINKS):
            spine = spine_names[(li * SPINE_UPLINKS + u) % len(spine_names)]
            link(leaf, f"Ethernet{u + 1}", "100gbase-x-qsfp28",
                 spine, f"leaf{li + 1}-{u + 1}", "100gbase-x-qsfp28", "smf")
    # spine -> core uplinks
    for si, spine in enumerate(spine_names):
        for c in range(CORES_PER_DC):
            core = core_names[c % len(core_names)]
            link(spine, f"Core{c + 1}", "100gbase-x-qsfp28",
                 core, f"spine{si + 1}-{c + 1}", "100gbase-x-qsfp28", "smf")
    # server -> ToR access (configurable density): redundant eth0/eth1 to the
    # rack's two leafs, plus mgmt0 to the rack OOB switch
    if SERVER_CABLING != "none":
        for i in range(1, srv_racks + 1):
            rname = f"{code}-SRV-{i:02d}"
            oob = oob_by_rack[rname]
            servers = server_names_by_rack[rname]
            if SERVER_CABLING == "sample":
                servers = servers[:SERVER_CABLING_SAMPLE]
            for sn in servers:
                num = sn.split("-")[-1]
                for li in (1, 2):
                    leaf = f"{code}-SRV-{i:02d}-leaf-{li}"
                    link(sn, f"eth{li - 1}", "25gbase-x-sfp28",
                         leaf, f"Server-{num}", "25gbase-x-sfp28", "cat6a")
                link(sn, "mgmt0", "1000base-t",
                     oob, f"Server-{num}", "1000base-t", "cat6a")

    # OOB management network: rack OOB switches uplink to both aggs; leafs
    # manage via their rack OOB switch, spines/cores via an agg directly
    for i in range(1, srv_racks + 1):
        rname = f"{code}-SRV-{i:02d}"
        oob = oob_by_rack[rname]
        for a, agg in enumerate(oob_agg_names):
            link(oob, f"TenGig{a + 1}", "10gbase-x-sfpp",
                 agg, f"Rack-{i:02d}", "10gbase-x-sfpp", "mmf")
        for li in (1, 2):
            link(f"{code}-SRV-{i:02d}-leaf-{li}", "mgmt0", "1000base-t",
                 oob, f"Leaf-{li}", "1000base-t", "cat6a")
    for di, dn in enumerate(spine_names + core_names):
        agg = oob_agg_names[di % len(oob_agg_names)]
        link(dn, "mgmt0", "1000base-t",
             agg, f"Mgmt-{dn.removeprefix(code + '-')}", "1000base-t", "cat6a")

    # create interfaces in bulk, then resolve (device_id, name) -> id
    iface_specs = [
        {"device": devices[dn].id, "name": name, "type": t}
        for dn, ports in ifaces.items() for name, t in ports.items()
    ]
    created = bulk_create(nb.dcim.interfaces, iface_specs)
    iface_id = {(rec.device.id, rec.name): rec.id for rec in created}
    print(f"   {len(created)} interfaces", flush=True)

    cable_specs = []
    for a_dev, a_if, b_dev, b_if, ctype in plan:
        aid = iface_id[(devices[a_dev].id, a_if)]
        bid = iface_id[(devices[b_dev].id, b_if)]
        cable_specs.append({
            "a_terminations": [{"object_type": "dcim.interface", "object_id": aid}],
            "b_terminations": [{"object_type": "dcim.interface", "object_id": bid}],
            "status": "connected", "type": ctype,
        })
    cables = bulk_create(nb.dcim.cables, cable_specs)
    print(f"   {len(cables)} cables", flush=True)
    return site


# ---------------------------------------------------------------------------
# Inter-DC circuits
# ---------------------------------------------------------------------------
def add_termination(circuit, term_side, site, port_speed):
    """Create a circuit termination, handling 4.x scope vs legacy `site` field."""
    speeds = {"port_speed": port_speed, "upstream_speed": port_speed}
    try:
        return nb.circuits.circuit_terminations.create({
            "circuit": circuit.id, "term_side": term_side,
            "termination_type": "dcim.site", "termination_id": site.id, **speeds,
        })
    except Exception:
        return nb.circuits.circuit_terminations.create({
            "circuit": circuit.id, "term_side": term_side, "site": site.id, **speeds,
        })


def circuit_rate_kbps(hop: int, seq: int) -> int:
    """Deterministic 10G/100G/400G mix: long-haul 400G, ring 100G with some 10G."""
    if hop == 7:
        return 400_000_000
    if hop == 2 and seq % 2 == 0:
        return 10_000_000
    return 100_000_000


def seed_circuits(dcs, sites, providers, ctype):
    print("== inter-DC circuits ==", flush=True)
    n = len(dcs)
    seq = 0
    made = 0
    for i in range(n):
        for hop in (1, 2, 7):  # near neighbours + a long-haul link
            j = (i + hop) % n
            if j == i:
                continue
            a, z = dcs[i]["code"], dcs[j]["code"]
            provider = providers[seq % len(providers)]
            seq += 1
            rate = circuit_rate_kbps(hop, seq)
            cid = f"{provider.slug.upper()}-{a}-{z}-{seq:03d}"
            description = f"{a} <-> {z} transport via {provider.name} ({rate // 1_000_000}G)"
            existing = nb.circuits.circuits.get(cid=cid)
            if existing:
                if not existing.commit_rate:
                    existing.update({"commit_rate": rate, "description": description})
                continue
            circuit = nb.circuits.circuits.create({
                "cid": cid, "provider": provider.id, "type": ctype.id, "status": "active",
                "commit_rate": rate, "description": description,
            })
            add_termination(circuit, "A", sites[a], rate)
            add_termination(circuit, "Z", sites[z], rate)
            made += 1
    print(f"   {made} circuits", flush=True)


def main():
    print(f"Seeding {URL}", flush=True)
    dcs = load("datacenters.json")
    if ONLY_SITES:
        dcs = [d for d in dcs if d["code"].upper() in ONLY_SITES]
    regions, roles, types_by_role, providers, ctype, tags = seed_reference()
    sites = {}
    for dc in dcs:
        sites[dc["code"]] = seed_site(dc, regions, roles, types_by_role, tags)
    seed_circuits(dcs, sites, providers, ctype)
    print("Done.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
