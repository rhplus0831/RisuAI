# Frontend Performance Deep-Clone Narrowing Status

Date: 2026-06-03

This is the status router for the frontend deep-clone / hot-path narrowing
workstream. Use it first, then open only the phase or slice needed for the next
task.

Current status reflects the seed audit
[`../frontend-performance-audit.md`](../frontend-performance-audit.md), audited
2026-06-03. No remediation has landed yet; the audit analysis is complete and
this plan is the split into phases and slices.

## Current Snapshot

Analysis is complete. Nothing is implemented. The reference fix `c9e728b1`
already narrowed the character-select path; this plan narrows the surviving twins
on the message, send, streaming, trigger, reroll, watcher, and editor paths and
removes the projection-guard amplifier beneath them.

- Phase 0 (baseline foundations) — **planned**. Add the scalar/single-row/
  single-chat snapshot kit (mirroring `CharacterSelectionSnapshot`/
  `restoreCharacterSelection`) and the reusable clone-cost regression harness. No
  call site is narrowed in this phase; it makes the later narrowing provable.
- Phase 1 (projection write guard) — **planned**. The single highest-leverage
  fix: stop `withTrustedServerProjectionWrite` deep-cloning the whole `Database`
  twice per guarded write. Resolves the streaming, non-stream, SSE-apply,
  chat-open-hydration, and prompt-template guard-halves at once (~100 call sites).
- Phase 2 (snapshot-family hot-path narrowing) — **planned**. Route the
  Critical/High `current*StateSnapshot` call sites (chat-metadata watcher,
  message edits/send, scriptstate var writes, reroll/swipe, character-row edits,
  global-lorebook select/trigger) through the Phase 0 narrow kit.
- Phase 3 (cheap high-confidence wins) — **planned**. The one-line
  `recordGeneratedReroll` slice/clone reorder, the redundant transcript clones,
  and the `runTrigger` early-return-before-clone.
- Phase 4 (script-definition watcher) — **planned**. Stop the watcher
  deep-reading characters/modules per fire; build the rollback lazily and scoped
  at dispatch.
- Phase 5 (prompt-template editor keystroke costs) — **planned**. Debounce the
  optimistic projection write, mutate only the edited item, replace the
  double-`JSON.stringify` change detection with a server-revision discriminator.
- Phase 6 (lorebook watcher scope) — **planned**. Scope the lorebook collector to
  the mounting panel's collection instead of all chats of all characters.
- Phase 7 (opportunistic cleanups) — **planned**. Shallow-spread the CBS history
  clones, the Claude observer body, and the character image/emotion snapshots;
  memoize compiled regexes; the `{{#each}}` re-injection rewrite; remove the
  per-render `console.log`; the `SideChatList` O(folders×chats) scan.
- Phase 8 (verification budgets) — **planned**. Keep a clone-cost regression gate
  on every narrowed hot path and make the harness self-checking.

## Phase Router

| Phase | Status | Open when working on... |
| --- | --- | --- |
| [Phase 0](phases/phase-0-baseline-foundations.md) | Planned | The snapshot kit (scalar/single-row/single-chat snapshot+restore) and the clone-cost regression harness. |
| [Phase 1](phases/phase-1-projection-write-guard.md) | Planned | The projection write guard copy-on-write / proxy unwrap-rewrap (the amplifier). |
| [Phase 2](phases/phase-2-snapshot-family-narrowing.md) | Planned | The Critical/High `current*StateSnapshot` call sites across the chat/message/send/trigger/reroll/character/lorebook paths. |
| [Phase 3](phases/phase-3-cheap-wins.md) | Planned | The reroll slice/clone reorder, the redundant transcript clones, and the `runTrigger` clone-before-early-return. |
| [Phase 4](phases/phase-4-script-definition-watcher.md) | Planned | The script-definition watcher's full characters+modules clone per fire. |
| [Phase 5](phases/phase-5-prompt-template-keystroke.md) | Planned | The prompt-template editor's per-keystroke whole-DB clone and double-stringify change detection. |
| [Phase 6](phases/phase-6-lorebook-watcher-scope.md) | Planned | The lorebook watcher's DB-wide `localLore`/`globalLore` stringify per fire. |
| [Phase 7](phases/phase-7-opportunistic-cleanups.md) | Planned | The low-priority CBS/observer/image-emotion/regex/`{{#each}}`/console/SideChatList cleanups. |
| [Phase 8](phases/phase-8-verification-budgets.md) | Planned | The clone-cost regression-gate completeness across all narrowed hot paths. |

## Active Risk Summary

[`active-risk-analysis.md`](active-risk-analysis.md) has the per-area detail.
Headlines, in priority order (audit severity in parentheses):

- Projection write guard (Critical, amplifier): two whole-`Database` deep clones
  per guarded write, ~255 ms on a 61 MB DB, at per-token frequency during
  streaming. Highest leverage — one fix benefits ~100 call sites. → Phase 1.
- `currentChatStateSnapshot()` family (Critical/High): the whole-characters clone
  on every send, per-message edit/delete/bookmark, swipe/reroll, scriptstate
  write, and a per-render chat-metadata watcher. → Phase 0 (kit) + Phase 2
  (apply).
- `currentCharacterStateSnapshot()` (High): whole-characters clone on character
  field edits and lorebook-mutating triggers. → Phase 0 (kit) + Phase 2.
- `currentLorebookStateSnapshot()` (High): whole characters+modules clone on
  global-lorebook select and lorebook triggers. → Phase 2.
- Script-definition watcher (High): full characters+modules clone per fire while
  a config/module panel is open. → Phase 4.
- Reroll/transcript clones (High): full-transcript clone to keep 1-2 tail
  messages; redundant dispatch clones. → Phase 3 (cheap) + Phase 2 (rollback).
- Prompt-template keystroke (High): whole-DB clone (guard) + whole-template clone
  + double stringify per keystroke. → Phase 1 (guard) + Phase 5.
- Lorebook watcher (Medium): DB-wide lore stringify per fire. → Phase 6.
- Opportunistic low items: CBS history, Claude observer, image/emotion, regex
  memo, `{{#each}}`, console.log, SideChatList scan. → Phase 7.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). No code change has landed;
the recorded baseline is the audit's empirical measurement (61 MB DB: one guarded
write ≈ 255 ms; whole-characters snapshots scale with total hydrated history).
Replace the latest-run section once Phase 0/1 lands.

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
- Do not narrow a hot-path snapshot until the Phase 0 kit and the clone-cost
  harness exist; a narrow path without a regression test cannot prove it stopped
  cloning every character.
- Do not delete the full-collection snapshot; reserve it for genuine restructures
  (create/delete/reorder/fork) and only stop the hot path from reaching it.
- Every narrowing slice lands with a clone-cost regression test and a
  rollback-correctness test; do not mark a phase implemented without both.
- Update this status and the phase router after a phase changes state.
