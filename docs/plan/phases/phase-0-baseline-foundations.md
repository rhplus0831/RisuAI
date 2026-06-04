# Phase 0: Baseline & Harness Foundations

Status: not started. No runtime behavior changes in this phase; it makes the
later narrowing provable and the bounds testable.

Goal: stand up the shared measurement and regression foundations every later
phase depends on — a seeded large-corpus fixture, a server-side clone-cost
assertion (the Root-1 analog of the existing client clone-cost harness), and a
fix-completeness gate scaffold so no fix's proof can be silently dropped.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  the five cross-cutting roots, the "How To Reproduce / Verify" section, and the
  per-finding cost claims each fixture must be able to exhibit.
- `src/ts/__tests__/cloneCostHarness.ts` and
  `src/ts/__tests__/cloneCostGateCompleteness.test.ts` - the landed client
  clone-cost harness and self-checking gate map; the templates to mirror
  server-side.
- `server/fastify/src/protocolMetrics.ts`,
  `server/fastify/src/routes/generationChat.ts` (`databaseLoadMs`/`Count`) -
  the opt-in stage timings to drive on a real corpus.
- `util/analyze-database.ts` (`pnpm analyze:db`) - the static-corpus cost
  reporter.
- `server/fastify/src/messageStore.ts`
  (`getAllChatMessagesGrouped` vs `getChatMessagesGroupedByIds`) and
  `server/fastify/src/repository.ts` (`loadPersisted`) - the whole-corpus loaders
  the server clone-cost assertion must be able to detect on a hot path.

## Slices

- [`measurement-baseline-harness.md`](slices/phase-0-baseline-foundations/measurement-baseline-harness.md) -
  a seeded multi-character / multi-large-chat / preset-heavy / embedding-bearing
  corpus fixture, plus a server-side test assertion
  (`assertScopedLoadOnHotPath` / load-count spy) that fails when a hot path calls
  the whole-corpus loader where a scoped load is intended. Re-run and record the
  green baseline in [`../latest-verification.md`](../latest-verification.md).
- [`fix-completeness-gate-scaffold.md`](slices/phase-0-baseline-foundations/fix-completeness-gate-scaffold.md) -
  a standing test that registers each scheduled fix's regression test by id
  (`H1`..`L40`) and fails when a registered gate is missing or renamed, so a
  later refactor cannot delete a fix's proof. Pre-seed it with the planned ids in
  a `PLANNED` state.

## Planned Shape

- The corpus fixture is reusable by both the server suite (load/projection/
  command cost) and the client suite (clone cost on a hydrated store).
- The server clone-cost assertion spies the whole-corpus loaders
  (`getAllChatMessagesGrouped`, unscoped `loadPersisted`/`loadCollectionsFromSqlite`)
  the same way the client harness spies `JSON.stringify`/`structuredClone`, and
  asserts the count is zero on a path that is supposed to be scoped.
- The completeness gate lists every scheduled finding id and the test file that
  proves it; in Phase 0 every id is `PLANNED`, and each later phase flips its ids
  to a registered test path.

## Exit Criteria

- [ ] A seeded large-corpus fixture exists and is importable from one place for
      both suites.
- [ ] A server-side clone-cost / load-count assertion exists and can fail a test
      when a hot path performs a whole-corpus load.
- [ ] The fix-completeness gate scaffold exists, lists all scheduled finding ids,
      and fails if a registered (non-`PLANNED`) gate goes missing.
- [ ] No runtime behavior changed; the baseline in
      [`../latest-verification.md`](../latest-verification.md) is re-run and
      recorded green.

## Validation

- `pnpm test` (client suite + new harness/gate tests).
- `pnpm api:test` (server suite + new server clone-cost assertion).
- `pnpm client-thinning:audit`.
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
