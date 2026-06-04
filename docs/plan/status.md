# Frontend Performance Deep-Clone Narrowing Status

Date: 2026-06-04

This is the router for the frontend deep-clone / hot-path narrowing workstream.
Use it first, then open only the phase or slice needed for the next task.

Current status reflects runtime code through `deb4196c` (Phase 8 clone-cost gate
completeness). Phase 0 foundations, the Phase 1 primary guard fix, all six Phase 2
slices, Phase 3 (cheap wins), the `runTrigger` scriptstate guard follow-up, Phase
4 (script-definition watcher, including the debounced rollback baseline fix),
Phase 5 (prompt-template keystroke), Phase 6 (lorebook watcher scope), Phase 7
(all eight opportunistic cleanups), and Phase 8 (the self-checking clone-cost
gate map) have landed. **All phases (0-8) are now implemented.** The Phase 4
debounce rollback correctness gap the read-only completion audit found is closed;
see [`phase-1-5-completion-audit.md`](phase-1-5-completion-audit.md).

## Current Snapshot

Analysis is complete and **Phases 0-8 are all implemented**. Phase 7 landed the
eight opportunistic low-severity cleanups (CBS history and Claude observer
shallow-spreads, the image/emotion scoped row rollback, per-token regex
memoization, the `{{#each}}` prefix-drop re-injection, ChatBody render-log
removal, the SideChatList single-pass `groupChatsByFolderId`, and the optional
PersonaSettings snapshot dedup); each is output/behavior preserving. Phase 8
landed `cloneCostGateCompleteness.test.ts`, the standing self-checking gate map:
it scans `src` for every clone-cost gate test and fails on drift (an unregistered
gate, a renamed/deleted gate, or a Critical/High path missing its rollback gate).
No open runtime narrowing remains; the deferred Phase 5 debounce-coalescing is the
only optional follow-up, and broad snapshots stay intentional for restructures and
the recorded lower-frequency callers.

| Phase | State | Use For |
| --- | --- | --- |
| [0](phases/phase-0-baseline-foundations.md) | Implemented | Snapshot kit and clone-cost harness. |
| [1](phases/phase-1-projection-write-guard.md) | Implemented | Copy-on-write projection guard; batching slice deferred. |
| [2](phases/phase-2-snapshot-family-narrowing.md) | Implemented | Six snapshot-family hot-path slices. |
| [3](phases/phase-3-cheap-wins.md) | Implemented | Reroll transcript wins, `runTrigger` lazy clone, `48d473dc` guard follow-up. |
| [4](phases/phase-4-script-definition-watcher.md) | Implemented | Clone-cost watcher slice (`2ec1ea40`) plus the debounced rollback baseline fix (`c1349966`): coalesced same-key edits roll back to the pre-first-edit baseline. |
| [5](phases/phase-5-prompt-template-keystroke.md) | Implemented | Prompt-template in-place item write + revision-gated reconcile (`c5fc5967`) and `PromptDataItem` single-clone update (`64804305`); debounce coalescing deferred. |
| [6](phases/phase-6-lorebook-watcher-scope.md) | Implemented | Lorebook watcher scoped to the mounted panel via `LorebookWatchScope` (`c6dd103c`). |
| [7](phases/phase-7-opportunistic-cleanups.md) | Implemented | CBS/observer shallow-spread, image/emotion scoped rollback, regex memo, `{{#each}}` prefix-drop, render-log removal, SideChatList single-pass, PersonaSettings dedup. |
| [8](phases/phase-8-verification-budgets.md) | Implemented | Self-checking clone-cost gate map (`cloneCostGateCompleteness.test.ts`); fails on drift. |

## Open Risk Router

[`active-risk-analysis.md`](active-risk-analysis.md) has the full per-area
detail. No open runtime narrowing remains; the only optional follow-up is the
deferred Phase 5 debounce coalescing. Broad snapshots still intentionally exist
for real restructures plus the recorded lower-frequency callers (LoreBook
sidebar/MCP paths, the bounded PersonaSettings config snapshot, and the
local-assembler clones dead on the default server route) — all enumerated in
`cloneCostGateCompleteness.test.ts`'s `INTENTIONALLY_BROAD` list.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). Latest maintained run
(Phases 7-8): `pnpm test` (1054 passed / 4 skipped), `pnpm api:test` (1632 passed
/ 1 skipped), `pnpm client-thinning:audit`, and both project-reference TypeScript
checks passed. `pnpm check` remains at the unchanged 10-error svelte-check
baseline outside this workstream.

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
