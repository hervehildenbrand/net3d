#!/usr/bin/env python3
"""Deterministic WAN-port plan for cabling inter-DC circuits to core routers.

Each circuit end gets its own physical port on one of its site's two core
routers ({SITE}-core-01 / -02), named Juniper-style et-0/0/N and typed by the
circuit's commit rate, so a live port's utilisation (rate / port capacity)
reads as the circuit's. Per site, ends sort by (cid, side) and alternate
core-01 / core-02; each core numbers its ports from et-0/0/0.

Pure stdlib — shared by the NetBox (circuit_cables.py) and Infrahub seeds.
"""
from __future__ import annotations

from collections import defaultdict

# ponytail: two cores per site (the seeds' CORES_PER_DC default); ends planned
# onto a core that doesn't exist are skipped by the appliers.
CORES = ("core-01", "core-02")


def port_type(commit_rate_kbps: int | None) -> str:
    """Interface type for a circuit rate; in-between rates round up (the map's tiers)."""
    if not commit_rate_kbps or commit_rate_kbps <= 10_000_000:
        return "10gbase-x-sfpp"
    if commit_rate_kbps <= 100_000_000:
        return "100gbase-x-qsfp28"
    return "400gbase-x-qsfpdd"


def plan_circuit_ports(circuits: list[dict]) -> list[dict]:
    """One port per circuit end.

    `circuits` is [{cid, a_site, z_site, commit_rate_kbps}]. Returns
    [{site, device, iface, type, cid, side}], ordered by site.
    """
    ends: dict[str, list[tuple[str, str, int | None]]] = defaultdict(list)
    for c in circuits:
        ends[c["a_site"]].append((c["cid"], "A", c["commit_rate_kbps"]))
        ends[c["z_site"]].append((c["cid"], "Z", c["commit_rate_kbps"]))
    ports = []
    for site in sorted(ends):
        for i, (cid, side, rate) in enumerate(sorted(ends[site], key=lambda e: e[:2])):
            ports.append({
                "site": site, "device": f"{site}-{CORES[i % 2]}", "iface": f"et-0/0/{i // 2}",
                "type": port_type(rate), "cid": cid, "side": side,
            })
    return ports
