# Phase 0: Baseline Foundations

Status: planned. Two slices, no call site narrowed (that starts in Phase 2).

Goal: add the shared scaffolding the later phases need — the scalar / single-row
/ single-chat snapshot+restore kit, and the clone-cost regression harness — so
that each narrowing is reusable and provable. This phase makes narrowing possible
and provable; it does not change any hot path's behavior.

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
  add the scalar/single-row/single-chat snapshot+restore pairs:
  `currentChatScopedSnapshot`/`restoreChatScopedState` (one chat's `message[]`),
  `ChatScriptstateSnapshot` + `currentChatScriptstateSnapshot`/
  `restoreChatScriptstate` (one chat's `scriptstate`, + the note scalar),
  `CharacterRowSnapshot` + `currentCharacterRowSnapshot`/`restoreCharacterRow`
  (one character row), and `currentGlobalLorebookStateSnapshot`/
  `restoreGlobalLorebookState` (`loreBook`+`loreBookPage`). No call site rewired.
- [`clone-cost-regression-harness.md`](slices/phase-0-baseline-foundations/clone-cost-regression-harness.md) -
  a reusable test helper that asserts (a) a snapshot omits
  `characters`/`characterOrder`/`message`/`modules` payload (structural) and (b)
  a hot path does not invoke the whole-`Database` / whole-characters clone
  primitive (instrumented count or seeded multi-MB DB), generalizing the
  reference fix's two tests.

## Exit Criteria

- [ ] The snapshot kit exists with unit tests proving each `current*Snapshot`
  captures only its scalar/single-row/single-chat slice
  (`not.toHaveProperty('characters')`) and each `restore*` writes back only that
  slice under `withTrustedServerProjectionWrite`, leaving unrelated rows intact.
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
