# Frontend Performance Deep-Clone Narrowing Status

Date: 2026-06-04

This is the router for the frontend deep-clone / hot-path narrowing workstream.
Use it first, then open only the phase or slice needed for the next task.

Current status reflects runtime code through `c6dd103c` (`perf: scope the
lorebook watcher to the mounted panel (Phase 6)`). Phase 0 foundations, the
Phase 1 primary guard fix, all six Phase 2 slices, Phase 3 (cheap wins), the
`runTrigger` scriptstate guard follow-up, Phase 4 (script-definition watcher),
Phase 5 (prompt-template keystroke), and Phase 6 (lorebook watcher scope) have
landed; the next work is Phase 7 (independent).

## Current Snapshot

Analysis is complete. Phase 0-6 are implemented. Phase 6 scoped the lorebook
change-detection watcher to the mounting panel: `watchServerBackedLorebooks`
takes a `LorebookWatchScope` (`all | global | character | module`) and each
panel passes its own, so a lorebook keystroke no longer rebuilds a DB-wide lore
stringify map (every global lorebook + every character's globalLore + every chat
of every character + every module). The `all` default is the unchanged whole-DB
scan. Start new runtime work in Phase 7; keep Phase 8 as the standing
verification layer.

| Phase | State | Use For |
| --- | --- | --- |
| [0](phases/phase-0-baseline-foundations.md) | Implemented | Snapshot kit and clone-cost harness. |
| [1](phases/phase-1-projection-write-guard.md) | Implemented | Copy-on-write projection guard; batching slice deferred. |
| [2](phases/phase-2-snapshot-family-narrowing.md) | Implemented | Six snapshot-family hot-path slices. |
| [3](phases/phase-3-cheap-wins.md) | Implemented | Reroll transcript wins, `runTrigger` lazy clone, `48d473dc` guard follow-up. |
| [4](phases/phase-4-script-definition-watcher.md) | Implemented | Script-definition watcher scoped per-row rollback (`2ec1ea40`). |
| [5](phases/phase-5-prompt-template-keystroke.md) | Implemented | Prompt-template in-place item write + revision-gated reconcile (`c5fc5967`) and `PromptDataItem` single-clone update (`64804305`); debounce coalescing deferred. |
| [6](phases/phase-6-lorebook-watcher-scope.md) | Implemented | Lorebook watcher scoped to the mounted panel via `LorebookWatchScope` (`c6dd103c`). |
| [7](phases/phase-7-opportunistic-cleanups.md) | Planned | CBS, observer, image/emotion, regex, parser, log, and scan cleanups. |
| [8](phases/phase-8-verification-budgets.md) | Planned | Clone-cost gate completeness. |

## Open Risk Router

[`active-risk-analysis.md`](active-risk-analysis.md) has the full per-area
detail. The remaining planned runtime work is Phase 7 low-priority cleanups
(plus the deferred Phase 5 debounce coalescing). Broad snapshots still
intentionally exist for real restructures plus deferred lower-frequency callers
such as image/emotion edits and LoreBook sidebar/MCP paths.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). Latest maintained run:
`pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit`, and both
project-reference TypeScript checks passed. `pnpm check` remains at the
unchanged 10-error svelte-check baseline outside this workstream.

## Start Here

- Use [`next-steps.md`](next-steps.md) to choose the next task.
- Use [`active-risk-analysis.md`](active-risk-analysis.md) for the per-area
  actual-vs-target clone ranges.
- Use [`plan.md`](plan.md) for prerequisites, invariants, and phase order.
- Use [`phases/README.md`](phases/README.md) for all phase docs.

## Maintenance Rules

- Keep `status.md` and `next-steps.md` as the navigation entry points.
- Keep phase summaries in `phases/`; keep concrete task scope in
  `phases/slices/[phase]/`.
- New hot-path snapshot narrowing must use the Phase 0 kit and add a clone-cost
  harness regression; a narrow path without a regression test cannot prove it
  stopped cloning every character.
- Do not delete the full-collection snapshot; reserve it for genuine restructures
  (create/delete/reorder/fork) and only stop the hot path from reaching it.
- Every narrowing slice lands with a clone-cost regression test and a
  rollback-correctness test; do not mark a phase implemented without both.
- Update this status and the phase router after a phase changes state.
