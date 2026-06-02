# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code commit under test: Phase 0 baseline foundations
  (`b457f05d`→`e2ab16ed` on `fastify`). No route was narrowed; the changes add
  the writer kit, the `TARGETED_MUTATION_PATHS` vehicles, the `writtenTables`
  mutation-range metric + importable review-gate / rowid-stability templates, and
  `assertOnlyRowsWritten`.
- Scope: server-only (`repository.ts`, `messageStore.ts`, `protocolMetrics.ts`,
  `commands/mutations.ts`, two new test helpers, two new test files, the metric +
  character-selection regression). The only narrow runtime path is still
  `b57df5cd` (`characters/select`); the new vehicles are tested but not yet wired
  to any over-broad route.
- Result: green. The over-broad before-state is recorded — every sampled
  `message-free`/`hydrated` command rewrites the 13-table broad set
  (`BROAD_WRITE_TABLES`) for one sub-row change.

| Command | Result |
| --- | --- |
| `pnpm api:test` | 1531 passed, 1 skipped (87 files); +14 tests vs the 1517 baseline (writer kit + targeted paths). |
| `pnpm test` | 948 passed, 4 skipped (100 files); unchanged — server-only diff. |
| `pnpm client-thinning:audit` | Passed. |
| `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test commandMetrics` | Passed; `writtenTables` baseline asserted (message-free → 13 tables, character.selected → {characters, settings}, message commands → {messages}). |
| `pnpm api:test repositoryWriterKit` / `pnpm api:test targetedMutationPaths` | 8 / 6 passed. |
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
- Next slice (Phase 1 floor): re-run `pnpm api:test`, `pnpm client-thinning:audit`,
  and the type check, and refresh this file with the result.
