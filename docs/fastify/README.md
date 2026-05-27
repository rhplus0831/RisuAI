# Fastify Migration Roadmap

This directory documents the migration of Risuai from a thick browser
app to a Fastify backend with a display-only client.

Policy: there are no actual Fastify users yet. Update schemas and import
paths directly; do not write compatibility migrations.

## Current State

All migration phases (0-9) are complete. The Fastify server is the only
supported runtime. A follow-up Fastify-only lockdown then removed the
residual no-port surfaces this migration left behind (Hono adapters,
desktop/mobile wrappers, service worker, local browser persistence, and
legacy client endpoints); that effort is documented under
[`phases-completed/fastify-only.md`](phases-completed/fastify-only.md).

## Read Order

1. [`plan.md`](plan.md) - goal, sequence, non-goals.
2. [`status.md`](status.md) - current progress and verification state.
3. [`runtime-stages.md`](runtime-stages.md) - client vs server
   responsibility per generation stage.
4. [`architecture.md`](architecture.md) - server module shape, API
   surface, boundary rules.
5. [`coverage/`](coverage/) - test inventories (routes, providers,
   fixtures).
6. [`removed-and-out-of-scope.md`](removed-and-out-of-scope.md) -
   deleted features and permanent browser-only surfaces.
7. [`design/`](design/) - no-port provider routing decisions.
8. [`phases-completed/`](phases-completed/) - archived phase plans,
   slice logs, and historical status.

## Locked Decisions

- **Stack.** Fastify + TypeScript.
- **Storage.** SQLite via `node:sqlite` (Node 24+) for metadata/revision.
  Domain state in `data/db.json`; content-addressed assets on disk.
- **No compatibility migrations.** No users yet; edit current shapes.
- **Sequence.** Remove first, then port. Phase 0 stripped deprecated
  features before server work began.
- **Client modes.** Server-backed web only. Desktop (Tauri), mobile
  (Capacitor), PWA-standalone, and local browser persistence modes are
  no-port and were removed by the Fastify-only lockdown.
- **Memory.** Only Hypa V3. Supa, Hypa V2, Hanurai removed.
- **Drive.** Google Drive sync removed in Phase 0.

## Conventions

- Status shards under `status/` are present-tense and updated when a
  slice lands.
- Non-Fastify runtime mentions must be either removed or explicitly
  marked `no-port`; archival mentions under `phases-completed/` are
  historical and not implementation guidance.
- Dates are absolute (`2026-05-20`), never relative.
- Cite source files as `path:line`.
