# Cheap Clone Wins

Status: landed (reroll `ed4e0af0`, `runTrigger` `f4855e24`). Phase 3.
Independent of the Phase 0 kit; three behavior-preserving edits.

## Scope

Land the high-confidence clone wins: clone only the reroll tail, drop redundant
reroll dispatch clones, and return early in `runTrigger` before char/chat clones.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the High `recordGeneratedReroll`, the High reroll redundant-clone, and the
  Medium `runTrigger` clone-before-early-return findings.
- `src/ts/process/rerollNavigation.svelte.ts` - `recordGeneratedReroll`, the
  redundant `safeStructuredClone(record.message)`, and the full-transcript clone
  in `reroll()`.
- `src/ts/process/triggers.ts` - `runTrigger` char/chat clones before the
  `triggers.length === 0` return.
- `src/ts/process/sendChatCompletion.ts:25` - the `recordGeneratedReroll` caller.

## Target Implementation (as landed)

1. Reroll tail clone: swap the slice/clone order so only the tail is
   deep-cloned:
   `rerolls.push(safeStructuredClone(message.slice(previousLength)))`.
   Byte-identical and O(tail). **Landed verbatim.**
2. Redundant reroll clones: dropped `safeStructuredClone(record.message)` at
   `:105`; the rows are passed to the dispatch by reference (it deep-clones each
   row via `toMessageSnapshot`). Because the dispatch's `ensureMessageId` pass
   would otherwise mutate a refrozen read-only row, ids are now minted inside the
   `withTrustedServerProjectionWrite` block. At `:147`, `reroll()` no longer
   deep-clones the transcript: a shallow copy locates the truncation point + the
   regenerate target (minted on a throwaway copy of the tail so it never mutates
   the projection row), then the live transcript is **truncated in place**
   (`applyRerollTruncate`) instead of installing a shallow-popped array — the
   surviving rows are the projection's own rows (guard-safe), and the dispatch
   payload is unchanged. (A shallow array of read-only proxy rows installed via
   the old `applyTranscript` would have poisoned later message writes.)
3. `runTrigger` early return: `triggers` is computed first (each definition mapped
   to a fresh object carrying `lowLevelAccess`, so the working character is not
   mutated in place; the display path keeps its historical in-place write) and
   `return null` runs before any clone when empty. The trigger-bearing path clones
   only the active chat; the whole-character deep clone is **lazy**
   (`materializeChar`), paid at most once per pass and only when a data effect
   installs the character (`v2SetCharacterDesc`, `v2SetReplaceGlobalNote`, the six
   `v2*Lorebook*` effects). A pure shallow character would have been re-installed
   by `setCurrentCharacter` with read-only proxy `chats`, poisoning later writes —
   the lazy deep clone keeps the install clean while skipping the clone entirely on
   the common (read-only / `setVar`) trigger path.

## Behavior / Invariants

- The stored reroll, the dispatched message payloads, and the trigger results are
  byte-identical.
- A zero-trigger character now pays no `char`/`chat` clone; non-`displayMode`
  trigger characters clone only the active chat (plus, lazily, one character clone
  only when a data effect installs it).
- `src/ts/process/request/request.ts` and `src/ts/process/scripts.ts` already pass
  `displayMode:true` and stay on the clone-free path.

## Done When (met)

- `recordGeneratedReroll` clones O(tail); the redundant `:105` clone is gone;
  `reroll()` no longer clones the whole transcript; `runTrigger` returns before
  cloning for zero-trigger characters and clones only the active chat otherwise
  (clone-cost harness proves each).
- Reroll navigation, dispatched messages, and trigger output are byte-identical.
- `pnpm test` is green (1002 / 4 skipped).

## Validation

- `pnpm exec vitest run rerollNavigation` (unit + rollback + guard, incl. the new
  Phase 3 clone-cost + guard-on regenerate tests)
- `pnpm exec vitest run triggers.projectionGuard triggers.cloneCost`
- `pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit`
- Type check: `tsconfig.client-lib.json` build then
  `server/fastify/tsconfig.json --noEmit`
