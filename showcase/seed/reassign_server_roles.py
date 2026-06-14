#!/usr/bin/env python3
"""One-shot: re-tag already-seeded showcase servers into the 7 functional roles.

Avoids a full re-seed. Idempotent and re-runnable: ensures the roles exist
(get-or-create by slug, syncing name+color), then bulk-PATCHes every
'{CODE}-SRV-{nn}-srv-{NN}' device to server_role(rack_index, server_index).
Selection is by name pattern (parse_server_name) so it does not depend on the
device's current role — safe to run again after it has already applied.

Stdlib urllib only + server_roles.py (the single source of truth shared with
seed.py). HTTP must run through an allowed path (e.g. context-mode ctx_execute).

Env: NETBOX_URL (default http://localhost:8088), NETBOX_TOKEN (default showcase).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections import Counter

from server_roles import SERVER_ROLE_DEFS, parse_server_name, server_role

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
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:400]}")


def ensure_roles():
    """Get-or-create the 7 server roles, syncing name+color. Returns slug -> id."""
    ids = {}
    for d in SERVER_ROLE_DEFS:
        res = _req("GET", f"/api/dcim/device-roles/?slug={d['slug']}")
        if res["count"]:
            rec = res["results"][0]
            if rec.get("color") != d["color"] or rec.get("name") != d["name"]:
                _req("PATCH", f"/api/dcim/device-roles/{rec['id']}/",
                     {"name": d["name"], "color": d["color"]})
            ids[d["slug"]] = rec["id"]
        else:
            rec = _req("POST", "/api/dcim/device-roles/",
                       {"name": d["name"], "slug": d["slug"], "color": d["color"]})
            ids[d["slug"]] = rec["id"]
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
    role_ids = ensure_roles()
    print("roles ready:", role_ids)

    devices = fetch_all_devices()
    updates, plan = [], Counter()
    for d in devices:
        parsed = parse_server_name(d["name"])
        if not parsed:
            continue
        slug = server_role(*parsed)
        updates.append({"id": d["id"], "role": role_ids[slug]})
        plan[slug] += 1
    print(f"total devices {len(devices)}, server devices {len(updates)}")
    print("planned per role:", dict(plan))

    done = 0
    for i in range(0, len(updates), BATCH):
        batch = updates[i:i + BATCH]
        _req("PATCH", "/api/dcim/devices/", batch)
        done += len(batch)
    print(f"patched {done} devices")
    return done


if __name__ == "__main__":
    main()
