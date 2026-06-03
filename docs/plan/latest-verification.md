# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code commit under test: Phase 5 projection-range narrowing through
  `608de26c` on `fastify`, with the docs closure commit `2a1acbea`.
- Scope: read/refresh narrowing only. `prompt` falls back to full/sprawling
  (`314af90f`); module and script/trigger resources narrow to
  `moduleEnabled`/`moduleUpdated`/`moduleReordered` and
  `moduleScriptDefinition`/`moduleTriggerDefinition` (`f94e51ab`); the broad
  `lorebook` resource splits into `globalLorebook` plus per-row lorebook resources
  (`c3fff925`); `generation.persisted` uses `generation-chat` and
  character/chat metadata events use `characterRow` (`608de26c`).
- Result: green. No write range changed in Phase 5; the foreign/recovery
  projection side now matches the narrowed write ranges from Phases 2-4.

| Command | Result |
| --- | --- |
| `pnpm api:test` | 1611 passed, 1 skipped. |
| `pnpm test` | 951 passed, 4 skipped. |
| `pnpm client-thinning:audit` | Passed. |
| `pnpm api:test -- server/fastify/__tests__/projection.test.ts` | Passed; covers prompt fallback, module/script/trigger resources, lorebook split, `characterRow`, and `generation-chat`. |
| `pnpm test -- src/ts/bootstrap.test.ts` | Passed; covers client application of `characterRow`, `character-lorebook`, and `generation-chat`. |
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
- Next runtime slice: Phase 6 Tier-5 floor routes and unblock conditions.
  Refresh this file after any new focused or full verification run.
