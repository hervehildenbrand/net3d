#!/usr/bin/env python3
"""One-shot: repoint already-seeded showcase servers to role-appropriate device types.

Server hardware specs live on the device TYPE (custom fields cpu_model/cpu_cores/
ram_gb/storage_tb), so giving each server role its own device type is what makes a
rack's primary function show up as its capacity in the room-view heatmap. Avoids a
full re-seed: ensures the 7 server device types exist (get-or-create by slug, with
specs + u_height), then bulk-PATCHes every '{CODE}-SRV-{nn}-srv-{NN}' device to the
type for server_device_type_slug(server_role(rack, server)).

Idempotent and re-runnable; selection is by name pattern so it does not depend on the
device's current type. Stdlib urllib only + server_roles.py + data/device_types.json
(the single sources of truth shared with seed.py). HTTP must run through an allowed
path (e.g. context-mode ctx_execute).

Env: NETBOX_URL (default http://localhost:8088), NETBOX_TOKEN (default showcase).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections import Counter

from server_roles import parse_server_name, server_role, server_device_type_slug

URL = os.environ.get("NETBOX_URL", "http://localhost:8088").rstrip("/")
TOKEN = os.environ.get("NETBOX_TOKEN", "abcdef0123456789abcdef0123456789abcdef01")
BATCH = 200
_HERE = os.path.dirname(__file__)

SPEC_KEYS = ("cpu_model", "cpu_cores", "ram_gb", "storage_tb")


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
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:400]}")


def _server_device_types():
    with open(os.path.join(_HERE, "data", "device_types.json")) as f:
        return [d for d in json.load(f) if d["role"] == "server"]


def ensure_manufacturer(name):
    slug = name.lower().replace(" ", "-")
    res = _req("GET", f"/api/dcim/manufacturers/?slug={slug}")
    if res["count"]:
        return res["results"][0]["id"]
    return _req("POST", "/api/dcim/manufacturers/", {"name": name, "slug": slug})["id"]


def ensure_device_types():
    """Get-or-create the server device types, syncing specs/u_height. slug -> id."""
    ids = {}
    for dt in _server_device_types():
        man_id = ensure_manufacturer(dt["manufacturer"])
        body = {
            "manufacturer": man_id,
            "model": dt["model"],
            "slug": dt["slug"],
            "u_height": dt["u_height"],
            "is_full_depth": dt["is_full_depth"],
            "custom_fields": dt.get("specs", {}),
        }
        res = _req("GET", f"/api/dcim/device-types/?slug={dt['slug']}")
        if res["count"]:
            rec = res["results"][0]
            _req("PATCH", f"/api/dcim/device-types/{rec['id']}/", body)
            ids[dt["slug"]] = rec["id"]
        else:
            ids[dt["slug"]] = _req("POST", "/api/dcim/device-types/", body)["id"]
    return ids


def fetch_all_devices():
    out, offset = [], 0
    while True:
        page = _req("GET", f"/api/dcim/devices/?brief=1&limit=500&offset={offset}")
        out.extend({"id": d["id"], "name": d["name"]} for d in page["results"])
        if not page.get("next"):
            break
        offset += 500
    return out


def main():
    type_ids = ensure_device_types()
    print("device types ready:", type_ids)

    devices = fetch_all_devices()
    updates, plan = [], Counter()
    for d in devices:
        parsed = parse_server_name(d["name"])
        if not parsed:
            continue
        slug = server_device_type_slug(server_role(*parsed))
        updates.append({"id": d["id"], "device_type": type_ids[slug]})
        plan[slug] += 1
    print(f"total devices {len(devices)}, server devices {len(updates)}")
    print("planned per device type:", dict(plan))

    done = 0
    for i in range(0, len(updates), BATCH):
        _req("PATCH", "/api/dcim/devices/", updates[i:i + BATCH])
        done += len(updates[i:i + BATCH])
    print(f"patched {done} devices")
    return done


if __name__ == "__main__":
    main()
