#!/usr/bin/env python3
"""Server-role taxonomy + deterministic per-device assignment for the showcase.

The fleet's servers are split into functional roles (database, virtualization,
bare-metal, storage, kubernetes, cache, GPU/ML) instead of one generic "Server".
Assignment is a pure function of (rack_index, server_index) so the seeder and the
one-shot migration that re-tags an already-seeded instance always agree.

Distribution = "realistic hybrid": each server rack has a PRIMARY function (a
weighted round-robin over the racks) that the majority of its servers take, plus
a deterministic minority mix of the other roles. Storage/DB racks are more
single-purpose (smaller minority) than general compute racks.

Pure stdlib — safe to import from both seed.py and a urllib-only migration.
"""
from __future__ import annotations

import re

# slug, display name, NetBox color (6-hex, no '#'), fleet weight (~ share of racks
# that are PRIMARILY this function). Colors are chosen distinct from each other and
# from the network roles (leaf 4caf50, spine ff9800, core 9c27b0, oob 607d8b).
SERVER_ROLE_DEFS = [
    {"slug": "esx-server",       "name": "ESX Host",   "color": "00bcd4", "weight": 6},
    {"slug": "baremetal-server", "name": "Bare-metal", "color": "795548", "weight": 5},
    {"slug": "k8s-worker",       "name": "K8s Worker", "color": "3f51b5", "weight": 4},
    {"slug": "db-server",        "name": "Database",   "color": "e91e63", "weight": 3},
    {"slug": "storage-server",   "name": "Storage",    "color": "fbc02d", "weight": 3},
    {"slug": "cache-server",     "name": "Cache",      "color": "f4511e", "weight": 2},
    {"slug": "gpu-server",       "name": "GPU / ML",   "color": "aa00ff", "weight": 1},
]

# Racks that are extra single-purpose (a smaller minority mix than compute racks).
_CLUSTERED = {"storage-server", "db-server"}

# Each server role maps to a device-type slug (defined in data/device_types.json)
# whose hardware specs fit the role. Specs live on the device TYPE, so assigning the
# type by role is what makes a rack's primary function show up as its capacity in the
# room-view heatmap. Keep these slugs in sync with the "server" entries of that file.
ROLE_DEVICE_TYPE = {
    "gpu-server":       "supermicro-as1115gs-h100",
    "db-server":        "dell-poweredge-r660-db",
    "esx-server":       "dell-poweredge-r660-esx",
    "k8s-worker":       "hpe-proliant-dl360-k8s",
    "baremetal-server": "dell-poweredge-r650-bm",
    "storage-server":   "dell-poweredge-r660-stor",
    "cache-server":     "hpe-proliant-dl325-cache",
}

_FALLBACK_DEVICE_TYPE = "dell-poweredge-r650-bm"


def server_device_type_slug(role_slug: str) -> str:
    """Device-type slug for a server role. Specs live on the type, so this is how a
    role gets role-appropriate hardware; unknown roles fall back to the bare-metal box."""
    return ROLE_DEVICE_TYPE.get(role_slug, _FALLBACK_DEVICE_TYPE)


_NAME_RE = re.compile(r"^[A-Za-z0-9]+-SRV-(\d+)-srv-(\d+)$")


def _build_primary_pattern(defs):
    """Smooth weighted round-robin: a length=sum(weights) cycle of rack primaries,
    interleaved so the heavy roles are spread out rather than clumped."""
    weights = [(d["slug"], d["weight"]) for d in defs]
    total = sum(w for _, w in weights)
    current = {s: 0 for s, _ in weights}
    pattern = []
    for _ in range(total):
        for s, w in weights:
            current[s] += w
        # max() returns the first maximal element -> deterministic given defs order
        best = max(weights, key=lambda sw: current[sw[0]])[0]
        current[best] -= total
        pattern.append(best)
    return pattern


PRIMARY_PATTERN = _build_primary_pattern(SERVER_ROLE_DEFS)


def server_role(rack_index: int, server_index: int) -> str:
    """Role slug for the server at (0-based rack_index, 0-based server_index)."""
    primary = PRIMARY_PATTERN[rack_index % len(PRIMARY_PATTERN)]
    minority_cut = 2 if primary in _CLUSTERED else 3  # /10 of servers are "other"
    if ((server_index + rack_index) % 10) >= minority_cut:
        return primary
    others = [s for s in PRIMARY_PATTERN if s != primary]  # weighted by frequency
    return others[(rack_index * 7 + server_index) % len(others)]


def parse_server_name(name: str):
    """('{CODE}-SRV-{rack}-srv-{nn}') -> (rack_index, server_index), else None."""
    m = _NAME_RE.match(name or "")
    if not m:
        return None
    return int(m.group(1)) - 1, int(m.group(2)) - 1
