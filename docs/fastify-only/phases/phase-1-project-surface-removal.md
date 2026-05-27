# Phase 1: Project Surface Removal

## Goal

Remove project-level surfaces that advertise or implement non-Fastify platforms.

## Scope

- Delete `server/hono` once no package script or docs depend on it.
- Remove `hono:build`, Electron, stale sync, and other non-Fastify scripts from `package.json`.
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

## References

- `server/hono/package.json:1`
- `package.json:9`
- `server.sh:1`
- `server.bat:1`
- `capacitor.config.ts:1`
