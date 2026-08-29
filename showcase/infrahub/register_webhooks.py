#!/usr/bin/env python3
"""Register net3d live-update webhooks in the showcase Infrahub.

Infrahub standard webhooks are one-(event_type, node_kind)-per-webhook, so this
creates a small matrix over the Dcim kinds net3d renders. Delivery follows the
Standard Webhooks spec (webhook-id/-timestamp/-signature headers) signed with
shared_key; the net3d server verifies that at /api/webhooks/infrahub.

Idempotent-ish: Infrahub rejects duplicate names, which this reports as
"skipped/exists".

Tunable via env:
  INFRAHUB_URL (default http://localhost:8000)
  INFRAHUB_API_TOKEN (default the showcase admin token, as seed_infrahub.py)
  WEBHOOK_SECRET (default showcase-dev-secret, matches .env.showcase)
  WEBHOOK_CALLBACK (default http://host.docker.internal:3002/api/webhooks/infrahub
                    — the infrahub-backed net3d instance of dev:showcase-dual)
"""
from __future__ import annotations

import os

import requests

URL = os.environ.get("INFRAHUB_URL", "http://localhost:8000")
TOKEN = os.environ.get("INFRAHUB_API_TOKEN", "06438eb2-8019-4776-878c-0941b1f1d1ec")
SECRET = os.environ.get("WEBHOOK_SECRET", "showcase-dev-secret")
CALLBACK = os.environ.get(
    "WEBHOOK_CALLBACK", "http://host.docker.internal:3002/api/webhooks/infrahub"
)

MUTATION = """
mutation($data: CoreStandardWebhookCreateInput!) {
  CoreStandardWebhookCreate(data: $data) { ok object { id } }
}
"""

# kinds from showcase/infrahub/schema/dcim.yml (namespace Dcim)
NODE_KINDS = ["DcimSite", "DcimDevice", "DcimRack", "DcimCable", "DcimPowerPanel", "DcimPowerFeed"]
EVENT_TYPES = ["infrahub.node.created", "infrahub.node.updated", "infrahub.node.deleted"]


def main() -> None:
    session = requests.Session()
    session.headers["X-INFRAHUB-KEY"] = TOKEN

    for kind in NODE_KINDS:
        for event in EVENT_TYPES:
            name = f"net3d-{kind}-{event.rsplit('.', 1)[-1]}"
            resp = session.post(
                f"{URL}/graphql",
                json={
                    "query": MUTATION,
                    "variables": {
                        "data": {
                            "name": {"value": name},
                            "branch_scope": {"value": "all_branches"},
                            "url": {"value": CALLBACK},
                            "event_type": {"value": event},
                            "node_kind": {"value": kind},
                            "shared_key": {"value": SECRET},
                        }
                    },
                },
                timeout=30,
            )
            body = resp.json()
            ok = (body.get("data") or {}).get("CoreStandardWebhookCreate") or {}
            if ok.get("ok"):
                print(f"created: {name}")
            else:
                errs = "; ".join(e.get("message", "?") for e in body.get("errors", []))
                print(f"skipped/exists: {name} ({errs or 'no ok flag'})")

    print("done")


if __name__ == "__main__":
    main()
