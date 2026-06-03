# Reroll / Swipe Rollback

Status: planned. Phase 2. Depends on the Phase 0 `currentChatScopedSnapshot`.
Phase 3 handles redundant clone removal.

## Scope

Replace full-characters rollback in reroll/swipe `apply*` helpers with a
chat-scoped active-chat rollback. Swipe navigation should clone only the active
chat.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the High "reroll/unReroll/applyTailSlice" finding.
- `src/ts/process/rerollNavigation.svelte.ts:83` - `applyTailDataSwap`.
- `src/ts/process/rerollNavigation.svelte.ts:95/105` - `applyTailSlice`
  (`currentChatStateSnapshot()` + the redundant `safeStructuredClone(record.message)`
  the dispatch re-clones).
- `src/ts/process/rerollNavigation.svelte.ts:111` - `applyTranscript`.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:949/950/1202/701/830` -
  `reroll()`/`unReroll()` swipe/gesture/side-menu bindings.

## Target Implementation

- Replace `currentChatStateSnapshot()` in `applyTailDataSwap`, `applyTailSlice`,
  and `applyTranscript` with the Phase 0 chat-scoped snapshot.
- Leave the redundant `safeStructuredClone(record.message)` and full transcript
  clone to Phase 3 if this slice lands separately.

## Behavior / Invariants

- Swipe navigation (cycling buffered candidates through `applyTailSlice`) stays
  synchronous and correct; the buffered-candidate tail clones at `:139/187` are
  bounded and untouched.
- A failed `dispatchReplaceMessages` restores only the active chat's `message[]`.
- Rerolled/persisted message bytes are identical.

## Done When

- The three `apply*` helpers capture a chat-scoped rollback; none clones every
  character (clone-cost harness).
- Rollback-correctness test proves a failed swipe/replace restores only the active
  chat.
- `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/process/rerollNavigation` (or the reroll suite)
- `pnpm test`
- `pnpm client-thinning:audit`
