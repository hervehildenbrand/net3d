# Security Policy

## Reporting a Vulnerability

Please report security issues **privately** — do not open a public issue.

- Preferred: **GitHub Security Advisories** → the repository's **Security** tab →
  *"Report a vulnerability"*.
- Or email **herve.hildenbrand@gmail.com**.

We aim to acknowledge reports within 7 days and will coordinate a fix and disclosure
timeline with you.

## Supported Versions

This project tracks `main`; security fixes land there. There is no separate LTS branch.

## Deployment security model

net3d is a **read-only** NetBox visualizer. Its API and bundled UI are
**unauthenticated by default** — it is meant to run on `127.0.0.1` (development) or
**behind a TLS reverse proxy that handles authentication** (production). If you expose
it without a proxy, anyone who can reach it can read all NetBox data the server is
configured to fetch (sites, racks, devices, IPs, topology, power, and live NAPALM
output).

Hardening built in:

- **Binds to `127.0.0.1`** unless `HOST=0.0.0.0` is set explicitly.
- **Optional bearer token** — set `NET3D_API_TOKEN` and every `/api/*` route (except
  `/api/health`) requires `Authorization: Bearer <token>`. Because a browser cannot
  hold a secret, use this when net3d is consumed as an API, or when an
  authenticating reverse proxy injects the header after authenticating the user.
- **Security headers** via `@fastify/helmet` (incl. a Content-Security-Policy).
- **Rate limiting** via `@fastify/rate-limit`.
- The **NetBox token stays server-side** and is never sent to the browser.
- `NETBOX_TLS_VERIFY=false` relaxes certificate verification **only for NetBox calls**
  (via a scoped dispatcher), not for the whole process.

**Do not expose net3d directly on a public IP without authentication at the proxy
layer.**
