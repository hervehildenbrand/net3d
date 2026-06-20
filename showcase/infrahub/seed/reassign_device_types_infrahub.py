#!/usr/bin/env python3
"""One-shot: repoint already-seeded Infrahub servers to role-appropriate device types.

The Infrahub mirror of showcase/seed/reassign_device_types.py. Specs live on the
DcimDeviceType, so giving each server role its own type is what makes a rack's primary
function show up as its capacity in the room-view heatmap. Avoids a full re-seed:
upserts the 7 server device types, then upserts every '{CODE}-SRV-{nn}-srv-{NN}' device
with just {name, device_type} — DcimDevice's HFID is name, so this updates the type
relationship in place and leaves position/role/site/rack untouched. Idempotent.

Reuses seed_infrahub's client + upsert/batch helpers (same env + retry behaviour).
Run: ./.venv/bin/python seed/reassign_device_types_infrahub.py
Env: INFRAHUB_ADDRESS, INFRAHUB_API_TOKEN (defaults = showcase).
"""
from __future__ import annotations

from collections import Counter

from seed_infrahub import _retry, batch_upsert, client, load, upsert
from server_roles import parse_server_name, server_device_type_slug, server_role


def ensure_device_types() -> dict:
    """Upsert the server device types (specs as attributes); returns slug -> id."""
    manufacturers: dict = {}
    ids: dict = {}
    for dt in load("device_types.json"):
        if dt["role"] != "server":
            continue
        man = dt["manufacturer"]
        if man not in manufacturers:
            manufacturers[man] = upsert("DcimManufacturer", {"name": man}).id
        data = {
            "model": dt["model"],
            "u_height": dt["u_height"],
            "is_full_depth": dt["is_full_depth"],
            "manufacturer": manufacturers[man],
        }
        for k in ("cpu_model", "cpu_cores", "ram_gb", "storage_tb", "power_draw_w"):
            if dt.get("specs", {}).get(k) is not None:
                # storage_tb is Text (decimal); the rest are ints/text as-is.
                data[k] = str(dt["specs"][k]) if k == "storage_tb" else dt["specs"][k]
        ids[dt["slug"]] = upsert("DcimDeviceType", data).id
    return ids


def fetch_devices() -> list:
    """All DcimDevice (id, name) via paginated GraphQL."""
    out, offset, page = [], 0, 1000
    while True:
        q = (f"{{ DcimDevice(limit: {page}, offset: {offset}) "
             f"{{ edges {{ node {{ id name {{ value }} }} }} }} }}")
        data = _retry(lambda q=q: client.execute_graphql(query=q))
        edges = data["DcimDevice"]["edges"]
        out.extend((e["node"]["id"], e["node"]["name"]["value"]) for e in edges)
        if len(edges) < page:
            break
        offset += page
    return out


def main():
    type_ids = ensure_device_types()
    print("device types ready:", type_ids, flush=True)

    devices = fetch_devices()
    specs, plan = [], Counter()
    for _id, name in devices:
        parsed = parse_server_name(name)
        if not parsed:
            continue
        slug = server_device_type_slug(server_role(*parsed))
        specs.append(("DcimDevice", {"name": name, "device_type": type_ids[slug]}))
        plan[slug] += 1
    print(f"total devices {len(devices)}, server devices {len(specs)}", flush=True)
    print("planned per device type:", dict(plan), flush=True)

    batch_upsert(specs)
    print(f"upserted {len(specs)} devices", flush=True)


if __name__ == "__main__":
    main()
