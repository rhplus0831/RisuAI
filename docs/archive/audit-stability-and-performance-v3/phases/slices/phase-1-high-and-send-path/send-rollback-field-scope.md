# Slice: Send Rollback Field Scope

Phase: [1](../../phase-1-high-and-send-path.md). Depends on the Phase 0
send clone-count probe. Runtime change.

## Scope

Fix M5 by replacing the per-send full character-row snapshot in
`setupSendChatContext` with a field-scoped rollback snapshot. In steady state,
rollback should restore only `lastInteraction`; only the first-send
message-id backfill branch may snapshot and restore the active chat's
pre-mutation `message[]`.

## Anchors

- `src/ts/process/sendChatContext.ts`: `setupSendChatContext`, the
  `currentCharacterRowSnapshot(selectedChar)` call, `lastInteraction` update,
  message-id backfill, and `runOptimisticCommandSequence` rollback.
- `src/ts/characterCommands.ts`: `currentCharacterRowSnapshot`,
  `restoreCharacterRow`, `CharacterSelectionSnapshot`,
  `restoreCharacterSelection`, `cloneJsonValue`, and character locator
  helpers.
- `src/ts/chatCommands.ts`: `toMessageSnapshot` and optimistic command
  sequencing.
- Tests: `src/ts/process/__tests__/sendChatContext.test.ts`,
  `src/ts/characterCommands.test.ts`, and the Phase 0 send clone-count probe.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  `docs/plan/active-risk-analysis.md` for M5 gate registration.

## Target Shape

- Add a send-specific snapshot shape, or equivalent helper pair, that mirrors
  the scalar style of `CharacterSelectionSnapshot`:
  `characterId`, selection/index locator data, pre-mutation
  `lastInteraction`, and optionally the active `chatId` plus a cloned
  pre-mutation `message[]`.
- In `setupSendChatContext`, capture the snapshot before mutating
  `lastInteraction` or backfilling message ids.
- In the normal steady-state branch, do not clone `character`, `chats`, or
  `message[]`; keep only the scalar `lastInteraction` rollback data needed by
  the character update command.
- When `needsMessageIdBackfill` is true, clone only
  `selectedChatRecord.message` before adding missing ids. Restore only that
  active chat's `message[]` if the optimistic command sequence fails.
- Replace the rollback passed to `runOptimisticCommandSequence` with the new
  narrowed restore. Leave `currentCharacterRowSnapshot` and
  `restoreCharacterRow` available for other real whole-row callers.
- Register M5 as `DONE` in the v3 gate with focused rollback and clone-count
  tests, and flip only the M5 row in `active-risk-analysis.md` in the same
  change.

## Invariants

- Steady-state send rollback never deep-clones or restores the full character
  row.
- First-send backfill rollback may restore `message[]`, but only for the
  active chat whose ids were backfilled.
- `lastInteraction` rollback changes only that field and does not overwrite
  sibling character fields, chats, scriptstate, lore, modules, or hydrated
  sibling chat data.
- Existing broad character-row rollback helpers remain for non-send callers
  that still mutate a whole row.
- Local/non-server-backed send behavior remains unchanged except for avoiding
  unnecessary rollback state.

## Done Criteria

- A steady-state server-backed send updates `lastInteraction` with no
  `message[]` or whole-character clone in the send clone-count probe.
- A first-send backfill test proves missing message ids are backfilled and a
  simulated command failure restores only the pre-mutation active-chat
  messages.
- A rollback isolation test proves fields unrelated to `lastInteraction` and
  first-send message ids are not overwritten by a failed send command.
- Existing character command tests still cover whole-row snapshots for their
  remaining callers.
- M5 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run src/ts/process/__tests__/sendChatContext.test.ts src/ts/characterCommands.test.ts src/ts/__tests__/sendCloneCountProbe.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
