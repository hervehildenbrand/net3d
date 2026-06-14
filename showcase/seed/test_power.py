#!/usr/bin/env python3
"""Tests for power.py — the deterministic A/B power topology planner.

Pure stdlib, no pytest needed: run `python3 test_power.py`.
"""
from collections import Counter

import power as p

HEX = set("0123456789abcdefABCDEF")

# A representative server rack: ToR leaves + OOB + a mix of servers (PDUs excluded).
SRV_RACK = [
    ("AMS1-SRV-01-leaf-1", "leaf"),
    ("AMS1-SRV-01-leaf-2", "leaf"),
    ("AMS1-SRV-01-oob", "oob"),
    ("AMS1-SRV-01-srv-01", "esx-server"),
    ("AMS1-SRV-01-srv-02", "db-server"),
    ("AMS1-SRV-01-srv-03", "gpu-server"),
]
# A network rack: spines (4 PSU) + a core router (2 PSU).
NET_RACK = [
    ("AMS1-spine-01", "spine"),
    ("AMS1-spine-02", "spine"),
    ("AMS1-core-01", "core"),
]


def test_psu_count_spine_is_four_others_two():
    assert p.psu_count("spine") == 4
    for role in ("server", "esx-server", "leaf", "oob", "core", "db-server"):
        assert p.psu_count(role) == 2, role


def test_psu_names_match_count_and_are_ordered():
    assert p.psu_names("leaf") == ["PSU1", "PSU2"]
    assert p.psu_names("spine") == ["PSU1", "PSU2", "PSU3", "PSU4"]


def test_feed_side_splits_balanced_first_half_a_second_half_b():
    # 2-PSU device: PSU1->A, PSU2->B
    assert [p.feed_side("leaf", i) for i in range(2)] == ["A", "B"]
    # spine (4-PSU): PSU1,2 -> A ; PSU3,4 -> B
    assert [p.feed_side("spine", i) for i in range(4)] == ["A", "A", "B", "B"]


def test_every_device_is_dual_fed():
    # each device must land at least one cord on A and one on B (redundancy)
    for rack in (SRV_RACK, NET_RACK):
        cords = p.plan_rack_power(rack)
        by_device = {}
        for c in cords:
            by_device.setdefault(c["device"], set()).add(c["side"])
        for name, _role in rack:
            assert by_device[name] == {"A", "B"}, name


def test_plan_has_one_cord_per_device_psu():
    cords = p.plan_rack_power(NET_RACK)
    assert len(cords) == sum(p.psu_count(role) for _n, role in NET_RACK)
    per_device = Counter(c["device"] for c in cords)
    assert per_device["AMS1-spine-01"] == 4
    assert per_device["AMS1-core-01"] == 2


def test_outlet_numbers_are_contiguous_and_unique_per_side():
    cords = p.plan_rack_power(SRV_RACK)
    for side in ("A", "B"):
        outlets = sorted(c["outlet"] for c in cords if c["side"] == side)
        assert outlets == list(range(1, len(outlets) + 1)), (side, outlets)


def test_plan_is_deterministic():
    assert p.plan_rack_power(SRV_RACK) == p.plan_rack_power(SRV_RACK)


def test_naming_helpers():
    assert p.pdu_names("AMS1-SRV-01") == ("AMS1-SRV-01-pdu-A", "AMS1-SRV-01-pdu-B")
    assert p.feed_names("AMS1-SRV-01") == ("AMS1-SRV-01-feed-A", "AMS1-SRV-01-feed-B")
    assert p.panel_names("AMS1") == ("AMS1-PWR-A", "AMS1-PWR-B")
    assert p.pdu_name("AMS1-SRV-01", "B") == "AMS1-SRV-01-pdu-B"
    assert p.feed_name("AMS1-SRV-01", "A") == "AMS1-SRV-01-feed-A"
    assert p.panel_name("AMS1", "B") == "AMS1-PWR-B"


def test_pdu_role_definition_shape():
    assert p.PDU_ROLE["slug"] == "pdu"
    c = p.PDU_ROLE["color"]
    assert len(c) == 6 and all(ch in HEX for ch in c) and not c.startswith("#")


def test_pdu_device_type_is_zero_u():
    dt = p.PDU_DEVICE_TYPE
    assert dt["role"] == "pdu"
    assert dt["u_height"] == 0
    assert dt["is_full_depth"] is False
    assert dt["slug"]


def test_feed_electrical_shape():
    e = p.FEED_ELECTRICAL
    assert e["supply"] == "ac"
    assert e["phase"] in ("single-phase", "three-phase")
    assert isinstance(e["voltage"], int) and e["voltage"] > 0
    assert isinstance(e["amperage"], int) and e["amperage"] > 0
    assert 0 < e["max_utilization"] <= 100


def test_feed_type_per_side():
    assert p.feed_type("A") == "primary"
    assert p.feed_type("B") == "redundant"


def test_needs_power_excludes_pdus():
    assert p.needs_power("server") is True
    assert p.needs_power("spine") is True
    assert p.needs_power("pdu") is False


def test_outlets_per_side_counts_match_plan():
    counts = p.outlets_per_side(SRV_RACK)
    cords = p.plan_rack_power(SRV_RACK)
    assert counts["A"] == sum(1 for c in cords if c["side"] == "A")
    assert counts["B"] == sum(1 for c in cords if c["side"] == "B")


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
