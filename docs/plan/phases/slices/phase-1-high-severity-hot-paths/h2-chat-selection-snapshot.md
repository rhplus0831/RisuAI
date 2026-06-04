# H2 — Chat-Selection Scalar Snapshot

Status: not started. Phase 1. Mirrors the already-landed char-select fix
(`c9e728b1`) for the chat-select path that was left on the broad clone.

## Scope

`changeChatTo` opens with `const previous = currentChatStateSnapshot()`, which
deep-clones the entire `characters` array (and every hydrated transcript) via
`cloneJsonValue` on the UI thread, before flipping one scalar (`chatPage`) and
dispatching an empty-patch select. There is no scalar chat-selection snapshot
analog to `CharacterSelectionSnapshot`. Add one and use it.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  finding **H2**.
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

- Add `ChatSelectionSnapshot` + `currentChatSelectionSnapshot()` +
  `restoreChatSelection()` in `chatCommands.ts`: capture `selectedCharID` and the
  target character's `chatPage` (and `chaId` to relocate on restore); restore
  locates the character by `chaId` inside `withTrustedServerProjectionWrite` and
  writes back only `chatPage`/`selectedChar`.
- `changeChatTo` dispatches its empty-patch select with the scalar rollback
  instead of `currentChatStateSnapshot()`.
- Keep `currentChatStateSnapshot` for genuine restructures.

## Behavior / Invariants

- The optimistic write (set `chatPage`, dispatch select) and the command/
  revision/event behavior are unchanged.
- A failed select restores only `chatPage`/`selectedChar`; it must not clobber
  unrelated concurrent character/chat edits the full-array restore would have
  wiped (`restoreCharacterSelection` correctness property).
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
