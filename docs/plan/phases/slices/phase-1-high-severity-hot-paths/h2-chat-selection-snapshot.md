# H2 — Chat-Selection Scalar Snapshot

Status: not started. Phase 1. Mirrors the landed char-select fix (`c9e728b1`)
for chat select.

## Scope

`changeChatTo` starts with `currentChatStateSnapshot()`, deep-cloning the
`characters` array and hydrated transcripts before flipping `chatPage` and
dispatching an empty-patch select. Add a scalar chat-selection snapshot and use
it here.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  finding H2.
- `src/ts/globalApi.svelte.ts:1817` (`changeChatTo`).
- `src/ts/chatCommands.ts:73-78` (`currentChatStateSnapshot` / `restoreChatState`,
  `cloneJsonValue`) and the scoped helpers added by the earlier workstream.
- `src/ts/characterCommands.ts` (`CharacterSelectionSnapshot` /
  `currentCharacterSelectionSnapshot` / `restoreCharacterSelection` — the
  template).
- Call sites: `src/lib/Others/ChatList.svelte`,
  `src/lib/SideBars/SideChatList.svelte`.
- Proof template: `src/ts/compatibilityAdapters.test.ts`.

## Planned Shape

- Add `ChatSelectionSnapshot`, `currentChatSelectionSnapshot()`, and
  `restoreChatSelection()` in `chatCommands.ts`. Capture `selectedCharID`,
  target `chatPage`, and `chaId`; restore only `chatPage`/`selectedChar`.
- `changeChatTo` dispatches its empty-patch select with the scalar rollback
  instead of `currentChatStateSnapshot()`.
- Keep `currentChatStateSnapshot` for genuine restructures.

## Behavior / Invariants

- The optimistic write (set `chatPage`, dispatch select) and the command/
  revision/event behavior are unchanged.
- A failed select restores only `chatPage`/`selectedChar`; it must not clobber
  unrelated edits.
- Rendered chat after select is identical.

## Done Criteria

- A clone-cost test (reuse `cloneCostHarness.ts`) proves `changeChatTo` does not
  invoke a whole-`characters` clone primitive.
- A rollback-correctness test proves a failed select restores only the selection
  scalars and leaves a concurrent sibling edit intact.
- `currentChatStateSnapshot` remains in use for create/delete/reorder/fork.
- Gate `H2` registered in the Phase 8 completeness map.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/compatibilityAdapters.test.ts`.
- `pnpm test`, `pnpm client-thinning:audit`, both TypeScript checks.
