# Server Status

Date: 2026-05-21

## Current state

Phase 1, the server-side Phase 2 storage slice, Phase 3A-C
(generic provider proxy, stream-job WebSocket, hub passthrough),
Phase 3D-Narrow (proxy / hub URL switchover), and Phase 3D-Broad
(legacy NodeStorage surface on Fastify) all exist on the
`fastify` branch:

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
  `RISU_API_STATIC_ROOT`, `TRUST_PROXY`, and `RISU_HUB_URL`
  (default `https://sv.risuai.xyz`).
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
  `POST /api/v1/auth/login`, `POST /api/v1/auth/crypto`,
  `GET /api/v1/bootstrap`, `POST /api/v1/import/risusave`,
  `POST /api/v1/assets`, `GET/HEAD /api/v1/assets/:id`,
  `POST /api/v1/assets/exists`, `GET /api/v1/backups`,
  `POST /api/v1/backups`, `POST /api/v1/backups/:id/restore`,
  `DELETE /api/v1/backups/:id`, `POST /api/v1/proxy/fetch`,
  `POST /api/v1/proxy/stream-jobs`,
  `DELETE /api/v1/proxy/stream-jobs/:id`, the WebSocket upgrade
  at `GET /api/v1/proxy/stream-jobs/:id/ws`,
  `ANY /api/v1/hub/*`, `GET /api/v1/storage/list`,
  `GET /api/v1/storage/read`, `POST /api/v1/storage/write`, and
  `POST /api/v1/storage/remove`.
- `server/fastify/__tests__/{smoke,bootstrap,assets,backups,static,proxy,streamJobs,streamJobsRoutes,hub,legacyStorage}.test.ts`
  cover the implemented Fastify routes and static serving through
  `pnpm api:test`.
- `server/fastify/src/proxy.ts` and `server/fastify/src/routes/proxy.ts`
  hold the Phase 3A generic-proxy surface. The route is scoped to
  its own plugin instance with a catch-all content-type parser so
  request bodies are forwarded as raw bytes regardless of
  content-type. Auth uses the standard `requireAuth` (ES256 only,
  consistent with every other Fastify route).
- `server/fastify/src/streamJobs.ts` owns the Phase 3B stream-job
  lifecycle (`JobRegistry`, `sanitizeLocalTargetUrl`,
  `runStreamJob`) and `server/fastify/src/routes/streamJobs.ts`
  registers the POST / DELETE / WebSocket routes. The WS upgrade
  is the only authenticated route that accepts the ES256
  assertion via a `risu-auth` query-string parameter in addition
  to the header (EventSource-style clients can't set custom
  headers); see [`../phases/phase-3-proxy.md`](../phases/phase-3-proxy.md).
  `buildApp` schedules `JobRegistry.tickGc` on a 60s unref'd
  interval and clears it via `onClose`.
- `server/fastify/src/routes/hub.ts` registers the Phase 3C hub
  passthrough at `ANY /api/v1/hub/*`. The route strips the
  `/api/v1/hub` prefix and forwards the suffix to
  `config.hubUrl` (`RISU_HUB_URL` env, default
  `https://sv.risuai.xyz`); `x-risu-node-path` overrides the
  destination URL entirely. It uses the same catch-all
  content-type parser pattern as the proxy fetch route, strips
  `content-encoding` / `content-length` / `transfer-encoding`
  from upstream responses, and follows exactly one 3xx redirect
  manually.
- Phase 3D-Narrow added the static-serving index.html injection
  that gives the SPA `globalThis.__FASTIFY__ = true`. Phase
  3D-Broad extends it to inject `globalThis.__NODE__ = true` as
  well, so every existing self-host gate in the SPA
  (NodeStorage, save flow, prefer-remote saves) activates under
  Fastify too. Client-side, `platform.isFastifyServer` and the
  long-standing `isNodeServer` both become true; URL builders
  in `globalApi.svelte.ts` and `characterCards.ts` prefer
  `/api/v1/*`; and `isWeb` correctly excludes Fastify deployments.
- `server/fastify/src/routes/legacyStorage.ts` adds the
  key-value storage surface the SPA's `NodeStorage` /
  `AutoStorage` / cold-storage paths target:
  `/api/v1/storage/{list,read,write,remove}` with the same
  hex-key + raw-bytes shape as the legacy Express
  `/api/{list,read,write,remove}` routes. Files live under
  `${dataDir}/save/`. `POST /api/v1/auth/crypto` is the
  matching sha256 hex shim for the password digest. Client-side,
  `src/ts/storage/nodeStorage.ts` picks its endpoint set at
  module-load time based on `isFastifyServer` and normalizes
  the auth-status response shape (`{noPassword, authorized}` on
  Fastify, `{status}` on Express) into the existing
  unset / incorrect / success enum.
- Known limitation: `ANY /api/v1/hub/*` keeps `requireAuth`, so
  on password-protected deployments browser-loaded resources
  (`<img src=hubURL/...>`, `<iframe src=hubURL/...>`) will 401
  because they cannot send `risu-auth`. Tracked as a follow-up
  in [`next-steps.md`](next-steps.md).

Other runtime servers still in tree:

- `server/node/server.cjs` - Express server still used by
  `pnpm runserver` and still owns the legacy Node-server storage
  endpoints (`/api/read`, `/api/write`, `/api/list`) plus
  `/proxy*`, `/hub-proxy/*`, and proxy stream-job WebSocket
  behavior until Phase 3 ports and retires it. The Docker runtime
  no longer starts this server. Phase 3A-C have ported the
  proxy fetch, stream-job HTTP+WS, and hub passthrough to
  Fastify; the Express `/proxy*`, `/proxy-stream-jobs`, and
  `/hub-proxy/*` routes stay live until the client is rewired
  to call the Fastify endpoints.
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
  Phase 3A (proxy fetch), Phase 3B (stream-job HTTP+WS), and
  Phase 3C (hub passthrough) landed 2026-05-20. Phase 3D-Narrow
  (client switchover for the proxy / hub URL builders + the
  Fastify `__FASTIFY__` flag injection) and Phase 3D-Broad
  (legacy NodeStorage / crypto routes on Fastify + `__NODE__`
  injection so all self-host gates fire) landed 2026-05-21.
  Express deletion is the only remaining Phase 3 work.
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
