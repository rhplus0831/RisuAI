# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 6 (the Tier-5 message-free ceiling) on
  `fastify`, on top of Phase 5 (`608de26c`).
- Scope: verification + documentation only. No runtime write/projection range
  changed. Added `server/fastify/__tests__/commandMessageFreeCeiling.test.ts`
  (9 tests) proving each Tier-5 route sits at its safe floor (`hydrated` where the
  message load is a real dependency, else `message-free`) and that the documented
  blocker is load-bearing; corrected the seed audit's `DELETE chats/:id` floor
  claim (it stays `hydrated` for orphan-message cleanup, not `message-free`).
- Result: green. The deletes prove `syncChatMessages` cleans the deleted
  chat/character's message rows (no FK cascade, no message GC); the chats-create
  proves corpus-wide `messageIdExists` validation; the module delete + creates +
  script/trigger PUTs report `message-free` writing exactly the broad set.

| Command | Result |
| --- | --- |
| `pnpm api:test` | 1620 passed, 1 skipped. |
| `pnpm test` | 951 passed, 4 skipped. |
| `pnpm client-thinning:audit` | Passed. |
| `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandMessageFreeCeiling.test.ts` | 9 passed; the Phase 6 floor + blocker proof. |
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
- Next: Phase 7 verification budgets. Refresh this file after any new focused or
  full verification run.
