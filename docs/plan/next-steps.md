# Next Steps

Date: 2026-06-03

Read this when choosing the next batch. Pick one narrow snapshot path, one guard
fix, or one proof batch. Avoid broad cleanup passes.

## Start Point

- Start with the per-area findings in
  [`active-risk-analysis.md`](active-risk-analysis.md) and the per-finding detail
  + clone-site inventory in
  [`../frontend-performance-audit.md`](../frontend-performance-audit.md).
- Before editing runtime code, add a compact scope to the active slice: location,
  cloned data, hot-path trigger, target snapshot, rollback property, and proof
  command.
- Phases 3-7 are independent cleanups; the snapshot-dependent ones (Phase 2, and
  the character-row reuse in Phase 7) need the Phase 0 kit first. The guard
  (Phase 1) and the cheap wins (Phase 3) do not depend on the Phase 0 snapshot
  kit, but they do want the Phase 0 clone-cost harness so the win is provable.

## Current Best Targets

Nothing is implemented. Start with the foundation phases, then follow the audit
order.

1. Phase 0: snapshot kit + clone-cost harness. Add
   `currentChatScopedSnapshot`/`restoreChatScopedState`,
   `ChatScriptstateSnapshot`/`restoreChatScriptstate`,
   `CharacterRowSnapshot`/`restoreCharacterRow`,
   `currentGlobalLorebookStateSnapshot`/`restoreGlobalLorebookState`, and the
   reusable snapshot/rollback test helper. No call site narrowed yet.
2. Phase 1: projection write guard. Use copy-on-write / proxy unwrap-rewrap so a
   guarded write stops cloning the whole `Database` twice.
3. Phase 2: apply narrow snapshots one slice at a time. Start with the
   chat-metadata watcher and message-edit/send paths, then trigger, reroll,
   character, and lorebook paths.

## Not First

- Do not narrow any hot-path snapshot before the Phase 0 kit and the clone-cost
  harness exist; a narrow path without a regression test cannot prove it stopped
  cloning every character.
- Do not delete the full-collection `current*StateSnapshot`; create/delete/
  reorder/fork still need it. Only stop the hot path from reaching it.
- Do not change a narrowed rollback's restore set. It must restore exactly what
  the command mutates, or unrelated edits can be clobbered.
- Do not only gate a watcher snapshot behind a change check. The diff baseline is
  reassigned every fire, so the baseline itself must be per-row.
- Do not change the guard's immutability contract: the unwrap-rewrap must still
  hand readers a read-only projection and mint a new identity for reactivity.

## Selection Order

1. Phase 0 snapshot kit + clone-cost harness - not started.
2. Phase 1 projection write guard (copy-on-write / proxy unwrap-rewrap) - not
   started. Interim mitigation if the proxy swap is risky: drop the refreeze-time
   `$state.snapshot` (halves the cost).
3. Phase 2 snapshot-family narrowing - not started. Suggested slice order:
   chat-metadata watcher (always-on, per-render Critical) -> chat-scoped message/
   send paths -> scriptstate-scoped var writes -> reroll/swipe -> character-row ->
   global-lorebook.
4. Phase 3 cheap wins - not started. Independent; can land alongside Phase 1.
5. Phase 4 script-definition watcher - not started.
6. Phase 5 prompt-template keystroke - not started (the guard half closes with
   Phase 1).
7. Phase 6 lorebook watcher scope - not started.
8. Phase 7 opportunistic cleanups - not started.
9. Phase 8 verification budgets - standing; refresh
   [`latest-verification.md`](latest-verification.md) after each focused and full
   run, and add the clone-cost gate as each slice lands.

## Proof Commands

Use the smallest focused command first. Broaden only when the change touches
shared projection or guard behavior. Add the clone-cost regression test under the
matching suite.

- `pnpm test -- src/ts/compatibilityAdapters.test.ts` (the reference-fix
  snapshot/rollback proof; the new snapshot tests extend this pattern).
- `pnpm test -- src/ts/chatCommands.test.ts` (chat-scoped snapshot/rollback).
- `pnpm test -- src/ts/server/projectionGuard` / the guard suite (the
  copy-on-write proof: a guarded one-field write stays O(1), reactivity still
  fires).
- `pnpm test -- src/ts/process/rerollNavigation` (reroll tail-clone reorder and
  rollback scope).
- `pnpm test -- src/ts/process/triggers` (setVar/v2Set* scriptstate scope,
  `runTrigger` early-return).
- `pnpm test` (full client suite).
- `pnpm api:test` (server suite - run when a change can affect projection/event
  payloads).
- `pnpm client-thinning:audit` (the optimistic-write / projection invariants).
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
