# Phase 1 - Foundation

Date: 2026-05-20

## Goal

Stand up the Fastify + TypeScript server with the minimum surface
needed for later phases: env loader, auth, health check, dev
scripts, vite proxy.

## Preconditions

- Phase 0 closed.

## Scope

Lands under `server/fastify/`:

- `package.json` scripts at the repo root:
  - `pnpm api:dev` - `tsx watch server/fastify/src/index.ts`.
  - `pnpm api:start` - `tsx server/fastify/src/index.ts`.
  - `pnpm api:test` - `vitest run --config server/fastify/vitest.config.ts`.
- `package.json#engines` widened to `>=24.0.0` for `node:sqlite`.
- `server/fastify/src/index.ts` - boot.
- `server/fastify/src/app.ts` - app factory + plugin, resource, and
  route registration.
- `server/fastify/src/config.ts` - env parsing. Variables:
  - `RISU_API_HOST` (default `0.0.0.0`).
  - `RISU_API_PORT` (default `6002`).
  - `RISU_API_DATA_DIR` (default `<repoRoot>/data`).
  - `RISU_API_BODY_LIMIT` (default 100 MiB).
  - `RISU_API_STATIC_ROOT` (default `<repoRoot>/dist`; added with
    Phase 2 static serving and accepts empty / `none` / `off` to
    disable).
  - `TRUST_PROXY` (default `false`; integer values are accepted).
- `server/fastify/src/auth.ts`:
  - Password set / login with the same assertion shape as the
    current Express flow. The Fastify data dir has its own known-key
    cache, so users still log in once to register a browser key.
  - ES256 client-signed assertions; cached known-key hashes on
    disk under `data/__known_public_key_hashes.json`.
- `server/fastify/src/http.ts` - shared `risu-auth` extraction.
  `@fastify/rate-limit` is registered in `app.ts` but is not applied
  globally yet.
- `server/fastify/src/db.ts` - `node:sqlite` connection, WAL pragma,
  foreign keys, version table. No domain schema yet; that remains
  deferred until per-resource APIs need it.
- Health route: `GET /api/v1/health` returns
  `{ status: 'ok', revision: number, schemaVersion: number }`.
- Auth routes: `GET /api/v1/auth/status`, `POST /api/v1/auth/setup`,
  `POST /api/v1/auth/login`.
- Vite dev proxy: `/api/*` -> `http://localhost:6002`.

Test infrastructure:

- `vitest` config at `server/fastify/vitest.config.ts`.
- A smoke test that boots the app in-process, hits
  `/api/v1/health` and `/api/v1/auth/status`, sets a password, logs
  in, and asserts a matching client-signed assertion validates.

## Boundaries

- **No SQL schema beyond the version table.** Phase 2 decides the
  migration-window storage layout; domain SQL tables remain deferred.
- **No proxy routes.** That is Phase 3. The Express server still
  owns `/proxy*`, `/hub-proxy/*`, and SPA serving during Phase 1.
- **No SPA serving from Fastify.** Phase 2 wires `@fastify/static`
  to serve `dist/` only after we know we can persist data.
- **No Fastify Docker runtime switch.** Phase 2 owns the persistence
  volume and Fastify SPA serving; the container still runs Express
  until then.

## Exit criteria

- `pnpm api:dev` starts Fastify on `:6002`.
- `GET /api/v1/health` returns 200 with `{ status: 'ok' }`.
- `POST /api/v1/auth/setup` sets the password;
  `POST /api/v1/auth/login` registers a public key after password
  match; `GET /api/v1/auth/status` accepts matching client-signed
  ES256 assertions.
- `pnpm api:test` runs the smoke test and passes.
- The Vite dev server forwards `/api/*` to Fastify.
- `pnpm check`, `pnpm test`, `pnpm build` stay green.
- At Phase 1 close, the Express server still booted and served the
  SPA. Phase 2 later moved the Docker runtime and static serving to
  Fastify; full Express deletion is still Phase 3.

## Reference

- `move-to-fastify` foundation slice: commits `0c3de7de` (initial
  Fastify scaffold), `d430d31c` (runbook + Node 24 requirement),
  `e10499a2` (Docker + persistence smoke test).
- Auth surface in `server/node/server.cjs` lines 614-742 is the
  shape Phase 1 reproduces.

## Status

Done 2026-05-20. Landed differences from the planned scope:

- Vitest `root` is set inside `server/fastify/vitest.config.ts`
  (via `import.meta.url`) so `pnpm api:test` can run from the
  repo root.
- Root `vitest.config.ts` now excludes `server/**` so
  `pnpm test` (browser side) and `pnpm api:test` (server side)
  do not overlap.
- `@fastify/cors` was not installed; same-origin dev proxy means
  it is not yet needed. Add it in Phase 3 when proxy routes
  move over.
- The smoke test sets `process.env.LOG_LEVEL = 'silent'` to keep
  test output clean; production boot stays at the default `info`
  level.
