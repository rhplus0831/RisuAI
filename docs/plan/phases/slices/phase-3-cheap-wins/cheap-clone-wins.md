# Cheap Clone Wins

Status: planned. Phase 3. Independent of the Phase 0 kit; three behavior-preserving
edits.

## Scope

Land the audit's high-confidence one-liners: clone only the reroll tail, drop the
redundant reroll dispatch clones, and hoist the `runTrigger` early-return above its
char/chat clones. Each is byte-identical and needs only a focused proof.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the High `recordGeneratedReroll`, the High reroll redundant-clone, and the
  Medium `runTrigger` clone-before-early-return findings.
- `src/ts/process/rerollNavigation.svelte.ts:60` - `recordGeneratedReroll`.
- `src/ts/process/rerollNavigation.svelte.ts:105/147` - the redundant
  `safeStructuredClone(record.message)` and the full-transcript clone in
  `reroll()`.
- `src/ts/process/triggers.ts:1198` - `runTrigger` char/chat clones before the
  `triggers.length === 0` return.
- `src/ts/process/sendChatCompletion.ts:25` - the `recordGeneratedReroll` caller.

## Target Implementation

1. **Reroll tail clone** — swap the slice/clone order so only the tail is
   deep-cloned:
   `rerolls.push(safeStructuredClone(message.slice(previousLength)))`.
   `message.slice(previousLength)` builds a short array sharing the tail element
   references (cheap), then `safeStructuredClone` deep-clones just those 1-2
   messages. Byte-identical, O(tail) instead of O(full transcript).
2. **Redundant reroll clones** — drop `safeStructuredClone(record.message)` at
   `:105` and pass `record.message` by reference (`dispatchReplaceMessages` deep-
   clones each message via `messages.map(toMessageSnapshot)` internally); at
   `:147` operate on a small tail copy (only the trailing assistant group is
   popped) rather than cloning the entire transcript. The candidate-tail clones at
   `:139/187/244` are bounded and untouched.
3. **`runTrigger` early return** — compute `triggers` first and `return null`
   before any `safeStructuredClone` when empty; then clone only the active chat
   once and use a shallow `{ ...char, triggerscript: char.triggerscript.map(v =>
   ({ ...v, lowLevelAccess })) }` instead of `safeStructuredClone(char)`; for
   recursive `manual` calls thread the already-cloned char/chat through rather
   than re-deep-cloning per level.

## Behavior / Invariants

- The stored reroll, the dispatched message payloads, and the trigger results are
  byte-identical.
- A zero-trigger character now pays no `char`/`chat` clone; non-`displayMode`
  trigger characters clone only the active chat once.
- `request.ts:278` and `scripts.ts:137` already pass `displayMode:true` and stay
  on the clone-free path — unchanged.

## Done When

- `recordGeneratedReroll` clones O(tail); the redundant `:105` clone is gone;
  `reroll()` no longer clones the whole transcript; `runTrigger` returns before
  cloning for zero-trigger characters and clones only the active chat once
  otherwise (clone-cost harness on each).
- Reroll navigation, dispatched messages, and trigger output are byte-identical.
- `pnpm test` is green.

## Validation

- `pnpm test -- src/ts/process/rerollNavigation` and `pnpm test -- src/ts/process/triggers`
- `pnpm test`
- `pnpm client-thinning:audit`
