#!/usr/bin/env bash
# Seed the full 20-site, NetBox-density mirror into the showcase Infrahub,
# site-by-site (resumable: a failed site doesn't abort the rest), then one
# final circuits pass that builds the canonical inter-DC ring. LOCAL ONLY.
#
#   seed/run_full_mirror.sh                 # all 20 sites + circuits
#   ONLY="AMS1 FRA1" seed/run_full_mirror.sh  # just these sites, no circuits pass
#
# Density params below match showcase/seed/seed.py (the NetBox seed) defaults, so
# the Infrahub fabric mirrors NetBox: ~46+4 racks/compute site, 18 servers/rack,
# 8 spines, 2 cores, etc. PoP per-site server_racks overrides come from
# datacenters.json automatically.
set -uo pipefail
HERE="/Users/hervehildenbrand/Code/net3d/showcase/infrahub"
PY="$HERE/.venv/bin/python"
SEED="$HERE/seed/seed_infrahub.py"

export INFRAHUB_ADDRESS="http://localhost:8000"
export INFRAHUB_API_TOKEN="06438eb2-8019-4776-878c-0941b1f1d1ec"
export SERVER_RACKS=46 SERVERS_PER_RACK=18 NETWORK_RACKS=4 SPINES_PER_DC=8 \
       SPINE_UPLINKS=4 CORES_PER_DC=2 SERVER_CABLING_SAMPLE=4

ALL="IAD1 DFW1 SJC1 LAX1 ORD1 NYC1 MIA1 GRU1 AMS1 FRA1 LHR1 PAR1 DXB1 JNB1 SIN1 HKG1 NRT1 ICN1 SYD1 MEL1"
SITES="${ONLY:-$ALL}"

total=$(echo "$SITES" | wc -w | tr -d ' ')
n=0
for s in $SITES; do
  n=$((n + 1))
  echo "########## [$n/$total] SEED $s  $(date +%H:%M:%S) ##########"
  ONLY_SITES="$s" SKIP_CIRCUITS=1 "$PY" "$SEED" || echo "!!!! $s FAILED (continuing) !!!!"
done

if [ -z "${ONLY:-}" ]; then
  echo "########## CIRCUITS PASS  $(date +%H:%M:%S) ##########"
  CIRCUITS_ONLY=1 "$PY" "$SEED" || echo "!!!! circuits FAILED !!!!"
fi
echo "########## MIRROR DONE  $(date +%H:%M:%S) ##########"
