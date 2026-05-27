# Phase 9 Client Thinning - 9-5e-i

Date: 2026-05-26

## Scope

Projection write gate foundation. This sub-slice added the server-backed
read-only `DBState.db` guard primitive and trusted projection replacement
helpers for bootstrap/event refresh writes.

## Landed

- Added an opt-in Fastify projection write guard in
  `src/ts/storage/database.svelte.ts`.
- Added `applyServerProjectionDatabase()` as the trusted full-projection
  replacement helper used by initial bootstrap and event-triggered
  re-bootstrap refreshes.
- The guard freezes projected database snapshots in Fastify mode when
  enabled, causing direct scalar, nested object, and array-mutator writes
  to fail loudly while preserving legacy local mode behavior.
- Kept the guard foundation out of command optimistic/rollback write
  integration. That remains the next 9-5e slice.

## Verification

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts
pnpm check
```

Results:

- `src/ts/bootstrap.test.ts` and `src/ts/server/bootstrap.test.ts` - 9
  tests passed.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.

## Handoff

Continue with **9-5e-ii - Command bridge guard integration**. Route
command-owned optimistic updates and rollback paths through trusted write
scopes or remove local writes where projection refresh is authoritative.
Do not add new command endpoints in this slice. Keep full fixture-path
guard enablement and residual failure classification for **9-5e-iii**.
