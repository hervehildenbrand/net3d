# Contributing to net3d

Thanks for your interest in improving net3d! This guide covers everything you need to
get a development environment running and land a change.

## Prerequisites

- **Node.js ≥ 22** (required by pnpm 11)
- **[pnpm](https://pnpm.io) 11** (the repo pins `pnpm@11.6.0` via `packageManager`)
- A NetBox instance (tested against **3.7.x and 4.x**) and a read-access API token — or use the
  bundled showcase (see below) if you just want to run the app against demo data. net3d can
  also read from **Infrahub** (`SOT_BACKEND=infrahub`); both share one `SoTClient` seam.

## Getting started

```sh
cp .env.example .env     # set NETBOX_URL + NETBOX_TOKEN
pnpm install
pnpm dev                 # API proxy on :3001, web app on http://localhost:5173
```

No NetBox handy? Run against the local showcase stack:

```sh
pnpm dev:showcase        # uses the showcase/ NetBox + fictional demo data
```

## Checks before you push

All of these run in CI, so run them locally first:

```sh
pnpm test                # vitest across every package
pnpm typecheck           # tsc --noEmit across every package
```

## Local dev notes

`pnpm dev` runs two watchers: Vite (web) on **5173** and the API server on **3001**.
A few things that save head-scratching:

- Open **`http://localhost:5173`** (Vite binds IPv6 — `127.0.0.1` may not resolve).
- The server holds an in-memory NetBox cache and a prewarm loop, so a **clean restart
  wipes the cache** and the first site load re-warms (slower until it does).
- HMR handles ordinary edits. **Restart `pnpm dev`** after switching branches, or after
  adding/removing files or changing `packages/shared` exports (it's consumed as raw
  source, so the module graph shifts). If the app 404s, hangs, or shows stale code,
  a restart usually fixes it — killing anything stuck on ports 5173/3001 first.

## Project layout

```
packages/
├── shared/   pure, fully-tested logic (map bounds, rack layout, cable paths,
│             zoom-navigation state machine, LLDP↔cable diffing)
├── server/   Fastify proxy: pluggable source-of-truth seam (sot/ → NetBox | Infrahub),
│             GraphQL queries, cable normalization, caches, NAPALM
└── web/      Vite + React 19 + react-leaflet + react-three-fiber + zustand
```

The `packages/server/src/sot/` directory holds the backend seam: `client.ts` defines the
`SoTClient` interface, `factory.ts` picks NetBox or Infrahub from `SOT_BACKEND`, and each
backend has its own client. Everything downstream depends only on `SoTClient`.

`packages/shared` is intentionally framework-free and **must stay test-covered** — add
or update tests alongside any logic change there. The proxy holds the NetBox token; it
must never be exposed to the browser.

## Pull requests

- Branch from `main` using `<type>/<short-description>` (e.g. `feat/rack-labels`,
  `fix/cable-routing`).
- Use [Conventional Commits](https://www.conventionalcommits.org/) for messages
  (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`). Keep commits atomic and each one a
  working state.
- Keep diffs focused — one logical change per PR.
- Write tests first where practical, and make sure `pnpm test` and `pnpm typecheck` are
  green before opening the PR.

## Reporting issues

Please include the NetBox version, whether the NAPALM plugin is enabled, and the steps
to reproduce. Never paste real tokens, credentials, or production topology into an issue.

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
