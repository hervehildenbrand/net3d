#!/usr/bin/env python3
"""Register the net3d live-update webhook in the showcase NetBox (4.x).

NetBox 4.x splits webhooks in two: a Webhook (where to POST, signing secret)
plus EventRules (which object types / events fire it). Idempotent: reruns
update the webhook URL/secret and skip existing rules.

Tunable via env:
  NETBOX_URL (default http://localhost:8088)
  NETBOX_TOKEN (default the showcase superuser token)
  WEBHOOK_SECRET (default showcase-dev-secret, matches .env.showcase)
  WEBHOOK_CALLBACK (default http://host.docker.internal:3001/api/webhooks/netbox
                    — the NetBox container POSTing back to the dev server)
"""
from __future__ import annotations

import os

import pynetbox

URL = os.environ.get("NETBOX_URL", "http://localhost:8088")
TOKEN = os.environ.get("NETBOX_TOKEN", "abcdef0123456789abcdef0123456789abcdef01")
SECRET = os.environ.get("WEBHOOK_SECRET", "showcase-dev-secret")
CALLBACK = os.environ.get(
    "WEBHOOK_CALLBACK", "http://host.docker.internal:3001/api/webhooks/netbox"
)

# object types whose changes affect what net3d renders
OBJECT_TYPES = [
    "dcim.site",
    "dcim.device",
    "dcim.rack",
    "dcim.cable",
    "dcim.powerpanel",
    "dcim.powerfeed",
]
EVENT_TYPES = ["object_created", "object_updated", "object_deleted"]


def main() -> None:
    nb = pynetbox.api(URL, token=TOKEN)

    wh = next(iter(nb.extras.webhooks.filter(name="net3d-live")), None)
    if wh is None:
        wh = nb.extras.webhooks.create(
            name="net3d-live",
            payload_url=CALLBACK,
            http_method="POST",
            http_content_type="application/json",
            secret=SECRET,
            ssl_verification=False,
        )
        print(f"created webhook net3d-live (id {wh.id}) -> {CALLBACK}")
    else:
        wh.payload_url = CALLBACK
        wh.secret = SECRET
        wh.save()
        print(f"updated webhook net3d-live (id {wh.id}) -> {CALLBACK}")

    for ct in OBJECT_TYPES:
        name = f"net3d-{ct.replace('.', '-')}"
        if next(iter(nb.extras.event_rules.filter(name=name)), None):
            print(f"event rule exists: {name}")
            continue
        nb.extras.event_rules.create(
            name=name,
            object_types=[ct],
            event_types=EVENT_TYPES,
            action_type="webhook",
            action_object_type="extras.webhook",
            action_object_id=wh.id,
            enabled=True,
        )
        print(f"created event rule: {name}")

    print("done")


if __name__ == "__main__":
    main()
