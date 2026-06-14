# Contributing to net3d

Thanks for your interest in improving net3d! This guide covers everything you need to
get a development environment running and land a change.

## Prerequisites

- **Node.js ≥ 22** (required by pnpm 11)
- **[pnpm](https://pnpm.io) 11** (the repo pins `pnpm@11.6.0` via `packageManager`)
- A NetBox instance (tested against **3.7.x and 4.x**) and a read-access API token — or use the
  bundled showcase (see below) if you just want to run the app against demo data.

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

## Project layout

```
packages/
├── shared/   pure, fully-tested logic (map bounds, rack layout, cable paths,
│             zoom-navigation state machine, LLDP↔cable diffing)
├── server/   Fastify proxy: GraphQL queries, cable normalization, caches, NAPALM
└── web/      Vite + React 19 + react-leaflet + react-three-fiber + zustand
```

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
