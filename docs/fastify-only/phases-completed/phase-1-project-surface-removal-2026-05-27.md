# Phase 1: Project Surface Removal

Closed on 2026-05-27.

## Goal

Remove project-level surfaces that advertise or implement non-Fastify platforms.

## Result

Phase 1 is complete. The repository no longer has the Hono server subtree, root launcher scripts, Capacitor config, or root package scripts for Hono/Electron/sync flows. Shared runtime platform gates were intentionally left for [Phase 2: Runtime Contract Collapse](phase-2-runtime-contract-collapse-2026-05-27.md).

## Changed Files

- `package.json`
- `server/hono/.gitignore`
- `server/hono/README.md`
- `server/hono/package.json`
- `server/hono/pnpm-lock.yaml`
- `server/hono/src/app/index.ts`
- `server/hono/src/bun.ts`
- `server/hono/src/cf.ts`
- `server/hono/src/node.ts`
- `server/hono/src/utils/postbuild.js`
- `server/hono/tsconfig.json`
- `server/hono/wrangler.jsonc`
- `server.sh`
- `server.bat`
- `capacitor.config.ts`
- `docs/fastify-only/README.md`
- `docs/fastify-only/plan.md`
- `docs/fastify-only/status.md`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/status/server.md`
- `docs/fastify-only/phases/README.md`
- `docs/fastify-only/phases-completed/README.md`
- `docs/fastify-only/removed-and-out-of-scope.md`
- `docs/fastify-only/phases-completed/phase-1-project-surface-removal-2026-05-27.md`

## Verification

- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm build` passed with existing build warnings for CSS `::highlight(...)`, browser-externalized modules, plugin timing, ineffective dynamic imports, and large chunks.
- `pnpm api:test` passed: 68 test files and 1217 tests.

## Follow-Up

- Continue with [Phase 2: Runtime Contract Collapse](phase-2-runtime-contract-collapse-2026-05-27.md).
- Keep storage endpoint selection, proxy routing, service worker behavior, and remaining localized runtime strings scoped to their later phases.
- `public/functions/proxy.js` and `public/functions/proxy2.js` remain hosted function proxy surfaces for Phase 4 or Phase 5 cleanup.

## Original Scope

- Delete `server/hono`, including Node, Bun, Cloudflare, Vercel, Wrangler, and postbuild files.
- Remove `hono:build`, `electron`, `sync`, and other non-Fastify scripts from `package.json`.
- Remove or replace `server.sh` and `server.bat`.
- Remove `capacitor.config.ts`.
- Remove stale native/mobile/hosted-platform documentation references discovered during the phase.
