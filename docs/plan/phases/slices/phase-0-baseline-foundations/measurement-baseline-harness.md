# Measurement Baseline & Server Clone-Cost Harness

Status: implemented. Phase 0. No runtime change.

## Scope

Add the shared large-corpus fixture, the server load-count assertion, and the
fresh green baseline. This is the server analog of `cloneCostHarness.ts`.

## What Landed

- `src/ts/__tests__/largeCorpusFixture.ts` — `buildLargeCorpusFixture()`, the
  one seeded corpus builder both suites import. Deterministic and
  self-contained (zero imports), so it compiles under the server's strict
  tsconfig and the client test transform alike. Defaults: 12 characters x 3
  chats, one hot chat (120 messages + HypaV3 summaries), every collection
  family populated, per-character card bulk (`characterBulkBytes`), and
  deterministic embedding vectors for memory-table seeding. Handles:
  `hot` (messages + `hypaV3Data` — hydration is scoped today) and `noHypa`
  (message rows, no `chat_hypa_v3` row — the exact H1 fallback shape).
- `server/fastify/__tests__/helpers/loadCostHarness.ts` — the server
  load-count assertion. Spies the SQLite execution primitive
  (`StatementSync.prototype.all/get/iterate`) the way the client harness spies
  `JSON.stringify`/`structuredClone`, and classifies each executed statement:
  a SELECT of a payload column from a corpus table without a row-scoping
  predicate is a whole-corpus load. Exports `withServerLoadInstrumentation`
  (counts per table), `assertScopedLoadOnHotPath` (throws with the offending
  SQL; optional `allowTables`), and `classifyCorpusStatement`.
- `server/fastify/__tests__/serverLoadCostHarness.test.ts` — self-proof:
  classifier unit tests against the real loader SQL; a scoped route passes
  (`chatMessages` hydration of the hot chat — zero corpus loads); the H1
  fallback (no-hypa chat) is detected (13 corpus loads) and FAILS
  `assertScopedLoadOnHotPath`; bulk hydration breadth (U1) is detected;
  `loadPersistedWithMessages` vs `getChatMessagesGroupedByIds` separate at the
  function level; spy restoration on throw.
- `src/ts/__tests__/largeCorpusFixture.test.ts` — client-side import +
  structural sanity (deliberately NOT a clone-cost gate: it does not import
  the clone harness, so the gate-completeness scan ignores it).

## Flip Notes For Later Phases

- Phase 1 flipped the H1 no-hypa fallback from a "CURRENT breadth" assertion to
  `assertScopedLoadOnHotPath`. The remaining broad positive controls are the
  legitimate zero-row embedded fallback and the U1 bulk known-id check. The phase
  that narrows U1 must flip its block to `assertScopedLoadOnHotPath` — the
  comments mark the exact spot.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  "How To Reproduce / Verify" and the per-finding cost claims.
- `src/ts/__tests__/cloneCostHarness.ts` - the client harness shape mirrored
  (`withCloneInstrumentation` spying clone primitives; `seedCloneCostDb`).
- `server/fastify/src/messageStore.ts` (`getAllChatMessagesGrouped`,
  `getChatMessagesGroupedByIds`), `server/fastify/src/repository.ts`
  (`loadPersisted`, `loadPersistedWithMessages`, `loadCollectionsFromSqlite`) -
  the whole-corpus loaders spied.
- `server/fastify/src/protocolMetrics.ts`, `util/analyze-database.ts` - the
  opt-in runtime + static cost reporters.

## Behavior / Invariants

- Test-only; excluded from the client-lib build (like `cloneCostHarness.ts`).
- No production code path changes; this slice only adds fixtures and assertions.
- The statement spy is process-global while active: keep background DB writers
  (asset GC, memory worker) disabled in the harness app and do not run
  instrumented sections concurrently.

## Done Criteria

- [x] The seeded corpus fixture exists and is importable from one place for both
      suites (`largeCorpusFixture.test.ts` client-side,
      `serverLoadCostHarness.test.ts` server-side).
- [x] `assertScopedLoadOnHotPath` can fail a test when a hot path performs a
      whole-corpus load (proven by the H1-fallback rejects-with-SQL assertion).
- [x] The green baseline is re-run and recorded in
      [`../../../latest-verification.md`](../../../latest-verification.md),
      including the pre-fix fixture measurements.

## Validation

- `pnpm test`, `pnpm api:test` (the new fixtures/assertions compile and pass).
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Measurement repro: `RISU_PROTOCOL_METRICS=1 pnpm exec vitest run --config
  server/fastify/vitest.config.ts --reporter=verbose serverLoadCostHarness`
  prints the `[load-cost]` lines (the default reporter hides stdout).
