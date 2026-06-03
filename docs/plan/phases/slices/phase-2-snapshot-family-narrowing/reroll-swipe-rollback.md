# Reroll / Swipe Rollback

Status: implemented. Phase 2. Depends on the Phase 0 `currentChatScopedSnapshot`.
Phase 3 handles redundant clone removal.

Landed: `applyTailDataSwap`, `applyTailSlice`, and `applyTranscript` in
`rerollNavigation.svelte.ts` capture `currentChatScopedSnapshot()` instead of
`currentChatStateSnapshot()`, and persist through `dispatchUpdateMessageScoped` /
`dispatchReplaceMessagesScoped` (the Phase 0 chat-scoped dispatch variants), so a
failed swipe restores only the active chat row, never the whole characters array.
The redundant `safeStructuredClone(record.message)` / full-transcript clones are
left to Phase 3. Proof: `rerollNavigation.rollback.test.ts` (clone-cost: a swipe
never serializes the large sibling transcript; rollback: a failed
`dispatchReplaceMessagesScoped` restores only the active chat). The unit and guard
suites now assert the scoped dispatch variants.

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

## Implemented Shape

- `applyTailDataSwap`, `applyTailSlice`, and `applyTranscript` use
  `currentChatScopedSnapshot()`.
- Persistence goes through `dispatchUpdateMessageScoped` /
  `dispatchReplaceMessagesScoped`, so rollback restores only the active chat.
- The redundant `safeStructuredClone(record.message)` and reroll full-transcript
  clone are intentionally left for Phase 3.

## Behavior / Invariants

- Swipe navigation (cycling buffered candidates through `applyTailSlice`) stays
  synchronous and correct; the buffered-candidate tail clones at `:139/187` are
  bounded and untouched.
- A failed `dispatchReplaceMessagesScoped` restores only the active chat's
  `message[]`.
- Rerolled/persisted message bytes are identical.

## Proven

- Clone-cost coverage proves swipe does not serialize a large sibling transcript.
- Rollback-correctness coverage proves a failed swipe/replace restores only the
  active chat.

## Validation

- `pnpm test -- src/ts/process/rerollNavigation.test.ts src/ts/process/rerollNavigation.rollback.test.ts src/ts/process/rerollNavigation.guard.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
