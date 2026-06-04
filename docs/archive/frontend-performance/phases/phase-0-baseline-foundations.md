# Phase 0: Baseline Foundations

Status: implemented. Two slices landed, no snapshot-family production call site
rewired (that starts in Phase 2).

Goal: add the shared snapshot kit and clone-cost harness. This phase makes later
narrowing reusable and provable; it does not change hot-path behavior.

## Implementation

- Snapshot kit added (no call site rewired):
  `currentChatScopedSnapshot`/`restoreChatScopedState` and
  `ChatScriptstateSnapshot`/`currentChatScriptstateSnapshot`/
  `restoreChatScriptstate` in `src/ts/chatCommands.ts`;
  `CharacterRowSnapshot`/`currentCharacterRowSnapshot`/`restoreCharacterRow` in
  `src/ts/characterCommands.ts`;
  `currentGlobalLorebookStateSnapshot`/`restoreGlobalLorebookState` in
  `src/ts/server/lorebookBridge.svelte.ts`, which also exports the existing
  `scopedLorebookStateSnapshot`/`restoreScopedLorebookState` pair. Each
  `restore*` locates its target by stable id (index only as a fallback) inside
  `withTrustedServerProjectionWrite`.
- Clone-cost harness added at `src/ts/__tests__/cloneCostHarness.ts` (test-only,
  excluded from the client-lib build): `assertSnapshotIsScalar`,
  `assertSnapshotOmitsCollections`, `assertRollbackRestoresOnly`,
  `withCloneInstrumentation` (spies `JSON.stringify`/`structuredClone`), and a
  `seedCloneCostDb` multi-character/multi-message seed builder.
- Proofs: `Phase 0` describe blocks in `src/ts/characterCommands.test.ts`,
  `src/ts/chatCommands.test.ts`, and a new `src/ts/server/lorebookBridge.test.ts`
  prove each snapshot captures only its slice, each restore writes back only that
  slice (and never clobbers concurrent sibling edits), and the sanity baseline
  (`currentCharacterSelectionSnapshot` performs zero whole-characters clones vs
  one for the legacy `currentCharacterStateSnapshot`).

## Source Anchors

- [`../../../frontend-performance-audit.md`](../frontend-performance-audit.md) -
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

- [x] Unit tests prove each `current*Snapshot` captures only its narrow slice and
      each `restore*` writes back only that slice.
- [x] The clone-cost regression harness exists and is importable from a single
      place (`src/ts/__tests__/cloneCostHarness.ts`), exposing both the structural
      snapshot assertions and the clone-primitive instrumentation.
- [x] The reference fix's existing tests still pass; the new kit tests reuse the
      harness's structural and rollback-correctness assertions (no behavior change).
- [x] At Phase 0 landing, no hot-path call site was changed; landing verification
      was green. Current maintained verification is in
      [`../latest-verification.md`](../latest-verification.md).

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/server/lorebookBridge.test.ts src/ts/compatibilityAdapters.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
