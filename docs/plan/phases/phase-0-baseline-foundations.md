# Phase 0: Baseline Foundations

Status: planned. Two slices, no call site narrowed (that starts in Phase 2).

Goal: add the shared snapshot kit and clone-cost harness. This phase makes later
narrowing reusable and provable; it does not change hot-path behavior.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the shared root-cause note and the recommended-remediation step 2.
- `src/ts/characterCommands.ts` - the reference `CharacterSelectionSnapshot`,
  `currentCharacterSelectionSnapshot`, `restoreCharacterSelection` (the template),
  plus the heavy `currentCharacterStateSnapshot` / `restoreCharacterState`.
- `src/ts/chatCommands.ts` - `currentChatStateSnapshot` / `restoreChatState`,
  `prepareCompatibleChatUpdate` / `snapshotChat`, `cloneJsonValue`.
- `src/ts/server/lorebookBridge.svelte.ts` - `currentLorebookStateSnapshot`,
  the existing `scopedLorebookStateSnapshot` / `restoreScopedLorebookState`.
- `src/ts/compatibilityAdapters.test.ts` - the reference fix's snapshot and
  rollback regression tests (the proof template to generalize).

## Slices

- [`snapshot-helper-kit.md`](slices/phase-0-baseline-foundations/snapshot-helper-kit.md) -
  add these narrow snapshot+restore pairs:
  `currentChatScopedSnapshot`/`restoreChatScopedState` (one chat's `message[]`),
  `ChatScriptstateSnapshot` + `currentChatScriptstateSnapshot`/
  `restoreChatScriptstate` (one chat's `scriptstate`, + the note scalar),
  `CharacterRowSnapshot` + `currentCharacterRowSnapshot`/`restoreCharacterRow`
  (one character row), and `currentGlobalLorebookStateSnapshot` /
  `restoreGlobalLorebookState` (`loreBook` + `loreBookPage`). No call site is
  rewired.
- [`clone-cost-regression-harness.md`](slices/phase-0-baseline-foundations/clone-cost-regression-harness.md) -
  add a reusable test helper that checks snapshots omit full collections and hot
  paths do not invoke whole-DB or whole-characters clone primitives.

## Exit Criteria

- [ ] Unit tests prove each `current*Snapshot` captures only its narrow slice and
  each `restore*` writes back only that slice.
- [ ] The clone-cost regression harness exists and is importable from a single
  place (`__tests__` helper), exposing both the structural snapshot assertion and
  the clone-primitive instrumentation.
- [ ] The reference fix's existing tests still pass and are re-expressed through
  the harness where practical (no behavior change).
- [ ] No hot-path call site is changed; `pnpm test` and `pnpm api:test` are green.

## Validation

- `pnpm test -- src/ts/compatibilityAdapters.test.ts`
- `pnpm test -- src/ts/chatCommands.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
