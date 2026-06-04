# Measurement Baseline & Server Clone-Cost Harness

Status: not started. Phase 0. No runtime change. Prerequisite for the provable
narrowing in Phases 1-7.

## Scope

Add the shared measurement fixture and the server-side clone-cost / load-count
assertion, and re-record the green baseline. This is the Root-1 server analog of
the landed client `cloneCostHarness.ts`.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  "How To Reproduce / Verify" and the per-finding cost claims.
- `src/ts/__tests__/cloneCostHarness.ts` - the client harness shape to mirror
  (`withCloneInstrumentation` spying clone primitives; `seedCloneCostDb`).
- `server/fastify/src/messageStore.ts` (`getAllChatMessagesGrouped`,
  `getChatMessagesGroupedByIds`), `server/fastify/src/repository.ts`
  (`loadPersisted`, `loadPersistedWithMessages`, `loadCollectionsFromSqlite`) -
  the whole-corpus loaders to spy.
- `server/fastify/src/protocolMetrics.ts`, `util/analyze-database.ts` - the
  opt-in runtime + static cost reporters.

## Planned Shape

- A seeded corpus builder (server + client importable) producing many
  characters, many/large chats, several large presets/modules/lorebooks, and
  embedding-bearing chats, large enough that a whole-corpus load is measurably
  more expensive than a scoped one.
- A server test helper `assertScopedLoadOnHotPath` (working name) that spies the
  whole-corpus loaders and asserts a count of zero on a path intended to be
  scoped — the assertion later phases call to prove M1/M3/M4/H1.
- Drive `RISU_PROTOCOL_METRICS=1` / `RISU_COMMAND_METRIC_SUMMARY=1` over the
  fixture to capture the pre-fix stage timings into
  [`../../../latest-verification.md`](../../../latest-verification.md).

## Behavior / Invariants

- Test-only; excluded from the client-lib build (like `cloneCostHarness.ts`).
- No production code path changes; this slice only adds fixtures and assertions.

## Done Criteria

- The seeded corpus fixture exists and is importable from one place for both
  suites.
- `assertScopedLoadOnHotPath` (or equivalent) can fail a test when a hot path
  performs a whole-corpus load.
- The green baseline is re-run and recorded in
  [`../../../latest-verification.md`](../../../latest-verification.md).

## Validation

- `pnpm test`, `pnpm api:test` (the new fixtures/assertions compile and pass).
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
