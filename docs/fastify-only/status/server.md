# Fastify-Only Server Status

## Current State

Fastify is the target server, but non-Fastify server surfaces still exist in the repository.

Known items:

- `server/hono/package.json:1` defines a separate Hono server project.
- `server/hono/src/node.ts:1`, `server/hono/src/bun.ts:1`, and `server/hono/src/cf.ts:1` provide non-Fastify adapters.
- `public/functions/proxy.js:1` and `public/functions/proxy2.js:1` provide hosted function proxy surfaces.
- `server/fastify/src/app.ts:176` still uses `__NODE__` plus `__FASTIFY__` compatibility signaling.

## Target State

- Fastify owns server startup, static serving, API routes, storage, proxy, and smoke coverage.
- Hono, hosted functions, and legacy server launchers are removed.
- Client bootstrap receives only the Fastify/server-backed signal it needs.

## Watch Points

- Remove project surfaces before collapsing shared platform gates.
- Keep Docker and compose Fastify flows intact.
- Ensure route tests cover retained `/api/v1/*` behavior before deleting legacy paths.
