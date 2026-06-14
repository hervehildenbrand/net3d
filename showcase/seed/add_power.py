#!/usr/bin/env python3
"""Apply the A/B power topology to a NetBox showcase instance (idempotent).

Builds, per site, the full power chain on top of the already-seeded fabric:

    power panel A/B  ->  per-rack feed A/B  ->  vertical PDU A/B (0U device)
        ->  outlet  ->  device PSU power port

Every device is dual-corded (spines 4-corded, 2 per side). Re-runnable: every
object is get-or-created and every cable is skipped when either end is already
connected, so a killed run resumes and a second run is a no-op.

This is the single power applier — seed.py imports `apply_power` for the
fresh-seed path; running this file applies power to an existing instance.

Stdlib urllib only + power.py (the shared topology source of truth). HTTP must
run through an allowed path (e.g. context-mode ctx_execute).

Env: NETBOX_URL (default http://localhost:8088), NETBOX_TOKEN (default showcase),
     ONLY_SITES=AMS1,FRA1 (comma list; default all).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections import defaultdict

import power

URL = os.environ.get("NETBOX_URL", "http://localhost:8088").rstrip("/")
TOKEN = os.environ.get("NETBOX_TOKEN", "abcdef0123456789abcdef0123456789abcdef01")
BATCH = 200


def _req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        URL + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Token " + TOKEN,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:600]}")


def _get_all(path):
    """GET every page of a list endpoint."""
    out = []
    sep = "&" if "?" in path else "?"
    offset = 0
    while True:
        page = _req("GET", f"{path}{sep}limit=500&offset={offset}")
        out.extend(page["results"])
        if not page.get("next"):
            break
        offset += 500
    return out


def _create_many(path, specs):
    """Bulk-create in batches; return the flat list of created records."""
    out = []
    for i in range(0, len(specs), BATCH):
        batch = specs[i : i + BATCH]
        if not batch:
            continue
        res = _req("POST", path, batch)
        out.extend(res if isinstance(res, list) else [res])
    return out


def _occupied(obj) -> bool:
    return bool(obj.get("cable")) or obj.get("_occupied", False)


def ensure_reference():
    """Get-or-create the PDU role, manufacturer and 0U device type. Returns ids."""
    r = _req("GET", f"/api/dcim/device-roles/?slug={power.PDU_ROLE['slug']}")
    if r["count"]:
        role_id = r["results"][0]["id"]
    else:
        role_id = _req("POST", "/api/dcim/device-roles/", power.PDU_ROLE)["id"]

    dt = power.PDU_DEVICE_TYPE
    man_slug = dt["manufacturer"].lower().replace(" ", "-")
    m = _req("GET", f"/api/dcim/manufacturers/?slug={man_slug}")
    man_id = (
        m["results"][0]["id"]
        if m["count"]
        else _req("POST", "/api/dcim/manufacturers/", {"name": dt["manufacturer"], "slug": man_slug})["id"]
    )
    t = _req("GET", f"/api/dcim/device-types/?slug={dt['slug']}")
    if t["count"]:
        type_id = t["results"][0]["id"]
    else:
        type_id = _req(
            "POST",
            "/api/dcim/device-types/",
            {
                "manufacturer": man_id,
                "model": dt["model"],
                "slug": dt["slug"],
                "u_height": dt["u_height"],
                "is_full_depth": dt["is_full_depth"],
            },
        )["id"]
    return role_id, type_id


def _site_power(site, role_id, type_id):
    sid, code = site["id"], site["name"]
    racks = {r["name"]: r["id"] for r in _get_all(f"/api/dcim/racks/?site_id={sid}")}
    if not racks:
        return 0

    # all devices in the site, grouped by rack (powered devices only, PDUs excluded)
    devices = _get_all(f"/api/dcim/devices/?site_id={sid}")
    dev_id = {d["name"]: d["id"] for d in devices}
    rack_name_by_id = {rid: name for name, rid in racks.items()}
    by_rack: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for d in devices:
        role = (d.get("role") or d.get("device_role") or {}).get("slug")
        rack = d.get("rack")
        if not role or not rack or not power.needs_power(role):
            continue
        rname = rack_name_by_id.get(rack["id"])
        if rname:
            by_rack[rname].append((d["name"], role))
    for rname in by_rack:
        by_rack[rname].sort()  # stable order -> deterministic outlet numbering

    # 1) two site power panels (A/B)
    panels = {p["name"]: p["id"] for p in _get_all(f"/api/dcim/power-panels/?site_id={sid}")}
    panel_id = {}
    for side in ("A", "B"):
        name = power.panel_name(code, side)
        panel_id[side] = panels.get(name) or _req(
            "POST", "/api/dcim/power-panels/", {"site": sid, "name": name}
        )["id"]

    # 2) per-rack feeds (A/B) — get-or-create by name; track occupancy of the feed end
    feeds = {f["name"]: f for f in _get_all(f"/api/dcim/power-feeds/?site_id={sid}")}
    feed_specs = []
    for rname, rid in racks.items():
        for side in ("A", "B"):
            name = power.feed_name(rname, side)
            if name not in feeds:
                feed_specs.append(
                    {
                        "power_panel": panel_id[side],
                        "rack": rid,
                        "name": name,
                        "status": "active",
                        "type": power.feed_type(side),
                        **power.FEED_ELECTRICAL,
                    }
                )
    for rec in _create_many("/api/dcim/power-feeds/", feed_specs):
        feeds[rec["name"]] = rec

    # 3) two PDU devices (A/B) per rack (0U: no position/face)
    pdu_specs = []
    for rname, rid in racks.items():
        for side in ("A", "B"):
            name = power.pdu_name(rname, side)
            if name not in dev_id:
                pdu_specs.append(
                    {"name": name, "device_type": type_id, "role": role_id,
                     "site": sid, "rack": rid, "status": "active"}
                )
    for rec in _create_many("/api/dcim/devices/", pdu_specs):
        dev_id[rec["name"]] = rec["id"]

    # 4/5) power ports (device PSUs + PDU inputs) and PDU outlets
    ports = {(p["device"]["id"], p["name"]): p for p in _get_all(f"/api/dcim/power-ports/?site_id={sid}")}
    outlets = {(o["device"]["id"], o["name"]): o for o in _get_all(f"/api/dcim/power-outlets/?site_id={sid}")}

    port_specs, outlet_specs = [], []
    for rname in racks:
        devs = by_rack.get(rname, [])
        # device PSU ports
        for name, role in devs:
            for psu in power.psu_names(role):
                if (dev_id[name], psu) not in ports:
                    port_specs.append({"device": dev_id[name], "name": psu, "type": power.PSU_PORT_TYPE})
        # PDU input ports + outlets
        per_side = power.outlets_per_side(devs)
        for side in ("A", "B"):
            pdu = dev_id[power.pdu_name(rname, side)]
            if (pdu, "Input") not in ports:
                port_specs.append({"device": pdu, "name": "Input", "type": power.PSU_PORT_TYPE})
            for k in range(1, per_side[side] + 1):
                oname = f"Outlet-{k}"
                if (pdu, oname) not in outlets:
                    outlet_specs.append({"device": pdu, "name": oname, "type": power.OUTLET_TYPE})
    for rec in _create_many("/api/dcim/power-ports/", port_specs):
        ports[(rec["device"]["id"], rec["name"])] = rec
    for rec in _create_many("/api/dcim/power-outlets/", outlet_specs):
        outlets[(rec["device"]["id"], rec["name"])] = rec

    # 6) cables — skip any whose either end is already connected
    cable_specs = []

    def cable(a_type, a_id, b_type, b_id):
        cable_specs.append(
            {
                "a_terminations": [{"object_type": a_type, "object_id": a_id}],
                "b_terminations": [{"object_type": b_type, "object_id": b_id}],
                "status": "connected",
            }
        )

    for rname in racks:
        devs = by_rack.get(rname, [])
        # device PSU -> PDU outlet
        for cord in power.plan_rack_power(devs):
            psu = ports.get((dev_id[cord["device"]], cord["psu"]))
            pdu = dev_id[power.pdu_name(rname, cord["side"])]
            outlet = outlets.get((pdu, f"Outlet-{cord['outlet']}"))
            if psu and outlet and not _occupied(psu) and not _occupied(outlet):
                cable("dcim.powerport", psu["id"], "dcim.poweroutlet", outlet["id"])
        # PDU input -> rack feed
        for side in ("A", "B"):
            pdu = dev_id[power.pdu_name(rname, side)]
            inp = ports.get((pdu, "Input"))
            feed = feeds.get(power.feed_name(rname, side))
            if inp and feed and not _occupied(inp) and not _occupied(feed):
                cable("dcim.powerport", inp["id"], "dcim.powerfeed", feed["id"])

    created = _create_many("/api/dcim/cables/", cable_specs)
    print(
        f"   {code}: {len(racks)} racks, {len(pdu_specs)} new PDUs, "
        f"{len(feed_specs)} new feeds, {len(port_specs)} ports, "
        f"{len(outlet_specs)} outlets, {len(created)} cables",
        flush=True,
    )
    return len(created)


def apply_power(base_url=None, token=None, only_sites=None):
    """Idempotently apply the power chain. Returns total power cables created."""
    global URL, TOKEN
    if base_url:
        URL = base_url.rstrip("/")
    if token:
        TOKEN = token
    only = {s.strip().upper() for s in (only_sites or []) if s and s.strip()}

    role_id, type_id = ensure_reference()
    sites = _get_all("/api/dcim/sites/")
    if only:
        sites = [s for s in sites if s["name"].upper() in only]
    print(f"== power: {len(sites)} sites ==", flush=True)
    total = 0
    for site in sites:
        total += _site_power(site, role_id, type_id)
    print(f"Done. {total} power cables created.", flush=True)
    return total


if __name__ == "__main__":
    only = [s for s in os.environ.get("ONLY_SITES", "").split(",") if s.strip()]
    apply_power(only_sites=only)
