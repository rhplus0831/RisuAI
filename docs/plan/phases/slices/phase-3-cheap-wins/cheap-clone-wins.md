# Cheap Clone Wins

Status: landed (reroll `ed4e0af0`, `runTrigger` `f4855e24`; follow-up guard fix
`48d473dc`). Phase 3. Independent of the Phase 0 kit; three behavior-preserving
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
- `src/ts/process/sendChatCompletion.ts` - the `recordGeneratedReroll` caller.

## Implemented Shape

- `recordGeneratedReroll` clones only the reroll tail.
- `applyTailSlice` passes rows by reference, and regenerate uses
  `applyRerollTruncate` to truncate the live transcript instead of reinstalling a
  cloned transcript.
- `runTrigger` computes trigger definitions before cloning; zero-trigger passes
  return clone-free. Trigger-bearing paths clone only the active chat unless a
  data effect needs `materializeChar`, which performs one lazy whole-character
  clone to avoid reinstalling read-only proxy rows.

## Behavior / Invariants

- The stored reroll, the dispatched message payloads, and the trigger results are
  byte-identical.
- A zero-trigger character now pays no `char`/`chat` clone; non-`displayMode`
  trigger characters clone only the active chat (plus, lazily, one character clone
  only when a data effect installs it).
- `src/ts/process/request/request.ts` and `src/ts/process/scripts.ts` already pass
  `displayMode:true` and stay on the clone-free path.

## Done When (met)

- `recordGeneratedReroll` clones O(tail); the redundant reroll dispatch clone is gone;
  `reroll()` no longer clones the whole transcript; `runTrigger` returns before
  cloning for zero-trigger characters and clones only the active chat otherwise
  (clone-cost harness proves each).
- Reroll navigation, dispatched messages, and trigger output are byte-identical.
- Landing verification was green.

## Follow-Up Guard Fix

`48d473dc` fixed the pre-existing `runTrigger` `setVar`/`v2SetVar` direct-write
bug exposed by the Phase 3 clone-cost test: scriptstate sync now runs through
`syncActiveChatScriptstate` inside `withTrustedServerProjectionWrite`, and the
guard-on `v2SetVar` test proves the dispatched `/chats/:id/scriptstate` patch.

## Validation

- `pnpm exec vitest run rerollNavigation` (unit + rollback + guard, incl. the new
  Phase 3 clone-cost + guard-on regenerate tests)
- `pnpm exec vitest run triggers.projectionGuard triggers.cloneCost`
- `pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit`
- Type check: `tsconfig.client-lib.json` build then
  `server/fastify/tsconfig.json --noEmit`
