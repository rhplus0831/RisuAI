# Measurement Baseline & Server Clone-Cost Harness

Status: not started. Phase 0. No runtime change.

## Scope

Add the shared large-corpus fixture, the server load-count assertion, and the
fresh green baseline. This is the server analog of `cloneCostHarness.ts`.

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

- A seeded corpus builder usable by server and client tests. It should include
  many characters, large chats, presets/modules/lorebooks, and embeddings.
- A server helper such as `assertScopedLoadOnHotPath` that spies whole-corpus
  loaders and asserts zero calls on scoped paths.
- Run `RISU_PROTOCOL_METRICS=1` / `RISU_COMMAND_METRIC_SUMMARY=1` on the fixture
  and record pre-fix timings in
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
