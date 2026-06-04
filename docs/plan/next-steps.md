# Next Steps

Date: 2026-06-04

Read this when choosing the next batch. Pick one focused Phase 5-7 cleanup or one
Phase 8 proof batch. Avoid broad cleanup passes.

## Start Point

- Start with the per-area findings in
  [`active-risk-analysis.md`](active-risk-analysis.md) and the per-finding detail
  and clone-site inventory in
  [`../frontend-performance-audit.md`](../frontend-performance-audit.md).
- Before editing runtime code, add a compact scope to the active slice: location,
  cloned data, hot-path trigger, target snapshot, rollback property, and proof
  command.
- Phases 5-7 are independent cleanups. The remaining snapshot-dependent item is
  the Phase 7 image/emotion narrowing, which should reuse the Phase 0 character
  row kit; cheap wins and watcher/editor changes should still use the clone-cost
  harness when proving a win.

## Current Best Targets

Phases 0, 1, 2, 3, and 4 have landed. The next work is Phases 5-7 (independent,
any order).

- DONE: Phase 0 snapshot kit + clone-cost harness; Phase 1 primary guard
  copy-on-write fix; Phase 2 all six snapshot-family slices
  (`e5e183da` -> `9547ba3e`); Phase 3 cheap wins (reroll `ed4e0af0`, `runTrigger`
  `f4855e24`); Phase 4 script-definition watcher scoped rollback (`2ec1ea40`).
  Broad snapshots still exist for restructures plus lower-frequency or deferred
  callers.
- NEXT: any focused Phase 5-7 cleanup — Phase 5 (prompt-template keystroke),
  Phase 6 (lorebook watcher scope), or a Phase 7 opportunistic item.
- FIXED (`48d473dc`): `setVar`/`v2SetVar` previously wrote scriptstate directly to
  the read-only projection, so a client `manual`/slash `setVar` trigger threw under
  the Fastify guard. Now routed through `syncActiveChatScriptstate`
  (`withTrustedServerProjectionWrite` + `getCurrentChat()` re-read); proven by the
  guard-on v2SetVar test in `triggers.projectionGuard.test.ts`.
- STANDING: Phase 8 verification budgets; refresh
  [`latest-verification.md`](latest-verification.md) after focused/full runs.

## Not First

- Use the Phase 0 kit and clone-cost harness for every new hot-path snapshot
  narrowing; a narrow path without a regression test cannot prove it stopped
  cloning every character.
- Do not delete the full-collection `current*StateSnapshot`; create/delete/
  reorder/fork still need it. Only stop the hot path from reaching it.
- Do not change a narrowed rollback's restore set. It must restore exactly what
  the command mutates, or unrelated edits can be clobbered.
- Do not only gate a watcher snapshot behind a change check. The diff baseline is
  reassigned every fire, so the baseline itself must be per-row.
- Do not change the guard's immutability contract: the unwrap-rewrap must still
  hand readers a read-only projection and mint a new identity for reactivity.

## Proof Commands

Use the smallest focused command first. Broaden only when the change touches
shared projection or guard behavior. Add the clone-cost regression test under the
matching suite.

- `pnpm test -- src/ts/compatibilityAdapters.test.ts` (the reference-fix
  snapshot/rollback proof; the new snapshot tests extend this pattern).
- `pnpm test -- src/ts/chatCommands.test.ts` (chat-scoped snapshot/rollback).
- `pnpm test -- src/ts/server/projectionWriteGuard.test.ts src/ts/server/chatMessageHydration.reactivity.svelte.test.ts`
  (the copy-on-write proof: a guarded one-field write stays O(1), reactivity
  still fires).
- `pnpm test -- src/ts/process/rerollNavigation.test.ts src/ts/process/rerollNavigation.rollback.test.ts src/ts/process/rerollNavigation.guard.test.ts`
  (reroll tail-clone reorder and rollback scope).
- `pnpm test -- src/ts/process/__tests__/triggers.projectionGuard.test.ts src/ts/parser/tests/chatVar.svelte.test.ts`
  (scriptstate scope and `runTrigger` early-return).
- `pnpm test -- src/ts/server/scriptDefinitionBridge.svelte.test.ts` (Phase 4:
  the watcher fire stays O(scripts) with a hydrated history, and a failed
  replacement rolls back only the changed row).
- `pnpm test` (full client suite).
- `pnpm api:test` (server suite - run when a change can affect projection/event
  payloads).
- `pnpm client-thinning:audit` (the optimistic-write / projection invariants).
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
