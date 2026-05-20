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
- `package.json#engines` widened to `>= 24.0.0` for `node:sqlite`.
- `server/fastify/src/index.ts` - boot.
- `server/fastify/src/app.ts` - app factory + route registration.
- `server/fastify/src/config.ts` - env parsing. Variables:
  - `RISU_API_HOST` (default `0.0.0.0`).
  - `RISU_API_PORT` (default `6002`).
  - `RISU_API_DATA_DIR` (default `<repoRoot>/data`).
  - `RISU_API_BODY_LIMIT` (default 100 MiB).
  - `TRUST_PROXY` (default `0`).
- `server/fastify/src/auth.ts`:
  - Password set / login (matches the current Express flow so
    existing browser keypairs keep working).
  - ES256 client-signed assertions; cached known-key hashes on
    disk under `data/__known_public_key_hashes.json`.
- `server/fastify/src/http.ts` - shared `risu-auth` extraction +
  rate limiting helpers.
- `server/fastify/src/db.ts` - `node:sqlite` connection, WAL pragma,
  foreign keys, version table. No domain schema yet; that lands in
  Phase 2.
- Health route: `GET /api/v1/health` returns
  `{ status: 'ok', revision: number, schemaVersion: number }`.
- Auth routes: `GET /api/v1/auth/status`, `POST /api/v1/auth/setup`,
  `POST /api/v1/auth/login`.
- Vite dev proxy: `/api/*` -> `http://localhost:6002`.

Test infrastructure:

- `vitest` config at `server/fastify/vitest.config.ts`.
- A smoke test that boots the app in-process, hits `/health` and
  `/auth/status`, sets a password, logs in, and asserts the
  resulting assertion validates.

## Boundaries

- **No SQL schema beyond the version table.** That is Phase 2.
- **No proxy routes.** That is Phase 3. The Express server still
  owns `/proxy*`, `/hub-proxy/*`, and SPA serving during Phase 1.
- **No SPA serving from Fastify.** Phase 2 wires `@fastify/static`
  to serve `dist/` only after we know we can persist data.
- **No Docker changes.** Phase 2 owns the persistence volume; the
  container does not change until then.

## Exit criteria

- `pnpm api:dev` starts Fastify on `:6002`.
- `GET /api/v1/health` returns 200 with `{ status: 'ok' }`.
- `POST /api/v1/auth/setup` + `POST /api/v1/auth/login` issue and
  accept ES256 assertions.
- `pnpm api:test` runs the smoke test and passes.
- The Vite dev server forwards `/api/*` to Fastify.
- `pnpm check`, `pnpm test`, `pnpm build` stay green.
- The Express server still boots and serves the SPA in production
  mode. (Retirement is Phase 3.)

## Reference

- `move-to-fastify` foundation slice: commits `0c3de7de` (initial
  Fastify scaffold), `d430d31c` (runbook + Node 24 requirement),
  `e10499a2` (Docker + persistence smoke test).
- Auth surface in `server/node/server.cjs` lines 622-742 is the
  shape Phase 1 reproduces.
