# Fastify-Only Server Status

## Current State

Fastify is the target server, Phase 0 has a green baseline, and non-Fastify server surfaces still exist in the repository.

Known items:

- `server/hono/package.json:1` defines a separate Hono server project.
- `server/hono/src/node.ts:1`, `server/hono/src/bun.ts:1`, and `server/hono/src/cf.ts:1` provide non-Fastify adapters.
- `server/hono/wrangler.jsonc:1` and `server/hono/src/utils/postbuild.js:5` keep Wrangler, Cloudflare, Hono static, and Vercel output surfaces.
- `package.json:19`, `package.json:20`, and `package.json:21` still expose `sync`, `electron`, and `hono:build`.
- `server.sh:1`, `server.bat:1`, and `capacitor.config.ts:1` remain launcher or native/mobile surfaces.
- `public/functions/proxy.js:1` and `public/functions/proxy2.js:1` provide hosted function proxy surfaces.
- `server/fastify/src/app.ts:176` still uses `__NODE__` plus `__FASTIFY__` compatibility signaling.

## Target State

- Fastify owns server startup, static serving, API routes, storage, proxy, and smoke coverage.
- Hono, hosted functions, and legacy server launchers are removed.
- Client bootstrap receives only the Fastify/server-backed signal it needs.

## Watch Points

- Phase 1 should remove project surfaces before collapsing shared platform gates.
- Keep Docker and compose Fastify flows intact.
- Ensure route tests cover retained `/api/v1/*` behavior before deleting legacy paths.
