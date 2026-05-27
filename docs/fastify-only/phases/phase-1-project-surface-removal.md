# Phase 1: Project Surface Removal

## Goal

Remove project-level surfaces that advertise or implement non-Fastify platforms.

## Scope

- Delete `server/hono`, including Node, Bun, Cloudflare, Vercel, Wrangler, and postbuild files.
- Remove `hono:build`, `electron`, `sync`, and other non-Fastify scripts from `package.json`.
- Remove or replace `server.sh` and `server.bat`.
- Remove `capacitor.config.ts`.
- Remove stale native/mobile/hosted-platform documentation references discovered during the phase.

## Boundaries

- Do not touch shared runtime platform code until Phase 2.
- Keep Fastify Docker and compose flows intact.
- Keep Vite dev proxy if it continues to target Fastify.

## Exit Criteria

- Root scripts expose Fastify and normal web build/test commands only.
- No repository entry point starts Hono, Electron, Capacitor, or legacy node launchers.
- Public docs do not instruct users to run removed project surfaces.

## Verification

- `pnpm check`
- `pnpm build`
- `pnpm api:test`

## Phase 0 Baseline

Phase 0 closed on 2026-05-27 with all required baseline commands passing. See [../phases-completed/phase-0-audit-and-baseline-2026-05-27.md](../phases-completed/phase-0-audit-and-baseline-2026-05-27.md).

## Removal List

- `package.json:19` remove `sync`.
- `package.json:20` remove `electron`.
- `package.json:21` remove `hono:build`.
- `server/hono/package.json:1` delete the Hono package subtree.
- `server/hono/src/node.ts:1`, `server/hono/src/bun.ts:1`, and `server/hono/src/cf.ts:1` delete non-Fastify adapters.
- `server/hono/wrangler.jsonc:1` delete Wrangler configuration.
- `server/hono/src/utils/postbuild.js:5` delete Hono/Vercel static copy flow.
- `server.sh:1` and `server.bat:1` delete or replace stale launchers.
- `capacitor.config.ts:1` delete Capacitor config.
- `README.md:9` remove cross-platform product language if touched by this phase.

## References

- `server/hono/package.json:1`
- `package.json:9`
- `server.sh:1`
- `server.bat:1`
- `capacitor.config.ts:1`
