# Frontend Performance Deep-Clone Narrowing Plan

Date: 2026-06-03

This directory tracks the frontend deep-clone / hot-path narrowing work. A
deep-clone mismatch is a hot path (sidebar click, chat open, send loop,
per-token streaming, per-keystroke editing, per-render reactive effect, trigger
or CBS evaluation) that captures an optimistic-rollback baseline, a
change-detection snapshot, or a working copy by deep-cloning far more state than
it logically touches — typically the whole `DBState.db.characters` array (with
every hydrated chat's `message[]` history), the whole `Database`, or a full
transcript — when only a scalar, a single row, or a single chat is mutated.

Use `status.md` for the current state. Use
[`../frontend-performance-audit.md`](../frontend-performance-audit.md) as the
seed inventory. The code remains the source of truth.

## Read Order

1. [`status.md`](status.md) - current snapshot and navigation router.
2. [`next-steps.md`](next-steps.md) - tactical entry point for selecting the
   next coherent task batch.
3. [`active-risk-analysis.md`](active-risk-analysis.md) - per-area analysis of
   the over-broad clone cost and its target (scalar / single-row / single-chat)
   range.
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
  [`../frontend-performance-audit.md`](../frontend-performance-audit.md); it has
  the per-finding location, cost analysis, hot-path frequency, recommended fix,
  the clone-site inventory, and the "investigated but not flagged" rejections
  this plan was split from.

## Source Anchors

- [`../frontend-performance-audit.md`](../frontend-performance-audit.md) - the
  audit that seeded this plan (4 critical, 13 high, 6 medium, 6 low, plus the
  full clone-site inventory).
- `src/ts/server/projectionWriteGuard.svelte.ts` -
  `withTrustedServerProjectionWrite` / `snapshotServerProjectionValue`; the
  full-`Database` clone amplifier behind ~100 guarded writes.
- `src/ts/chatCommands.ts` - `currentChatStateSnapshot` / `restoreChatState`,
  the whole-characters rollback baseline on every message path.
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
- [`../structure/server-projection-and-bridges.md`](../structure/server-projection-and-bridges.md),
  [`../structure/frontend.md`](../structure/frontend.md), and
  [`../structure/data-and-events.md`](../structure/data-and-events.md) -
  projection guard, bridge watchers, hydration, revision, and active-writer
  references.
- [`../../STRUCTURE.md`](../../STRUCTURE.md) - present-tense code navigation.

## Reference Fix

`c9e728b1` ("perf: stop deep-cloning the whole characters array on sidebar
character clicks") is the template this plan generalizes:

- The old `changeChar` path captured its optimistic-rollback baseline via
  `currentCharacterStateSnapshot()`, which `JSON.parse(JSON.stringify(...))`-
  deep-cloned the entire `DBState.db.characters` array — every hydrated chat's
  full `message[]` included — synchronously on the UI thread on every sidebar
  click, freezing it 1-3s before the select + hydration requests could fire.
- Selecting a character only mutates three scalars
  (`lastInteraction`/`currentChar`/`selectedCharID`), so the new path captures a
  scalar-only `CharacterSelectionSnapshot` via
  `currentCharacterSelectionSnapshot` and rolls back via
  `restoreCharacterSelection`.
- The heavy full-array snapshot stays in use only for create/delete/reorder,
  which genuinely restructure the array.
- The regression proof
  (`src/ts/compatibilityAdapters.test.ts`) asserts the snapshot "captures only
  scalar selection state, never a deep clone of every character"
  (`expect(snapshot).not.toHaveProperty('characters')`) and that a failed select
  rolls back the selection only, without clobbering an unrelated character's
  `lastInteraction`/`name`.

Every slice in this plan reproduces that shape: a scalar / single-row /
single-chat snapshot+restore pair on the hot path, the full-collection clone
reserved for genuine restructures, and a regression test that asserts the hot
path never materializes the whole-characters / whole-`Database` clone.
