# Phase 2: Snapshot-Family Hot-Path Narrowing

Status: implemented. All six slices landed, one per call-site family. Depends on
the Phase 0 snapshot kit.

Goal: route Critical/High `current*StateSnapshot` call sites through the Phase 0
kit. Each hot path should capture a scalar, single-row, or single-chat rollback
instead of the whole characters array.

Each slice keeps the full-collection snapshot for genuine restructures
(create/delete/reorder/fork) and proves the hot path no longer reaches it.

## Source Anchors

- [`../../frontend-performance-audit.md`](../../frontend-performance-audit.md) -
  the Critical/High `currentChatStateSnapshot` / `currentCharacterStateSnapshot`
  / `currentLorebookStateSnapshot` findings and recommended-remediation step 3.
- `src/ts/server/chatBridge.svelte.ts` - the chat-metadata watcher (`:68`) and
  `scalarChatMetadata` (`:190`).
- `src/ts/chatCommands.ts`, `src/lib/ChatScreens/Chat.svelte`,
  `src/lib/ChatScreens/DefaultChatScreen.svelte` - the message-edit / send paths.
- `src/ts/process/triggers.ts`, `src/ts/parser/chatVar.svelte.ts`,
  `src/ts/process/command.ts` - the scriptstate var-write paths.
- `src/ts/process/rerollNavigation.svelte.ts` - the reroll/swipe `apply*`
  helpers' rollback baseline.
- `src/ts/characterCommands.ts`, `src/ts/storage/database.svelte.ts` -
  `setCurrentCharacter` / `setCharacterByIndex` and the trigger `v2Set*` callers.
- `src/lib/Setting/lorepreset.svelte`, `src/ts/server/lorebookBridge.svelte.ts` -
  the global-lorebook select and lorebook-trigger paths.
- [`slices/phase-0-baseline-foundations/snapshot-helper-kit.md`](slices/phase-0-baseline-foundations/snapshot-helper-kit.md) -
  the kit each slice imports.

## Slices

- [`chat-metadata-watcher.md`](slices/phase-2-snapshot-family-narrowing/chat-metadata-watcher.md) -
  (implemented) drop full-array snapshots from the watcher, capture rollback lazily
  per row, and make `scalarChatMetadata` skip `message`.
- [`chat-scoped-message-paths.md`](slices/phase-2-snapshot-family-narrowing/chat-scoped-message-paths.md) -
  (implemented) `chatCommands.ts` message-replace rollback, `Chat.svelte` per-message
  edit/delete/bookmark/partial-edit, `DefaultChatScreen.svelte` send/continue and
  the empty-slot button, and the `command.ts` slash-command message mutation ->
  `currentChatScopedSnapshot`.
- [`scriptstate-scoped-var-writes.md`](slices/phase-2-snapshot-family-narrowing/scriptstate-scoped-var-writes.md) -
  (implemented) `triggers.ts` `setVar` / `v2SetAuthorNote`, `chatVar.svelte.ts` `setChatVar`,
  and `command.ts` `/setvar` `/addvar` -> `ChatScriptstateSnapshot`; hoist one
  snapshot per `runTrigger` pass.
- [`reroll-swipe-rollback.md`](slices/phase-2-snapshot-family-narrowing/reroll-swipe-rollback.md) -
  (implemented) the `apply*` helpers capture `currentChatScopedSnapshot()` and
  persist via the chat-scoped dispatch variants. Phase 3 handles the redundant
  transcript clones.
- [`character-row-snapshot-paths.md`](slices/phase-2-snapshot-family-narrowing/character-row-snapshot-paths.md) -
  (implemented) `setCurrentCharacter`/`setCharacterByIndex` (and their `v2Set*`
  trigger callers) capture `currentCharacterRowSnapshot()` and dispatch via
  `dispatchCompatibleCharacterUpdateScoped` -> `restoreCharacterRow`.
- [`global-lorebook-snapshot-paths.md`](slices/phase-2-snapshot-family-narrowing/global-lorebook-snapshot-paths.md) -
  (implemented) `lorepreset.svelte` select/create/delete -> `currentGlobalLorebookStateSnapshot`;
  the 6 lorebook trigger sites -> `scopedLorebookStateSnapshot` via
  `persistCharacterLorebookEdit`; the redundant `setCurrentCharacter` re-clone is dropped.

## Implementation Notes

- The Phase 0 helpers are exported but not wired into production call sites yet.
  Several dispatch helpers still accept broad snapshots and call broad restores:
  message/scriptstate dispatchers in `chatCommands.ts`, character update
  dispatchers in `characterCommands.ts`, and global-lorebook dispatchers in
  `lorebookBridge.svelte.ts`. Each slice must either widen those signatures to
  accept a snapshot+rollback pair, or add narrow dispatch variants, before
  switching call sites to the Phase 0 snapshots.

## Exit Criteria

- [x] Each listed call site captures a narrow snapshot; none materializes the
      whole characters array on the hot path.
- [x] Each narrowed rollback restores exactly the mutated slice and a failed
      command does not clobber unrelated concurrent edits (rollback-correctness test).
- [x] `scalarChatMetadata` never serializes `chat.message` / `chat.localLore`.
- [x] The full-collection snapshots remain in use for create/delete/reorder/fork.
- [x] Clone-cost regression tests prove the hot paths stay O(slice); `pnpm test`,
      `pnpm api:test`, and `pnpm client-thinning:audit` are green.

All six slices landed: chat-metadata watcher (`e5e183da`), chat-scoped message
paths (`2070df02`), scriptstate var writes (`727a28c0`), reroll/swipe rollback
(`f1558e39`), character-row snapshot paths (`458458a7`), and global-lorebook
snapshot paths (`9547ba3e`). The image/emotion handlers (Phase 7) and the
lower-frequency character/lorebook field-edit callers still hold the broad
snapshot; they reuse the same kit when narrowed.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/compatibilityAdapters.test.ts`
- `pnpm test -- src/ts/server/chatBridge` (watcher) and the per-area suites.
- `pnpm test`
- `pnpm api:test`
- `pnpm client-thinning:audit`
