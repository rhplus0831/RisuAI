# Fastify-Only Next Steps

## Current Pickup

Start with [Phase 1: Project Surface Removal](../phases/phase-1-project-surface-removal.md). Phase 0 is closed in [phases-completed](../phases-completed/phase-0-audit-and-baseline-2026-05-27.md).

## Immediate Tasks

1. Remove `sync`, `electron`, and `hono:build` from `package.json`.
2. Delete `server/hono`, including Node, Bun, Cloudflare, Vercel, Wrangler, and postbuild files.
3. Delete or replace `server.sh`, `server.bat`, and `capacitor.config.ts`.
4. Remove stale public docs that instruct users to use removed project surfaces.
5. Update this file after Phase 1 closes.

## Phase 1 Verification To Record

- `pnpm check`
- `pnpm build`
- `pnpm api:test`

## Watch Points

- Phase 0 has recorded the baseline; do not start deleting shared platform gates until Phase 2.
- Keep docs and package scripts aligned in the same phase as project-surface removals.
- Include localized app strings in the docs and packaging closeout, not only markdown files.
- Treat newly discovered project-level non-Fastify surfaces as Phase 1 findings, but defer shared runtime gates to later phases.
