# Frontend Performance Deep-Clone Narrowing Plan

Date: 2026-06-04

This directory tracks frontend hot paths that clone too much state. The common
bug is simple: a path mutates a scalar, one row, or one chat, but clones the whole
`DBState.db.characters` array, the whole `Database`, or a full transcript for
rollback or change detection.

Use `status.md` for the current state. Use
[`../frontend-performance-audit.md`](../frontend-performance-audit.md) as the
seed inventory. The code remains the source of truth.

## Read Order

1. [`status.md`](status.md) - current snapshot and navigation router.
2. [`next-steps.md`](next-steps.md) - next task batch and proof commands.
3. [`active-risk-analysis.md`](active-risk-analysis.md) - per-area current vs
   target clone range.
4. [`plan.md`](plan.md) - goal, sources, invariants, prerequisites, and phase
   order.
5. [`phases/README.md`](phases/README.md) - phase index.
6. [`phases/slices/`](phases/slices/) - concrete task slices under each phase.

## Canonical Detail

- Current status and phase routing live in [`status.md`](status.md).
- The per-area risk analysis (actual vs desired clone range) lives in
  [`active-risk-analysis.md`](active-risk-analysis.md).
- The latest maintained verification result lives in
  [`latest-verification.md`](latest-verification.md).
- Next task selection, non-goals, and proof commands live in
  [`next-steps.md`](next-steps.md).
- Phase-level scope and exit criteria live in [`phases/`](phases/).
- Slice definitions live in `phases/slices/[phase]/[slice-name].md`.
- The seed audit is
  [`../frontend-performance-audit.md`](../frontend-performance-audit.md). It has
  finding locations, costs, frequency, fixes, clone-site inventory, and rejected
  candidates.

## Source Anchors

- [`../frontend-performance-audit.md`](../frontend-performance-audit.md) - the
  audit that seeded this plan (4 critical, 13 high, 6 medium, 6 low, plus the
  full clone-site inventory).
- `src/ts/server/projectionWriteGuard.svelte.ts` -
  `withTrustedServerProjectionWrite`, `createReadOnlyServerProjection`, and
  `resolveServerProjectionSource`; the Phase 1 copy-on-write guard that removed
  the former full-`Database` clone amplifier behind ~100 guarded writes.
- `src/ts/chatCommands.ts` - legacy full `currentChatStateSnapshot` /
  `restoreChatState` for true restructures and deferred callers; Phase 2 hot
  paths use `currentChatScopedSnapshot` / `restoreChatScopedState` and
  `currentChatScriptstateSnapshot`.
- `src/ts/characterCommands.ts` - the reference fix
  `currentCharacterSelectionSnapshot` / `restoreCharacterSelection` plus the
  heavy `currentCharacterStateSnapshot` / `restoreCharacterState`.
- `src/ts/server/lorebookBridge.svelte.ts`,
  `src/ts/server/scriptDefinitionBridge.svelte.ts`,
  `src/ts/server/chatBridge.svelte.ts` - the snapshot families and reactive
  watchers.
- `src/ts/process/postGeneration/streamResponse.ts`,
  `src/ts/process/postGeneration/nonStreamResponse.ts`,
  `src/ts/process/rerollNavigation.svelte.ts` - the streaming, completion, and
  reroll/swipe write paths.
- `src/lib/Setting/Pages/PromptSettings.svelte`,
  `src/ts/server/promptTemplateBridge.svelte.ts`,
  `src/lib/UI/PromptDataItem.svelte` - Phase 5 prompt-template keystroke
  narrowing, revision-gated reconcile, and single-clone item updates.
- [`../structure/server-projection-and-bridges.md`](../structure/server-projection-and-bridges.md),
  [`../structure/frontend.md`](../structure/frontend.md), and
  [`../structure/data-and-events.md`](../structure/data-and-events.md) -
  projection guard, bridge watchers, hydration, revision, and active-writer
  references.
- [`../../STRUCTURE.md`](../../STRUCTURE.md) - present-tense code navigation.

## Reference Fix

`c9e728b1` ("perf: stop deep-cloning the whole characters array on sidebar
character clicks") is the template:

- The old `changeChar` path used `currentCharacterStateSnapshot()`, cloning all
  characters and every hydrated `message[]` on each sidebar click.
- Selecting a character only mutates three scalars
  (`lastInteraction`, `currentChar`, `selectedCharID`), so it now captures a
  scalar-only `CharacterSelectionSnapshot`.
- The full-array snapshot remains only for create/delete/reorder.
- `src/ts/compatibilityAdapters.test.ts` proves the snapshot omits `characters`
  and failed selects do not clobber unrelated character fields.

Every slice follows that shape: use a scalar, single-row, or single-chat
snapshot on the hot path; keep the full clone for real restructures; add a
regression test proving the hot path does not clone the whole collection.
