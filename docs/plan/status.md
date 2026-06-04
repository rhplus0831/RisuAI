# Frontend Performance Deep-Clone Narrowing Status

Date: 2026-06-04

This is the router for the frontend deep-clone / hot-path narrowing workstream.
Use it first, then open only the phase or slice needed for the next task.

Current status reflects runtime code through `48d473dc` (`fix: route runTrigger
setVar scriptstate writes through the projection guard`) plus the docs audit
commit `5aa2fa63`. Phase 0 foundations, the Phase 1 primary guard fix, all six
Phase 2 slices, Phase 3 (cheap wins), and the `runTrigger` scriptstate guard
follow-up have landed; the next work is Phases 4-7 (independent).

## Current Snapshot

Analysis is complete. Phase 0-3 are implemented, and `48d473dc` fixed the
pre-existing `runTrigger` `setVar`/`v2SetVar` direct-write bug surfaced by the
Phase 3 clone-cost proof. Start new runtime work in Phase 4-7; keep Phase 8 as
the standing verification layer.

| Phase | State | Use For |
| --- | --- | --- |
| [0](phases/phase-0-baseline-foundations.md) | Implemented | Snapshot kit and clone-cost harness. |
| [1](phases/phase-1-projection-write-guard.md) | Implemented | Copy-on-write projection guard; batching slice deferred. |
| [2](phases/phase-2-snapshot-family-narrowing.md) | Implemented | Six snapshot-family hot-path slices. |
| [3](phases/phase-3-cheap-wins.md) | Implemented | Reroll transcript wins, `runTrigger` lazy clone, `48d473dc` guard follow-up. |
| [4](phases/phase-4-script-definition-watcher.md) | Planned | Script-definition watcher scoped rollback. |
| [5](phases/phase-5-prompt-template-keystroke.md) | Planned | Prompt-template debounce, single-item mutation, cheaper change detection. |
| [6](phases/phase-6-lorebook-watcher-scope.md) | Planned | Lorebook watcher scoped to the mounted panel. |
| [7](phases/phase-7-opportunistic-cleanups.md) | Planned | CBS, observer, image/emotion, regex, parser, log, and scan cleanups. |
| [8](phases/phase-8-verification-budgets.md) | Planned | Clone-cost gate completeness. |

## Open Risk Router

[`active-risk-analysis.md`](active-risk-analysis.md) has the full per-area
detail. The remaining planned runtime work is Phase 4 script definitions, Phase 5
prompt-template keystrokes, Phase 6 lorebook watcher scope, and Phase 7
low-priority cleanups. Broad snapshots still intentionally exist for real
restructures plus deferred lower-frequency callers such as image/emotion edits
and LoreBook sidebar/MCP paths.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). Latest maintained run:
`pnpm test` green (1003 passed / 4 skipped), `pnpm api:test` green (1632 passed /
1 skipped), `pnpm client-thinning:audit` green, and both TypeScript checks green.

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
