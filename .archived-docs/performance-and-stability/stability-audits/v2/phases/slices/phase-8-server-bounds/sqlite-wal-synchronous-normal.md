# Slice: SQLite WAL Synchronous Normal

Phase: [8](../../phase-8-server-bounds.md). Finding: L15. Runtime change.
Status: done on 2026-06-06 KST.

## Scope

Set SQLite `PRAGMA synchronous = NORMAL` after enabling WAL so command commits
use the standard WAL durability/performance trade-off.

This slice does not own schema migration work, transaction batching, command
mutation shape, or any broader index cleanup. I3's unused-index drop may ride
along only if it is free and separately documented.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L15.
- `server/fastify/src/db.ts`: database open/init path, WAL pragma, schema
  version setup, and any DB helper exposed to tests.
- Existing focused suite: `server/fastify/__tests__/db.test.ts`.
- Durability note homes: this slice doc, a short code comment near the pragma,
  or `docs/structure/data-and-events.md` if implementation needs present-tense
  operational documentation.

## Target Shape

- Set `PRAGMA synchronous = NORMAL` immediately after `journal_mode = WAL` on
  every Fastify database open.
- Keep any schema bootstrap and migration ordering unchanged.
- Add a focused assertion that a newly opened DB reports `NORMAL` after init.
- Record the trade-off plainly: WAL remains crash-safe for database
  consistency, while the last transactions can be lost on OS/power failure.
- Register L15 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Schema version, table/index creation, and import/restore behavior remain
  unchanged.
- The pragma is applied to the same SQLite connection used by command
  mutations.
- The change must not hide or ignore SQLite errors during open/init.

## Done Criteria

- `db.test.ts` proves a Fastify DB opens with `synchronous = NORMAL`.
- The durability trade-off is visible in code or docs.
- The L15 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Proof

- Runtime/code docs: `server/fastify/src/db.ts` sets
  `PRAGMA synchronous = NORMAL` immediately after WAL and records the
  WAL/NORMAL durability trade-off; `docs/structure/data-and-events.md` mirrors
  the operational note.
- Regression proof:
  `server/fastify/__tests__/db.test.ts` /
  `L15: opens Fastify databases with WAL synchronous NORMAL`.
- Gate proof:
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L15 `DONE` with
  the focused DB test path/name;
  `.archived-docs/performance-and-stability/stability-audits/v2/active-risk-analysis.md`
  marks L15 `DONE`.
- Validation: `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/db.test.ts`
  passed, 1 file / 11 tests;
  `pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts`
  passed, 1 file / 18 tests;
  both TypeScript project-reference checks passed with zero diagnostics.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/db.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
