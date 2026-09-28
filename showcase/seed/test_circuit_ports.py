#!/usr/bin/env python3
"""Tests for circuit_ports.py — the circuit-end -> core WAN port planner.

Pure stdlib, no pytest needed: run `python3 test_circuit_ports.py`.
"""
import json
import os
import re
from collections import Counter

import circuit_ports as cp

_DATA = os.path.join(os.path.dirname(__file__), "data", "datacenters.json")
SUBSET = ("IAD1", "AMS1", "SIN1", "MIA1")  # the Infrahub seed's default ONLY_SITES
TYPE_BY_RATE = {
    10_000_000: "10gbase-x-sfpp",
    100_000_000: "100gbase-x-qsfp28",
    400_000_000: "400gbase-x-qsfpdd",
}


def _ring(only=None):
    """The seeds' inter-DC ring (hops 1, 2, 7; 10/100/400G mix) over datacenters.json."""
    with open(_DATA) as f:
        codes = [d["code"] for d in json.load(f) if not only or d["code"] in only]
    out, seq = [], 0
    for i, a in enumerate(codes):
        for hop in (1, 2, 7):
            z = codes[(i + hop) % len(codes)]
            seq += 1
            rate = 400_000_000 if hop == 7 else 10_000_000 if hop == 2 and seq % 2 == 0 else 100_000_000
            out.append({"cid": f"P-{a}-{z}-{seq:03d}", "a_site": a, "z_site": z, "commit_rate_kbps": rate})
    return out


def test_ring_fixture_seed_mix_20_30_10():
    rates = Counter(c["commit_rate_kbps"] for c in _ring())
    assert rates == {400_000_000: 20, 100_000_000: 30, 10_000_000: 10}, rates


def test_plan_circuit_ports_full_ring_one_port_per_end():
    assert len(cp.plan_circuit_ports(_ring())) == 120


def test_plan_circuit_ports_full_ring_ports_unique():
    ports = cp.plan_circuit_ports(_ring())
    assert len({(p["device"], p["iface"]) for p in ports}) == len(ports) == 120


def test_plan_circuit_ports_full_ring_one_a_one_z_on_own_cores():
    ring = _ring()
    by_cid = {}
    for p in cp.plan_circuit_ports(ring):
        by_cid.setdefault(p["cid"], []).append(p)
    assert len(by_cid) == len(ring) == 60
    for c in ring:
        ends = {p["side"]: p for p in by_cid[c["cid"]]}
        assert len(by_cid[c["cid"]]) == 2 and set(ends) == {"A", "Z"}, c["cid"]
        for side, site in (("A", c["a_site"]), ("Z", c["z_site"])):
            assert ends[side]["site"] == site, ends[side]
            assert ends[side]["device"] in (f"{site}-core-01", f"{site}-core-02"), ends[side]


def test_plan_circuit_ports_full_ring_types_follow_rate():
    rate = {c["cid"]: c["commit_rate_kbps"] for c in _ring()}
    ports = cp.plan_circuit_ports(_ring())
    for p in ports:
        assert p["type"] == TYPE_BY_RATE[rate[p["cid"]]], p
    assert Counter(p["type"] for p in ports) == {
        "400gbase-x-qsfpdd": 40, "100gbase-x-qsfp28": 60, "10gbase-x-sfpp": 20}


def test_plan_circuit_ports_full_ring_three_ports_per_core_from_zero():
    by_dev = {}
    for p in cp.plan_circuit_ports(_ring()):
        by_dev.setdefault(p["device"], []).append(p["iface"])
    assert len(by_dev) == 40, sorted(by_dev)  # 20 sites x 2 cores, balanced
    for dev, ifaces in by_dev.items():
        assert sorted(ifaces) == ["et-0/0/0", "et-0/0/1", "et-0/0/2"], (dev, ifaces)


def test_plan_circuit_ports_reversed_input_same_plan():
    ring = _ring()
    assert cp.plan_circuit_ports(ring) == cp.plan_circuit_ports(list(reversed(ring)))


def test_plan_circuit_ports_infrahub_subset_24_balanced_ports():
    ring = _ring(SUBSET)
    ports = cp.plan_circuit_ports(ring)
    assert len(ring) == 12 and len(ports) == 24
    assert len({(p["device"], p["iface"]) for p in ports}) == 24
    assert set(Counter(p["device"] for p in ports).values()) == {3}


def test_plan_circuit_ports_empty_input_empty_plan():
    assert cp.plan_circuit_ports([]) == []


def test_port_type_tiers_capacity_equals_commit_rate():
    # the telemetry simulator derives capacity_bps from the leading "<n>gbase",
    # so a WAN port's line rate must equal its circuit's commit rate
    for kbps, t in TYPE_BY_RATE.items():
        assert cp.port_type(kbps) == t
        assert int(re.match(r"(\d+)gbase", t).group(1)) * 1_000_000 == kbps, t


def test_port_type_odd_or_unknown_rate_rounds_up():
    assert cp.port_type(None) == "10gbase-x-sfpp"
    assert cp.port_type(1_000_000) == "10gbase-x-sfpp"
    assert cp.port_type(40_000_000) == "100gbase-x-qsfp28"
    assert cp.port_type(800_000_000) == "400gbase-x-qsfpdd"


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
