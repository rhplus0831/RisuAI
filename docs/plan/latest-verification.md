# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code commit under test: Phase 3 single character/chat-row paths
  (`07971179`→`65e57c0a` on `fastify`, four stages). All 12 Tier-3 routes write
  only their target character/chat row(s) + documented co-writes:
  `targeted-character-row` for the pure character-row edits + the
  chat-folder/reorder cascades + fork; `targeted-chat-row` for scriptstate,
  chats/:id, and chats/:id/lorebooks.
- Scope: server (`routes/commands.ts` 12 routes; `repository.ts` adds
  `writeCharacterChatRows` + `insertCharacterChatRow`), the `targeted-character-row`
  gate widened to {characters, chats, settings, + message-store tables for fork}
  while forbidding the nine other-collection tables, the `commandMetrics.test.ts`
  update (chat.updated → `targeted-chat-row`/`['chats']`), and the new
  `commandSingleRowPaths.test.ts` (15 tests).
- Result: green. The hot scriptstate path no longer hydrates messages or rewrites
  every character; fork persists the forked chat + its messages surgically while
  preserving the source chat's messages; rowid-stability proves unrelated
  character/chat rows keep their rowids.

| Command | Result |
| --- | --- |
| `pnpm api:test` | 1556 passed, 1 skipped (89 files); +15 vs the Phase 2 baseline (the new Phase 3 regression). |
| `pnpm test` | 948 passed, 4 skipped (100 files); unchanged — server-only diff. |
| `pnpm client-thinning:audit` | Passed. |
| `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test commandMetrics` | Passed; chat.updated now `targeted-chat-row`/`['chats']`. |
| `pnpm api:test commandSingleRowPaths` | 15 passed (targeted path + exact `writtenTables` + rowid stability across the character-row, chat-row, cascade, and fork families). |
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
- Next slice (Phase 4 collection-table paths): narrow the Tier-4 collection
  families (plugins first — its projection is already narrow) onto
  `targeted-collection` via `writeSingleCollectionRow` / `writeSingleCollectionTable`
  + the family's pointer-settings co-write, pairing each with its Phase 5
  projection-field co-fix; each lands with its rowid-stability test + metric gate,
  then re-run `pnpm api:test`, the `commandMetrics` summary,
  `pnpm client-thinning:audit`, and the type check, and refresh this file.
