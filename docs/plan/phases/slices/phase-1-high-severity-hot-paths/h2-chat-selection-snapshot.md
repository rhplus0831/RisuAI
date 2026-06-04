# H2 — Chat-Selection Scalar Snapshot

Status: IMPLEMENTED (`067ab82a`). Phase 1. Mirrors the landed char-select fix
(`c9e728b1`) for chat select.

Landed shape: `ChatSelectionSnapshot` / `currentChatSelectionSnapshot()` /
`restoreChatSelection()` + `dispatchSelectChat()` in `chatCommands.ts`. The
restore writes only the owning character's `chatPage` (located by `chaId`,
`selectedCharID` kept as the index fallback only — chat select never mutates
the character selection, so the restore must not re-write it). Wired into both
select sites: `changeChatTo` (`globalApi.svelte.ts`) and the sidebar
`selectChat` direct dispatch (`SideChatList.svelte`, which previously captured
the whole-array snapshot per click even though it performs no optimistic
write). Proofs: `src/ts/globalApi.changeChatTo.test.ts` (end-to-end clone-cost
gate) + the `chatCommands.test.ts` H2 block (zero-clone scalar snapshot,
rollback-restores-only, stable-chaId restore, dispatch wiring); both
registered in `cloneCostGateCompleteness.test.ts`. Gate `H2` flipped in
`fixCompletenessGate.test.ts` + `active-risk-analysis.md`.

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
  target `chatPage`, and `chaId`; restore only the owning character's
  `chatPage`. `selectedCharID` is only an index fallback for locating that row.
- `changeChatTo` dispatches its empty-patch select with the scalar rollback
  instead of `currentChatStateSnapshot()`.
- Keep `currentChatStateSnapshot` for genuine restructures.

## Behavior / Invariants

- The optimistic write (set `chatPage`, dispatch select) and the command/
  revision/event behavior are unchanged.
- A failed select restores only the owning character's `chatPage`; it must not
  clobber unrelated edits or rewrite character selection.
- Rendered chat after select is identical.

## Done Criteria

- A clone-cost test (reuse `cloneCostHarness.ts`) proves `changeChatTo` does not
  invoke a whole-`characters` clone primitive.
- A rollback-correctness test proves a failed select restores only the owning
  `chatPage` and leaves a concurrent sibling edit and character selection intact.
- `currentChatStateSnapshot` remains in use for create/delete/reorder/fork.
- Gate `H2` registered in the Phase 8 completeness map.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/compatibilityAdapters.test.ts`.
- `pnpm test`, `pnpm client-thinning:audit`, both TypeScript checks.
