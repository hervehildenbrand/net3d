#!/usr/bin/env python3
"""Tests for server_roles.py — the deterministic server-role taxonomy + assignment.

Pure stdlib, no pytest needed: run `python3 test_server_roles.py`.
"""
import json
import os
from collections import Counter

import server_roles as sr

_DATA = os.path.join(os.path.dirname(__file__), "data", "device_types.json")


def _server_device_types():
    with open(_DATA) as f:
        return [d for d in json.load(f) if d["role"] == "server"]

EXPECTED_SLUGS = {
    "esx-server", "baremetal-server", "db-server", "storage-server",
    "k8s-worker", "cache-server", "gpu-server",
}
ROLES = {d["slug"] for d in sr.SERVER_ROLE_DEFS}
HEX = set("0123456789abcdefABCDEF")


def test_defs_shape():
    slugs = [d["slug"] for d in sr.SERVER_ROLE_DEFS]
    assert len(slugs) == 7, slugs
    assert set(slugs) == EXPECTED_SLUGS, set(slugs) ^ EXPECTED_SLUGS
    for d in sr.SERVER_ROLE_DEFS:
        assert {"slug", "name", "color", "weight"} <= set(d), d
        assert len(d["color"]) == 6 and all(c in HEX for c in d["color"]), d
        assert not d["color"].startswith("#"), d
        assert d["weight"] >= 1, d
    # every color distinct so the legend swatches never collide
    assert len({d["color"] for d in sr.SERVER_ROLE_DEFS}) == 7


def test_returns_only_valid_roles():
    for r in range(60):
        for s in range(20):
            assert sr.server_role(r, s) in ROLES


def test_is_deterministic():
    assert sr.server_role(5, 9) == sr.server_role(5, 9)
    assert sr.server_role(0, 0) == sr.server_role(0, 0)


def test_primary_dominates_each_rack():
    # Each rack is dominated by its PRIMARY_PATTERN role (realistic hybrid: a
    # clear majority of one function plus a minority mix).
    for r in range(len(sr.PRIMARY_PATTERN)):
        counts = Counter(sr.server_role(r, s) for s in range(18))
        top, top_n = counts.most_common(1)[0]
        assert top == sr.PRIMARY_PATTERN[r % len(sr.PRIMARY_PATTERN)], (r, counts)
        assert top_n >= 11, (r, counts)  # >60% of 18 servers


def test_all_roles_appear_across_a_site():
    seen = set()
    for r in range(46):          # AMS1-sized site
        for s in range(18):
            seen.add(sr.server_role(r, s))
    assert seen == ROLES, ROLES - seen


def test_clustered_roles_are_more_dominant():
    # storage/db racks are more single-purpose than general compute racks.
    def dominance(slug):
        r = sr.PRIMARY_PATTERN.index(slug)
        return Counter(sr.server_role(r, s) for s in range(18))[slug]
    assert dominance("storage-server") >= dominance("esx-server")
    assert dominance("db-server") >= dominance("baremetal-server")


def test_every_role_maps_to_a_real_server_device_type():
    slugs = {d["slug"] for d in _server_device_types()}
    for role in ROLES:
        dt = sr.server_device_type_slug(role)
        assert dt in slugs, (role, dt, slugs)


def test_spec_mapping_is_diverse_so_racks_differ():
    # the whole point: distinct roles -> distinct hardware, so a rack's primary
    # function shows up as its capacity in the room-view heatmap.
    mapped = {sr.server_device_type_slug(r) for r in ROLES}
    assert len(mapped) >= 5, mapped


def test_mapped_types_all_carry_full_specs():
    by_slug = {d["slug"]: d for d in _server_device_types()}
    for role in ROLES:
        specs = by_slug[sr.server_device_type_slug(role)].get("specs", {})
        assert specs.get("cpu_cores") and specs.get("ram_gb") and specs.get("storage_tb"), (role, specs)


def test_server_device_types_have_distinct_specs():
    # every server device type is a distinct (cpu,ram,storage) profile, so the
    # heatmap actually separates them.
    profiles = {
        (d["specs"]["cpu_cores"], d["specs"]["ram_gb"], d["specs"]["storage_tb"])
        for d in _server_device_types()
    }
    assert len(profiles) == len(_server_device_types()), "duplicate server spec profiles"


def test_unknown_role_falls_back_to_a_valid_server_type():
    slugs = {d["slug"] for d in _server_device_types()}
    assert sr.server_device_type_slug("does-not-exist") in slugs


def test_parse_server_name():
    assert sr.parse_server_name("AMS1-SRV-03-srv-07") == (2, 6)
    assert sr.parse_server_name("FRA1-SRV-46-srv-18") == (45, 17)
    assert sr.parse_server_name("AMS1-SRV-01-leaf-1") is None
    assert sr.parse_server_name("AMS1-spine-01") is None
    assert sr.parse_server_name("AMS1-SRV-01-oob") is None


if __name__ == "__main__":
    import sys
    import traceback

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in tests:
        try:
            fn()
            print("PASS", fn.__name__)
            passed += 1
        except Exception:
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"\n{passed}/{len(tests)} passed")
    sys.exit(0 if passed == len(tests) else 1)
