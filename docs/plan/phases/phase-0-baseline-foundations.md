# Phase 0: Baseline & Harness Foundations

Status: not started. No runtime change.

Goal: add the shared proof tools: a seeded large-corpus fixture, a server
load-count assertion, and a fix-completeness gate scaffold.

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
  the server load-count assertion must be able to detect on a hot path.

## Slices

- [`measurement-baseline-harness.md`](slices/phase-0-baseline-foundations/measurement-baseline-harness.md) -
  seeded large-corpus fixture plus a server load-count assertion that fails when
  a scoped hot path calls a whole-corpus loader. Re-run and record the baseline
  in [`../latest-verification.md`](../latest-verification.md).
- [`fix-completeness-gate-scaffold.md`](slices/phase-0-baseline-foundations/fix-completeness-gate-scaffold.md) -
  standing test that registers each scheduled fix by id and fails when a
  registered gate is missing or renamed. Seed planned ids as `PLANNED`.

## Planned Shape

- The corpus fixture is reusable by server load/projection/command tests and
  client clone-cost tests.
- The server load-count assertion spies the whole-corpus loaders
  (`getAllChatMessagesGrouped`, unscoped `loadPersisted`/`loadCollectionsFromSqlite`)
  the same way the client harness spies `JSON.stringify`/`structuredClone`, and
  asserts the count is zero on a path that is supposed to be scoped.
- The completeness gate lists every scheduled finding id. Phase 0 marks each id
  `PLANNED`; later phases replace that with a registered test path.

## Exit Criteria

- [ ] A seeded large-corpus fixture exists and is importable from one place for
      both suites.
- [ ] A server-side load-count assertion exists and can fail a test
      when a hot path performs a whole-corpus load.
- [ ] The fix-completeness gate scaffold exists, lists all scheduled finding ids,
      and fails if a registered (non-`PLANNED`) gate goes missing.
- [ ] No runtime behavior changed; the baseline in
      [`../latest-verification.md`](../latest-verification.md) is re-run and
      recorded green.

## Validation

- `pnpm test` (client suite + new harness/gate tests).
- `pnpm api:test` (server suite + new server load-count assertion).
- `pnpm client-thinning:audit`.
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
