# Reroll / Swipe Rollback

Status: planned. Phase 2. Depends on the Phase 0 `currentChatScopedSnapshot`. The
redundant-clone and tail-clone reorder are Phase 3 (cheap wins); this slice is the
rollback-baseline narrowing.

## Scope

Replace the full-characters `currentChatStateSnapshot()` rollback baseline in the
reroll/swipe `apply*` helpers with a chat-scoped active-chat rollback, so a
navigation swipe (the common case, fully synchronous, blocking the gesture) clones
only the active chat, not every character's hydrated history.

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

- Replace `currentChatStateSnapshot()` in `applyTailDataSwap` / `applyTailSlice` /
  `applyTranscript` with the chat-scoped snapshot (Phase 0): capture only the
  active chat's prior `message[]` (plus indices) and restore just that chat inside
  `withTrustedServerProjectionWrite` (`restoreActiveChatMessages` / the kit's
  `restoreChatScopedState`).
- The redundant `safeStructuredClone(record.message)` at `:105` and the full
  transcript clone at `:147` are removed in Phase 3 (cheap wins); cross-reference
  them but keep this slice scoped to the rollback baseline if landed separately.

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
