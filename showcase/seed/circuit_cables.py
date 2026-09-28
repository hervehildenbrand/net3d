#!/usr/bin/env python3
"""Cable every inter-DC circuit termination to a core-router WAN port (idempotent).

Circuits stay site-terminated (that is what draws the map arcs); each end also
gets one DIRECT cable to its planned port from circuit_ports.py, so live
telemetry on that port can colour the arc and the room DC link. Direct only:
a patch panel in between would hide the router port from net3d's circuit join.

Re-runnable: WAN interfaces are diffed by (device, name) and an end is skipped
when its port or its termination already has a cable, so a second run creates
nothing. seed.py imports apply_circuit_cables for the fresh-seed path; running
this file cables an already-seeded instance.

Env: NETBOX_URL (default http://localhost:8088), NETBOX_TOKEN (default showcase).
"""
from __future__ import annotations

from urllib.parse import urlencode

import add_power as api  # reuse its urllib REST helpers: same env, same retries
from circuit_ports import plan_circuit_ports


def apply_circuit_cables(base_url: str | None = None, token: str | None = None) -> int:
    """Idempotently cable circuit ends to core WAN ports. Returns cables created."""
    if base_url:
        api.URL = base_url.rstrip("/")
    if token:
        api.TOKEN = token

    rate = {c["cid"]: c["commit_rate"] for c in api._get_all("/api/circuits/circuits/")}
    terms = {
        (t["circuit"]["cid"], t["term_side"]): t
        for t in api._get_all("/api/circuits/circuit-terminations/")
        if t.get("termination_type") == "dcim.site" and t.get("termination")
    }
    circuits = [
        {"cid": cid, "a_site": terms[(cid, "A")]["termination"]["name"],
         "z_site": terms[(cid, "Z")]["termination"]["name"], "commit_rate_kbps": r}
        for cid, r in rate.items() if (cid, "A") in terms and (cid, "Z") in terms
    ]
    cores = {d["name"]: d["id"] for d in api._get_all("/api/dcim/devices/?role=core")}
    ports = [p for p in plan_circuit_ports(circuits) if p["device"] in cores]
    print(f"== circuit cables: {len(circuits)} circuits, {len(ports)} ends ==", flush=True)
    if not ports:
        return 0

    query = urlencode([("device_id", i) for i in sorted(cores.values())])
    ifaces = {(i["device"]["id"], i["name"]): i for i in api._get_all(f"/api/dcim/interfaces/?{query}")}
    iface_specs = [
        {"device": cores[p["device"]], "name": p["iface"], "type": p["type"]}
        for p in ports if (cores[p["device"]], p["iface"]) not in ifaces
    ]
    for rec in api._create_many("/api/dcim/interfaces/", iface_specs):
        ifaces[(rec["device"]["id"], rec["name"])] = rec

    # ponytail: ports are re-planned from the current circuit set and existing
    # cables are kept, so changing that set later (e.g. an ONLY_SITES seed) can
    # leave some ends uncabled — delete the circuit cables and re-run if so.
    cable_specs = []
    for p in ports:
        iface = ifaces[(cores[p["device"]], p["iface"])]
        term = terms[(p["cid"], p["side"])]
        if not api._occupied(iface) and not api._occupied(term):
            cable_specs.append({
                "a_terminations": [{"object_type": "dcim.interface", "object_id": iface["id"]}],
                "b_terminations": [{"object_type": "circuits.circuittermination", "object_id": term["id"]}],
                "status": "connected", "type": "smf",
            })
    created = api._create_many("/api/dcim/cables/", cable_specs)
    print(f"   {len(iface_specs)} new WAN interfaces, {len(created)} new circuit cables", flush=True)
    return len(created)


if __name__ == "__main__":
    apply_circuit_cables()
