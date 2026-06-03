# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 7 (verification budgets, gate-completeness
  pass) on `fastify`, on top of Phase 6 (`8e9e10bf`).
- Scope: verification only. No runtime write/projection range changed. Closed the
  one gate-map hole — the runtime emitted `targeted-assembly` (the `/generate/chat`
  scriptstate + transcript persistence path) with no review gate — by adding its
  gate (`dbJsonWriteMs: 0`, `maxTables` = broad set + message store, since it does a
  full rewrite only when a chat-var write rides along). Added
  `server/fastify/__tests__/commandMutationBudget.test.ts` (6 tests) — static
  invariants that scan the server source for every emittable `mutationPath` label
  and require the gate set and the emitted set to be exactly equal, every
  `targeted-*` gate to fix `dbJsonWriteMs: 0` and declare a written-table budget,
  the broad baselines to keep their table budget, and no budget to name a table
  outside the physical universe. Exercised the new gate against its real runtime
  metric in `generation.chat.test.ts` (the three `targeted-assembly` samples now
  assert their budget, not just the label).
- Result: green. The gate map and the runtime's emittable label set are now
  exactly equal (11 labels), so a new route, a renamed label, or a loosened narrow
  gate fails before it can silently widen a write. The per-family written-table +
  rowid-stability budgets from Phases 2-4 remain in
  `commandCollectionRange`/`commandSingleRowPaths`/`commandSettingsAndPluginStorageRange`.

| Command | Result |
| --- | --- |
| `pnpm api:test` | 1626 passed, 1 skipped. |
| `pnpm test` | 951 passed, 4 skipped. |
| `pnpm client-thinning:audit` | Passed. |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandMutationBudget.test.ts` | 6 passed; the Phase 7 gate-completeness proof. |
| `RISU_COMMAND_METRIC_SUMMARY=1` focused command suite (`commandMetrics` + `commandMutationBudget` + the four `command*Range`/ceiling + `targetedMutationPaths`) | 92 passed. |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | Passed (zero errors). |

## Notes

- The review gate for the reference fix is `mutationPath:
  'targeted-character-selection'` with `dbJsonWriteMs: 0` and `writtenTables:
  ['characters', 'settings']`. Each new narrow path adds (or reuses) the matching
  gate in `__tests__/helpers/commandMetricGates.ts` and asserts row scope through
  `assertOnlyRowsWritten` (`helpers/rowStability.ts`) before it counts as verified.
- The mutation-range metric baseline (Phase 0) is now live: `command_mutation`
  records `writtenTables`, so the before/after table set is the proof a write
  narrowed, not just timing.
- Phase 6 holds the Tier-5 routes at their floor with blockers recorded; the
  deeper per-route narrowing is gated on the deferred unblock prerequisites
  (wiring `deleteChatMessages`/`deleteChatHypaV3` into the deletes, scoping
  `normalizeScriptDefinitionDatabase`/`ensureCharacterCollection` to validate-only).
- Phase 7 exit criteria are met: every emittable `mutationPath` has a
  `dbJsonWriteMs: 0` (for `targeted-*`) review gate with a written-table budget,
  every narrowed family has its written-table + rowid-stability assertions, and
  `commandMutationBudget.test.ts` fails on any gate-map drift. The
  `latest-verification-log` maintenance rule (replace, don't append, on each run)
  stays standing.
- Next: only the optional, gated Tier-5 unblock prerequisites remain (Phase 6
  deferred work). Refresh this file after any new focused or full verification run.
