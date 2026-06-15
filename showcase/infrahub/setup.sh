#!/usr/bin/env bash
# Bring up a local Infrahub showcase instance for net3d and load the DCIM schema.
# Mirrors showcase/setup.sh (the NetBox one). Seeding is a separate step:
#   python -m venv .venv && ./.venv/bin/pip install "infrahub-sdk[all]"
#   ./.venv/bin/python seed/seed_infrahub.py
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

ADDR="${INFRAHUB_ADDRESS:-http://localhost:8000}"
TOKEN="${INFRAHUB_API_TOKEN:-06438eb2-8019-4776-878c-0941b1f1d1ec}"

echo "==> Pulling images (pinned in ./.env)"
docker compose pull

echo "==> Starting Infrahub stack"
docker compose up -d

echo "==> Waiting for Infrahub to answer (first boot bootstraps Neo4j + Prefect, ~1-3 min)…"
for i in $(seq 1 90); do
  if curl -fsS -o /dev/null "$ADDR/api/config" 2>/dev/null; then
    echo "==> Infrahub is up at $ADDR  (admin / infrahub)"
    break
  fi
  sleep 5
  if [ "$i" = "90" ]; then
    echo "!! Infrahub did not become healthy in time; check: docker compose logs infrahub-server" >&2
    exit 1
  fi
done

# Prefer the local venv's infrahubctl (created for the seed); fall back to PATH.
if [ -x "$HERE/.venv/bin/infrahubctl" ]; then
  CTL="$HERE/.venv/bin/infrahubctl"
else
  CTL="infrahubctl"
fi

echo "==> Loading DCIM schema"
INFRAHUB_ADDRESS="$ADDR" INFRAHUB_API_TOKEN="$TOKEN" "$CTL" schema load schema/

echo "==> Done. API token: $TOKEN"
echo "    Next: ./.venv/bin/python seed/seed_infrahub.py   (seeds a 3-site subset)"
