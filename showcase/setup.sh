#!/usr/bin/env bash
# Bring up a local NetBox 4.x showcase instance for net3d.
# Clones netbox-docker (pinned), overlays our customisations, and starts the stack.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NB_DIR="$HERE/netbox"
NB_REF="${NETBOX_DOCKER_REF:-release}"          # netbox-docker branch/tag to clone
VERSION="${NETBOX_VERSION:-v4.6-5.0.1}"         # NetBox image tag (must be 4.x)

if [ ! -f "$NB_DIR/docker-compose.yml" ]; then
  echo "==> Cloning netbox-docker ($NB_REF) into ./netbox"
  git clone --depth 1 --branch "$NB_REF" \
    https://github.com/netbox-community/netbox-docker.git "$NB_DIR"
fi

echo "==> Applying override and pinning NetBox $VERSION"
cp "$HERE/docker-compose.override.yml" "$NB_DIR/docker-compose.override.yml"
printf 'VERSION=%s\n' "$VERSION" > "$NB_DIR/.env"

cd "$NB_DIR"
echo "==> Pulling images"
docker compose pull
echo "==> Starting stack"
docker compose up -d

echo "==> Waiting for NetBox to become healthy (first boot runs DB migrations, ~2-4 min)…"
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:8088/login/" 2>/dev/null; then
    echo "==> NetBox is up at http://localhost:8088  (admin / admin)"
    exit 0
  fi
  sleep 5
done
echo "!! NetBox did not become healthy in time; check: cd showcase/netbox && docker compose logs netbox" >&2
exit 1
