# Frontend Performance Deep-Clone Narrowing Status

Date: 2026-06-04

This is the router for the frontend deep-clone / hot-path narrowing workstream.
Use it first, then open only the phase or slice needed for the next task.

Current status reflects runtime code through `f4855e24` (`perf: hoist runTrigger
early return + lazily clone the trigger character (Phase 3)`) and `ed4e0af0`
(`perf: narrow reroll post-send + swipe/regenerate transcript clones (Phase 3)`).
Phase 0 foundations, the Phase 1 primary guard fix, all six Phase 2 slices, and
Phase 3 (cheap wins) have landed; the next work is Phases 4-7 (independent).

## Current Snapshot

Analysis is complete. Phase 0 foundations are implemented, Phase 1 removed the
guard clone amplifier, Phase 2 is complete (all 6 slices landed), and Phase 3
(cheap wins) is complete. The reference fix `c9e728b1` already narrowed character
select; Phase 2 applied that pattern to message-edit, send/continue, trigger,
reroll/swipe, chat-metadata watcher, character-row, and global-lorebook paths;
Phase 3 narrowed the reroll post-send/regenerate transcript clones and the
`runTrigger` whole-character clone.

Phase 2 slices landed: chat-metadata watcher (`e5e183da`), chat-scoped message
paths (`2070df02`), scriptstate-scoped var writes (`727a28c0`), reroll/swipe
rollback (`f1558e39`), character-row snapshot paths (`458458a7`), global-lorebook
snapshot paths (`9547ba3e`).

Phase 3 landed: reroll post-send tail clone + redundant dispatch-clone removal +
in-place regenerate truncation (`ed4e0af0`), `runTrigger` early-return hoist +
lazy character materialization (`f4855e24`).

- Phase 0, implemented: narrow snapshot kit + clone-cost harness. No
  snapshot-family production call sites were rewired (that starts in Phase 2).
- Phase 1, implemented (primary slice): copy-on-write projection guard. Removes
  the two whole-`Database` clones from every guarded write (~100 sites). The
  optional secondary streaming/completion batching slice is deferred — now that
  each guard transition is O(1), batching per-chunk transitions has little value.
- Phase 2, implemented (6 of 6 slices): routed Critical/High
  `current*StateSnapshot` call sites through the narrow kit. Landed: chat-metadata
  watcher, chat-scoped message paths, scriptstate-scoped var writes, reroll/swipe
  rollback, character-row paths, global-lorebook paths.
- Phase 3, implemented: reroll post-send tail clone + redundant dispatch-clone
  removal + in-place regenerate truncation; `runTrigger` early-return hoist + lazy
  whole-character clone (the install paths and the reroll regenerate use guard-safe
  shapes rather than the naive shallow copy the audit sketched).
- Phase 4, planned: script-definition watcher rollback scoped at dispatch.
- Phase 5, planned: prompt-template debounce, single-item mutation, and cheaper
  change detection.
- Phase 6, planned: lorebook watcher scoped to the mounted panel.
- Phase 7, planned: low-priority CBS, observer, image/emotion, regex,
  `{{#each}}`, log, and SideChatList cleanups.
- Phase 8, planned: clone-cost gates and gate completeness.

## Phase Router

- [Phase 0](phases/phase-0-baseline-foundations.md): snapshot kit and harness
  (implemented).
- [Phase 1](phases/phase-1-projection-write-guard.md): projection guard
  copy-on-write / proxy unwrap-rewrap (primary slice implemented; batching
  slice deferred).
- [Phase 2](phases/phase-2-snapshot-family-narrowing.md): chat, message, send,
  trigger, reroll, character, and lorebook snapshot call sites (implemented, 6 of
  6 slices landed).
- [Phase 3](phases/phase-3-cheap-wins.md): reroll clone reorder/removal and
  `runTrigger` clone-before-early-return (implemented).
- [Phase 4](phases/phase-4-script-definition-watcher.md): script-definition
  watcher full characters+modules clone.
- [Phase 5](phases/phase-5-prompt-template-keystroke.md): prompt-template
  per-keystroke clone and stringify costs.
- [Phase 6](phases/phase-6-lorebook-watcher-scope.md): lorebook watcher
  DB-wide `localLore`/`globalLore` stringify.
- [Phase 7](phases/phase-7-opportunistic-cleanups.md): low-priority clone and
  scan cleanups.
- [Phase 8](phases/phase-8-verification-budgets.md): clone-cost gate
  completeness.

## Active Risk Summary

[`active-risk-analysis.md`](active-risk-analysis.md) has the per-area detail.
Headlines, in priority order (audit severity in parentheses):

- Projection write guard (Critical, amplifier): closed by Phase 1. The former two
  whole-`Database` clones per guarded write (~255 ms on a 61 MB DB) are gone.
- `currentChatStateSnapshot()` family (Critical/High): the whole-characters clone
  on every send, per-message edit/delete/bookmark, swipe/reroll, scriptstate
  write, and a per-render chat-metadata watcher. -> Phase 0 (kit) + Phase 2
  (apply) — DONE.
- `currentCharacterStateSnapshot()` (High): whole-characters clone on character
  field edits and lorebook-mutating triggers. -> Phase 0 (kit) + Phase 2 — DONE
  for `setCurrentCharacter`/`setCharacterByIndex` + the `v2Set*` trigger callers;
  image/emotion handlers remain (Phase 7).
- `currentLorebookStateSnapshot()` (High): whole characters+modules clone on
  global-lorebook select and lorebook triggers. -> Phase 2 — DONE for select/
  create/delete + the 6 trigger sites; the LoreBook sidebar/MCP callers remain.
- Script-definition watcher (High): full characters+modules clone per fire while
  a config/module panel is open. -> Phase 4.
- Reroll/transcript clones (High): full-transcript clone to keep 1-2 tail
  messages; redundant dispatch clones. -> Phase 2 (rollback) + Phase 3 — DONE
  (tail-only post-send clone, by-reference dispatch, in-place regenerate truncate).
- `runTrigger` whole-character clone (Medium): cloned the full character + chat
  before the no-trigger early return. -> Phase 3 — DONE (early-return hoist; lazy
  whole-character clone paid only on the install effects).
- Prompt-template keystroke (High): guard half closed by Phase 1; the remaining
  work is the whole-template clone + double stringify per keystroke. -> Phase 5.
- Lorebook watcher (Medium): DB-wide lore stringify per fire. -> Phase 6.
- Opportunistic low items: CBS history, Claude observer, image/emotion, regex
  memo, `{{#each}}`, console.log, SideChatList scan. -> Phase 7.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). Phases 0, 1, 2, and 3 have
landed. The guard amplifier is gone: a guarded write is now O(1) (zero
whole-`Database` clones) instead of ~255 ms on a 61 MB DB. Phase 2 narrowed the
Critical/High hot-path rollback snapshots (send, message edit, swipe/reroll,
scriptstate, chat-metadata watcher, character-field edits, global-lorebook
select, and the 6 lorebook triggers) to scalar/single-row/single-chat clones.
Phase 3 narrowed the reroll post-send/regenerate transcript clones (tail-only +
in-place truncate) and the `runTrigger` whole-character clone (lazy, paid only on
the install effects). The deferred image/emotion and sidebar/MCP lorebook callers
still scale with history.

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
