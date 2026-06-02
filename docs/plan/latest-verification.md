# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code commit under test: Phase 1 message-free floor sweep (`208e538a`
  on `fastify`). The 62 safe `hydrated` non-message routes were swapped from
  `applyJsonCommandMutation` to `applyMessageFreeJsonCommandMutation`; the four
  message-dependent routes (2390, 2495, 2617, 2655) keep `applyJsonCommandMutation`.
- Scope: server-only, one file (`server/fastify/src/routes/commands.ts`), 62
  lines, each a pure helper rename. Behavior is byte-for-byte unchanged — the
  swap drops only the `loadPersistedWithMessages` all-message load and the no-op
  `syncChatMessages` chat-row rewrite. No per-row write was narrowed: a swept
  route still rewrites the 13-table broad set (`BROAD_WRITE_TABLES`), so the
  Phase 0 `writtenTables` baseline still holds and the per-row gates remain
  unpopulated until Phase 2.
- Result: green. `applyJsonCommandMutation` now has 5 occurrences in
  `commands.ts` (1 import + the 4 skipped routes); `applyMessageFreeJsonCommandMutation`
  has 67 call-sites (5 pre-existing + 62 swept).

| Command | Result |
| --- | --- |
| `pnpm api:test` | 1531 passed, 1 skipped (87 files); unchanged vs the Phase 0 baseline (no new tests — behavior-preserving swap). |
| `pnpm test` | 948 passed, 4 skipped (100 files); unchanged — server-only diff. |
| `pnpm client-thinning:audit` | Passed. |
| `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test commandMetrics` | Passed; `writtenTables` broad-set baseline still asserted (message-free → 13 tables, character.selected → {characters, settings}, message commands → {messages}). |
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
- Next slice (Phase 2 settings + plugin storage): route the over-broad
  settings/pointer-only and plugin custom-storage writes onto `targeted-settings`
  / `targeted-plugin-storage` via the writer kit, land each with its rowid-stability
  test + metric gate, then re-run `pnpm api:test`, the `commandMetrics` summary,
  `pnpm client-thinning:audit`, and the type check, and refresh this file.
