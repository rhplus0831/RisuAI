# Cheap Clone Wins

Status: planned. Phase 3. Independent of the Phase 0 kit; three behavior-preserving
edits.

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

## Target Implementation

1. Reroll tail clone: swap the slice/clone order so only the tail is
   deep-cloned:
   `rerolls.push(safeStructuredClone(message.slice(previousLength)))`.
   This is byte-identical and O(tail).
2. Redundant reroll clones: drop `safeStructuredClone(record.message)` at `:105`
   and pass `record.message` by reference. At `:147`, operate on a small tail copy
   instead of cloning the full transcript.
3. `runTrigger` early return: compute `triggers` first and `return null` before
   any `safeStructuredClone` when empty. For trigger-bearing paths, clone/map the
   trigger definitions before mutating their `lowLevelAccess` flag, and clone
   only the active chat once.

## Behavior / Invariants

- The stored reroll, the dispatched message payloads, and the trigger results are
  byte-identical.
- A zero-trigger character now pays no `char`/`chat` clone; non-`displayMode`
  trigger characters clone only the active chat once.
- `src/ts/process/request/request.ts` and `src/ts/process/scripts.ts` already pass
  `displayMode:true` and stay on the clone-free path.

## Done When

- `recordGeneratedReroll` clones O(tail); the redundant `:105` clone is gone;
  `reroll()` no longer clones the whole transcript; `runTrigger` returns before
  cloning for zero-trigger characters and clones only the active chat once
  otherwise (clone-cost harness on each).
- Reroll navigation, dispatched messages, and trigger output are byte-identical.
- `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/process/rerollNavigation.test.ts src/ts/process/rerollNavigation.rollback.test.ts src/ts/process/rerollNavigation.guard.test.ts`
- `pnpm test -- src/ts/process/__tests__/triggers.projectionGuard.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
