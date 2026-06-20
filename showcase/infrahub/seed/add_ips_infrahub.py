#!/usr/bin/env python3
"""Assign each Infrahub device a primary IPv4 (idempotent) — the Infrahub mirror of
showcase/seed/add_ips.py.

net3d's subnet overlay derives an L3 segmentation from each device's primary IP. In
Infrahub `DcimDevice.primary_ip` is a plain Text attribute (no IPAM model), so this just
sets that string; there are no IPAddress/interface objects to create. Addresses follow the
SAME per-site /24 layout as the NetBox seeder, so the subnet coloring reads identically on
both backends:

    10.<site_idx>.10.0/24      network fabric (leaf/spine/core/oob/oob-agg)
    10.<site_idx>.20+.0/24     servers, spilling to the next /24 every 250 hosts

`site_idx` is the site's rank in the canonical datacenter list sorted by lowercased code
(datacenters.json) — the same ordering NetBox uses (its site slug is `code.lower()`), so
e.g. AMS1 → index 0 → 10.0.10.x / 10.0.20.x on both backends.

Site and role are derived from the device NAME (the convention the rest of the seed relies
on: `{CODE}-...`, servers `{CODE}-SRV-{rack}-srv-{nn}`, PDUs `...-pdu-{A|B}`), so no
relationship query is needed. PDUs are the power source, not a powered device → skipped.
(Unlike NetBox's add_ips.py, every non-PDU device gets an address — Infrahub's primary_ip
has no mgmt0-interface dependency — but the per-site /24 *set* is identical, which is what
the subnet coloring keys on.)

Assignment is positional within each site (devices sorted by name), so a given device
always computes the same address: the run is idempotent and resumable. Devices that already
carry a primary_ip are left untouched.

Fetches and writes ONE SITE AT A TIME (filtered by the single-hop site relationship) so a
full mirror never scans all ~17k devices in one query — that overruns the Neo4j connection.
Transient DB hiccups are retried with backoff.

Run:  ./.venv/bin/python seed/add_ips_infrahub.py
Env:  INFRAHUB_ADDRESS, INFRAHUB_API_TOKEN (defaults = showcase, via seed_infrahub),
      ONLY_SITES=AMS1,FRA1 (comma list; default all),
      DRY_RUN=1 (print the plan, write nothing).
"""
from __future__ import annotations

import os
import time
from collections import defaultdict

# seed_infrahub puts showcase/seed on sys.path (for server_roles/power) and builds the
# shared Infrahub client + helpers; import it first so those imports resolve.
from seed_infrahub import batch_upsert, client, load
from server_roles import parse_server_name

ONLY = {s.strip().upper() for s in os.environ.get("ONLY_SITES", "").split(",") if s.strip()}
DRY_RUN = os.environ.get("DRY_RUN", "") in ("1", "true")

# Canonical site ordering — matches NetBox add_ips.py (sites sorted by slug == code.lower()).
SITE_IDX = {
    code.upper(): i
    for i, code in enumerate(sorted((d["code"] for d in load("datacenters.json")), key=str.lower))
}


def site_of(name: str) -> str:
    """Site code prefix of a device name (e.g. 'AMS1-SRV-01-srv-01' -> 'AMS1')."""
    return name.split("-", 1)[0].upper()


def device_class(name: str) -> str:
    """'pdu' (skip), 'server', or 'fabric' — from the name convention."""
    if name.endswith(("-pdu-A", "-pdu-B")):
        return "pdu"
    if parse_server_name(name):
        return "server"
    return "fabric"


def resilient(fn, tries: int = 6):
    """Retry on any transient error (server unresponsive / defunct DB connection) with
    backoff; re-raise on the final attempt so real errors still surface."""
    for i in range(tries):
        try:
            return fn()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))
    raise RuntimeError("unreachable")


def fetch_site_devices(code: str) -> list[tuple[str, str | None]]:
    """One site's DcimDevice as [(name, primary_ip)] via the single-hop site filter."""
    out: list[tuple[str, str | None]] = []
    offset, page = 0, 500
    while True:
        q = (f'{{ DcimDevice(site__name__value: "{code}", limit: {page}, offset: {offset}) '
             f'{{ edges {{ node {{ name {{ value }} primary_ip {{ value }} }} }} }} }}')
        data = resilient(lambda q=q: client.execute_graphql(query=q))
        edges = data["DcimDevice"]["edges"]
        for e in edges:
            n = e["node"]
            out.append((n["name"]["value"], (n.get("primary_ip") or {}).get("value")))
        if len(edges) < page:
            break
        offset += page
    return out


def plan_addresses(devices: list[tuple[str, str | None]]) -> dict[str, tuple[str, str | None]]:
    """name -> (address, current_ip). Positional per-site assignment (sorted by name):
    fabric into 10.<idx>.10.0/24, servers into 10.<idx>.20+.0/24."""
    by_site: dict[str, list[tuple[str, str | None]]] = defaultdict(list)
    for name, cur in devices:
        if device_class(name) == "pdu":
            continue
        code = site_of(name)
        if ONLY and code not in ONLY:
            continue
        if code not in SITE_IDX:
            print(f"   ! unknown site for {name}, skipped", flush=True)
            continue
        by_site[code].append((name, cur))

    planned: dict[str, tuple[str, str | None]] = {}
    for code, members in by_site.items():
        idx = SITE_IDX[code]
        members.sort(key=lambda m: m[0])  # deterministic order
        net_h, srv_n = 1, 0
        for name, cur in members:
            if device_class(name) == "server":
                addr = f"10.{idx}.{20 + srv_n // 250}.{srv_n % 250 + 1}/24"
                srv_n += 1
            else:
                addr = f"10.{idx}.10.{net_h}/24"
                net_h += 1
            planned[name] = (addr, cur)
    return planned


def main():
    targets = sorted(c for c in SITE_IDX if not ONLY or c in ONLY)
    grand = 0
    for code in targets:
        planned = plan_addresses(fetch_site_devices(code))
        specs, new, skip = [], 0, 0
        for name, (addr, cur) in planned.items():
            if cur:  # already has a primary IP — idempotent skip
                skip += 1
                continue
            new += 1
            specs.append(("DcimDevice", {"name": name, "primary_ip": addr}))
        sample = next((a for n, (a, c) in planned.items() if not c), "-")
        print(f"{code} (idx {SITE_IDX[code]}): {new} to assign, {skip} already set, "
              f"{len(planned)} placed (e.g. {sample})", flush=True)
        if specs and not DRY_RUN:
            resilient(lambda specs=specs: batch_upsert(specs))
        grand += new
    verb = "would be assigned (no writes)" if DRY_RUN else "assigned"
    print(f"{'DRY_RUN: ' if DRY_RUN else ''}{grand} primary IPs {verb}.", flush=True)


if __name__ == "__main__":
    main()
