# Server Status

Date: 2026-05-20

## Current state

Phase 1, the server-side Phase 2 storage slice, and Phase 3A
(generic provider proxy) exist on the `fastify` branch:

- `server/fastify/src/index.ts` boots the app on
  `RISU_API_HOST` / `RISU_API_PORT` (defaults `0.0.0.0:6002`).
- `server/fastify/src/app.ts` builds Fastify, registers
  `@fastify/rate-limit`, registers a raw-body parser for supported
  asset content types, opens the SQLite metadata DB, registers
  health/auth/bootstrap/import/assets/backups routes, and serves
  `RISU_API_STATIC_ROOT` via `@fastify/static` when that directory
  exists.
- `server/fastify/src/config.ts` reads `RISU_API_HOST`,
  `RISU_API_PORT`, `RISU_API_DATA_DIR`, `RISU_API_BODY_LIMIT`,
  `RISU_API_STATIC_ROOT`, and `TRUST_PROXY`.
- `server/fastify/src/db.ts` creates `data/risu.db` with
  `schema_version(id, version, revision)`, WAL mode, and foreign
  keys.
- `server/fastify/src/auth.ts` stores the first-run password and
  known public-key hashes under the Fastify data dir, then verifies
  client-signed ES256 assertions from `risu-auth`.
- `server/fastify/src/repository.ts` owns `data/db.json`,
  `data/assets/<sha256>.<ext>`, and `data/backups/<id>/`.
  Domain data is still a JSON blob; SQLite still holds system
  metadata only.
- Routes currently implemented: `GET /api/v1/health`,
  `GET /api/v1/auth/status`, `POST /api/v1/auth/setup`,
  `POST /api/v1/auth/login`, `GET /api/v1/bootstrap`,
  `POST /api/v1/import/risusave`, `POST /api/v1/assets`,
  `GET/HEAD /api/v1/assets/:id`, `POST /api/v1/assets/exists`,
  `GET /api/v1/backups`, `POST /api/v1/backups`,
  `POST /api/v1/backups/:id/restore`,
  `DELETE /api/v1/backups/:id`, and `POST /api/v1/proxy/fetch`.
- `server/fastify/__tests__/{smoke,bootstrap,assets,backups,static,proxy}.test.ts`
  cover the implemented Fastify routes and static serving through
  `pnpm api:test`.
- `server/fastify/src/proxy.ts` and `server/fastify/src/routes/proxy.ts`
  hold the Phase 3A generic-proxy surface. The route is scoped to
  its own plugin instance with a catch-all content-type parser so
  request bodies are forwarded as raw bytes regardless of
  content-type. Auth uses the standard `requireAuth` (ES256 only,
  consistent with every other Fastify route).

Other runtime servers still in tree:

- `server/node/server.cjs` - Express server still used by
  `pnpm runserver` and still owns the legacy Node-server storage
  endpoints (`/api/read`, `/api/write`, `/api/list`) plus
  `/proxy*`, `/hub-proxy/*`, and proxy stream-job WebSocket
  behavior until Phase 3 ports and retires it. The Docker runtime
  no longer starts this server. Phase 3A landed `POST /api/v1/proxy/fetch`
  on Fastify; the Express `/proxy` / `/proxy2` routes stay live
  until the client is rewired to call the Fastify endpoint.
- `server/hono/` - small Hono scaffold with CSRF middleware,
  `Hello Hono!`, and Node / Bun / Cloudflare static-serving entry
  points. It is not on the Fastify migration path.

Root `package.json` has `pnpm runserver` for the Express server,
`pnpm hono:build` for the Hono static bundle, and `pnpm api:dev`,
`pnpm api:start`, `pnpm api:test` for the Fastify server. The
Dockerfile runs `pnpm api:start`, exposes 6002, and persists
`/app/data`; `docker-compose.yml` maps `6002:6002`.

## What lands when

- **Phase 1.** Done 2026-05-20. `server/fastify/` directory,
  `pnpm api:dev` / `pnpm api:start` / `pnpm api:test`, health
  endpoint, env loader, auth scaffold, DB connection, and Vite
  proxy `/api` -> Fastify.
- **Phase 2.** Done 2026-05-20. `data/db.json` blob for domain
  state, repository read/write, raw asset storage, JSON save
  import, backups, Fastify static serving, and container
  switchover. Domain SQL tables are deferred to Phases 5-9, per
  resource. Binary `.risu` codec and bundle export stay client-side
  until Phase 9. See
  [`../phases/phase-2-storage.md`](../phases/phase-2-storage.md).
- **Phase 3.** Provider proxy + hub passthrough + stream-job
  WebSocket. Express server is retired once Phase 3 closes.
  Phase 3A landed 2026-05-20: `POST /api/v1/proxy/fetch` is in
  place behind `requireAuth`, with the request / response header
  sanitization helpers reused by the upcoming stream-job slice.
- **Phase 6.** Server-side LLM / translation / TTS / image /
  Stable Horde generation endpoints.
- **Phase 7.** Server-side prompt assembly + lorebook activation.
- **Phase 8.** Hypa V3 chunking + embeddings + summary jobs.

## Reference: what move-to-fastify shipped

For each phase, the `move-to-fastify` branch already has a worked
example. The links below are commit prefixes; resolve them on that
branch.

- Phase 1 foundation: `0c3de7de`, `d430d31c`, `e10499a2`.
- Phase 2 storage: `ae2252e5`, `f04c3e04`, `a1836719`,
  `2d786cb6`, `ba5e1c82`, `3d3e217e`, `511eecec`,
  `19faacac`, `7cfed755`, `2399e885`, `55f421d4`,
  `b6a50d3e`.
- Phase 3 proxy: `a1711803`, `fcfd69a8`, `58cfea1a`,
  `c929ca87`.
- Command-resource slice on `move-to-fastify` (that branch's phase
  labels differ from this roadmap): `28f6647d` and following, through
  `15b8ed7d` / `54cfe6d5`.
- Phase 5 generation: `648fe0fb` (OpenAI), `a1c6360a`
  (Anthropic), `8ddeb9d0` (Gemini), `92034749`
  (OpenRouter / NanoGPT / Mistral / Cohere / HF / DeepInfra),
  `fe8179bd` (local providers), `5034ff42` (Vertex), and
  the matching translate / TTS / image commits.
- Phase 6 store wiring: `2d99e885`, `fb062b10`,
  `bb5f5201`, `1a161664`.

This roadmap is not bound to those commits. They are useful when
you need to see "how did someone do this in TypeScript" but the
final API shape on `fastify` is set by [`architecture.md`](../architecture.md),
not by their endpoint URLs.

## Notes

- Node 24+ is required for `node:sqlite`. `package.json#engines`
  is currently `>=24.0.0`.
- Fastify serves the SPA when `RISU_API_STATIC_ROOT` points at a
  built `dist/`; unknown non-API GETs fall back to `index.html`.
- Express remains available through `pnpm runserver` until Phase 3
  deletes it, but it is no longer the Docker runtime.
