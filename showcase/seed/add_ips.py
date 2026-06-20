#!/usr/bin/env python3
"""Assign each device a primary IPv4 on a NetBox showcase instance (idempotent).

Per site, addresses are laid out into a few /24s so net3d's subnet coloring reads
as an L3 segmentation:

    10.<site_idx>.10.0/24      network fabric (leaf/spine/core/oob/oob-agg)
    10.<site_idx>.20+.0/24     servers, spilling to the next /24 every 250 hosts

Each address is bound to the device's mgmt0 interface and set as primary_ip4.
Re-runnable: devices that already carry a primary_ip4 are skipped, so a second
run is a no-op and a killed run resumes.

Run: ./.venv/bin/python add_ips.py

Env: NETBOX_URL (default http://localhost:8088), NETBOX_TOKEN (default showcase),
     ONLY_SITES=AMS1,FRA1 (comma list; default all).
"""
from __future__ import annotations

import os

import pynetbox
import urllib3

urllib3.disable_warnings()

URL = os.environ.get("NETBOX_URL", "http://localhost:8088")
TOKEN = os.environ.get("NETBOX_TOKEN", "abcdef0123456789abcdef0123456789abcdef01")
ONLY = {s for s in os.environ.get("ONLY_SITES", "").split(",") if s}
NET_ROLES = {"leaf", "spine", "core", "oob", "oob-agg"}

nb = pynetbox.api(URL, token=TOKEN)
nb.http_session.verify = False


def chunks(seq, n=200):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def assign_site(site, idx: int) -> int:
    devices = list(nb.dcim.devices.filter(site_id=site.id))
    ifaces = {i.device.id: i.id for i in nb.dcim.interfaces.filter(site_id=site.id, name="mgmt0")}
    specs, net_h, srv_n = [], 1, 0
    for d in devices:
        if d.primary_ip4:  # idempotent
            continue
        role = d.role.slug if d.role else ""
        if role == "pdu":
            continue
        ifid = ifaces.get(d.id)
        if not ifid:
            continue
        if role in NET_ROLES:
            addr = f"10.{idx}.10.{net_h}/24"; net_h += 1
        else:
            addr = f"10.{idx}.{20 + srv_n // 250}.{srv_n % 250 + 1}/24"; srv_n += 1
        specs.append((d.id, addr, ifid))
    if not specs:
        return 0
    updates = []
    for b in chunks(specs):
        recs = nb.ipam.ip_addresses.create(
            [{"address": a, "assigned_object_type": "dcim.interface", "assigned_object_id": ifid, "status": "active"}
             for (_, a, ifid) in b]
        )
        for k, r in enumerate(recs):
            updates.append({"id": b[k][0], "primary_ip4": r.id})
    for b in chunks(updates):
        nb.dcim.devices.update(b)
    return len(updates)


def main():
    sites = sorted(nb.dcim.sites.all(), key=lambda s: s.slug)
    for idx, site in enumerate(sites):
        if ONLY and site.name not in ONLY:
            continue
        print(f"{site.name}: assigned {assign_site(site, idx)} primary IPs", flush=True)


if __name__ == "__main__":
    main()
