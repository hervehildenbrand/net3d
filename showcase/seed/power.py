#!/usr/bin/env python3
"""Deterministic A/B redundant power topology for the showcase.

Every device is dual-corded to two vertical PDUs (one per power feed, A & B);
network spines carry 4 PSUs (2 to each side). The chain modelled in NetBox is:

    site power panel (A|B)  ->  per-rack power feed (A|B)
        ->  vertical PDU (0U device, A|B)  ->  device PSU power port

Assignment is a pure function of a rack's device list so the seeder and the
one-shot migration that retro-fits an already-seeded instance always agree.

Pure stdlib — safe to import from both seed.py and a urllib-only migration.
"""
from __future__ import annotations

SPINE_PSU = 4
DEFAULT_PSU = 2

# NetBox device role for the vertical PDUs (amber, matching the power cable hue).
PDU_ROLE = {"slug": "pdu", "name": "PDU", "color": "b45309"}

# 0U vertical rack PDU device type (also carried in data/device_types.json so a
# fresh seed creates it; repeated here so the migration can get-or-create it too).
PDU_DEVICE_TYPE = {
    "role": "pdu",
    "manufacturer": "APC",
    "model": "Rack PDU AP8853",
    "slug": "apc-ap8853",
    "u_height": 0,
    "is_full_depth": False,
}

# Per-rack three-phase feed electrical characteristics (A = primary, B = redundant).
FEED_ELECTRICAL = {
    "supply": "ac",
    "phase": "three-phase",
    "voltage": 415,
    "amperage": 32,
    "max_utilization": 80,
}

# Connector types for the modelled power ports/outlets (C13/C14 IEC kettle leads).
PSU_PORT_TYPE = "iec-60320-c14"
OUTLET_TYPE = "iec-60320-c13"


def needs_power(role: str) -> bool:
    """PDUs are the power source, not a powered device — everything else is dual-fed."""
    return role != PDU_ROLE["slug"]


def psu_count(role: str) -> int:
    return SPINE_PSU if role == "spine" else DEFAULT_PSU


def psu_names(role: str) -> list[str]:
    return [f"PSU{i + 1}" for i in range(psu_count(role))]


def feed_side(role: str, psu_index: int) -> str:
    """Balanced split: the first half of a device's PSUs feed A, the rest B."""
    return "A" if psu_index < psu_count(role) // 2 else "B"


def feed_type(side: str) -> str:
    return "primary" if side == "A" else "redundant"


def pdu_name(rack: str, side: str) -> str:
    return f"{rack}-pdu-{side}"


def feed_name(rack: str, side: str) -> str:
    return f"{rack}-feed-{side}"


def panel_name(site: str, side: str) -> str:
    return f"{site}-PWR-{side}"


def pdu_names(rack: str) -> tuple[str, str]:
    return (pdu_name(rack, "A"), pdu_name(rack, "B"))


def feed_names(rack: str) -> tuple[str, str]:
    return (feed_name(rack, "A"), feed_name(rack, "B"))


def panel_names(site: str) -> tuple[str, str]:
    return (panel_name(site, "A"), panel_name(site, "B"))


def plan_rack_power(devices: list[tuple[str, str]]) -> list[dict]:
    """One cord per device PSU for a single rack.

    `devices` is [(name, role)] for the rack's powered devices (PDUs excluded).
    Returns ordered cords: each {device, psu, side, outlet} where `outlet` is the
    1-based outlet index on that side's PDU (contiguous, unique per side).
    """
    cords: list[dict] = []
    outlet_seq = {"A": 0, "B": 0}
    for name, role in devices:
        for i, psu in enumerate(psu_names(role)):
            side = feed_side(role, i)
            outlet_seq[side] += 1
            cords.append({"device": name, "psu": psu, "side": side, "outlet": outlet_seq[side]})
    return cords


def outlets_per_side(devices: list[tuple[str, str]]) -> dict[str, int]:
    """Number of outlets each side's PDU needs to serve the rack's devices."""
    counts = {"A": 0, "B": 0}
    for c in plan_rack_power(devices):
        counts[c["side"]] += 1
    return counts
