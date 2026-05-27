# Fastify-Only Server Status

## Current State

Fastify is the target server. Phase 1 removed the project-level Hono, launcher, and native/mobile surfaces. Shared runtime and hosted function compatibility surfaces remain for later phases.

Known items:

- `package.json:19` through `package.json:21` expose Fastify API scripts without `sync`, `electron`, or `hono:build`.
- `public/functions/proxy.js:1` and `public/functions/proxy2.js:1` provide hosted function proxy surfaces.
- `server/fastify/src/app.ts:176` still uses `__NODE__` plus `__FASTIFY__` compatibility signaling.

## Target State

- Fastify owns server startup, static serving, API routes, storage, proxy, and smoke coverage.
- Hono, hosted functions, and legacy server launchers are removed.
- Client bootstrap receives only the Fastify/server-backed signal it needs.

## Watch Points

- Phase 2 should collapse shared platform and bootstrap gates without reintroducing project-level platform launchers.
- Keep Docker and compose Fastify flows intact.
- Ensure route tests cover retained `/api/v1/*` behavior before deleting legacy paths.
