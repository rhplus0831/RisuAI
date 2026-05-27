# Fastify-Only Server Status

## Current State

Fastify is the target server. Phase 1 removed the project-level Hono, launcher, and native/mobile surfaces. Phase 2 collapsed static serving to a single `globalThis.__FASTIFY__` client signal. Phase 4 removed hosted function proxy compatibility surfaces.

Known items:

- `package.json:19` through `package.json:21` expose Fastify API scripts without `sync`, `electron`, or `hono:build`.
- `src/ts/globalApi.svelte.ts:560` selects retained Fastify `/api/v1/proxy/*` routes for client proxy calls.
- `server/fastify/src/app.ts:176` injects only `globalThis.__FASTIFY__` for the served SPA.

## Target State

- Fastify owns server startup, static serving, API routes, storage, proxy, and smoke coverage.
- Hono, hosted functions, and legacy server launchers are removed.
- Client bootstrap receives only the Fastify/server-backed signal it needs.

## Watch Points

- Phase 5 should remove browser-local surfaces without reintroducing `globalThis.__NODE__`.
- Keep Docker and compose Fastify flows intact.
- Ensure route tests cover retained `/api/v1/*` behavior before deleting legacy paths.
