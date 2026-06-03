# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 8 (scoped Tier-5 floor unblocks) on
  `fastify`, on top of Phase 7 (`e3887777`).
- Scope: runtime write-range narrowing for the character-scoped Tier-5 routes; no
  projection change (emitted events/resources unchanged). 8a — `PUT
  characters/:id/scripts` + `/triggers` moved off the `message-free` 13-table floor
  onto `targeted-character-row`, writing only the target character row
  (`writeSingleCharacterRow`); the normalization still runs but its sibling repairs
  mutate the in-memory clone only and are discarded (validate-only via discard).
  8b — `DELETE chats/:id` moved off the `hydrated` corpus-wide message load onto
  `targeted-character-row` + the targeted `deleteChatMessages`/`deleteChatHypaV3`
  orphan cleanup; new `deleteCharacterChatRow` writer removes the one chat row.
  8c — `DELETE characters/:id` moved off `hydrated` onto `targeted-character-row`:
  delete the character row (new `deleteCharacterRow`, with position compaction) +
  all its chat rows (new `deleteCharacterChats`) + each chat's message/hypa rows
  (looped) + the re-normalized `characterOrder`/`currentChar` settings.
- Before/after written-table set: scripts/triggers `message-free` (all 13 broad
  tables) → `['characters']`; `DELETE chats/:id` `hydrated` → `['characters',
  'chat_hypa_v3', 'chats', 'messages']`; `DELETE characters/:id` `hydrated` →
  `['characters', 'chat_hypa_v3', 'chats', 'messages', 'settings']` — all with no
  message hydration. The `message-free` creates and `DELETE modules/:id` stay at
  the floor by choice (rare actions; module delete has a cross-table blocker).
- Result: green. New `server/fastify/__tests__/commandFloorUnblock.test.ts`
  (6 tests) proves the targeted paths + `writtenTables` + rowid stability + the
  deleted chat(s)' orphan message/hypa cleanup + position compaction + preserved
  selection/pointer semantics. The Phase 6 ceiling proof
  (`commandMessageFreeCeiling.test.ts`) was updated to track the four graduated
  routes. The gate-completeness invariant (`commandMutationBudget.test.ts`) still
  passes (these routes reuse the existing `targeted-character-row` gate, so the
  emittable-label set is unchanged). The client-thinning audit's A4R3 (transitive
  command-path id minting) required binding `characters[index]` to a `character`
  local before `ensureCharacterChats`.

| Command | Result |
| --- | --- |
| `pnpm api:test` | 1632 passed, 1 skipped. |
| `pnpm test` | 951 passed, 4 skipped. |
| `pnpm client-thinning:audit` | Passed. |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandFloorUnblock.test.ts` | 6 passed; the Phase 8 narrowing proof. |
| `commandMessageFreeCeiling.test.ts` (Phase 6 ceiling, updated) | 9 passed. |
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
- Phase 7 exit criteria remain met: every emittable `mutationPath` has a
  `dbJsonWriteMs: 0` (for `targeted-*`) review gate with a written-table budget,
  and `commandMutationBudget.test.ts` fails on any gate-map drift.
- Phase 8 landed the scoped Tier-5 floor unblocks (8a scripts/triggers, 8b chat
  delete, 8c character delete). Remaining deferred-by-choice: the `message-free`
  creates and `DELETE modules/:id` (separate cross-table blocker) — all rare
  actions left at the floor. Refresh this file after any new focused or full
  verification run.
