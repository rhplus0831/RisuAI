# Phase 2: Snapshot-Family Hot-Path Narrowing

Status: planned. Six slices, one per call-site family. Depends on the Phase 0
snapshot kit.

Goal: route the Critical/High `current*StateSnapshot` call sites through the
Phase 0 narrow kit so each hot path captures a scalar/single-row/single-chat
rollback baseline instead of the whole characters array. This is the bulk of the
audit's findings and the direct generalization of the reference fix `c9e728b1`.

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
  the always-on, per-render Critical: drop the full-array
  `currentChatStateSnapshot()` from the tracked `$effect`, capture the rollback
  lazily and per-row only when a change is detected, and rewrite
  `scalarChatMetadata` to pick `CHAT_PATCH_ALLOWED_KEYS` without serializing
  `message`.
- [`chat-scoped-message-paths.md`](slices/phase-2-snapshot-family-narrowing/chat-scoped-message-paths.md) -
  `chatCommands.ts` message-replace rollback, `Chat.svelte` per-message
  edit/delete/bookmark/partial-edit, `DefaultChatScreen.svelte` send/continue and
  the empty-slot button, and the `command.ts` slash-command message mutation →
  `currentChatScopedSnapshot`.
- [`scriptstate-scoped-var-writes.md`](slices/phase-2-snapshot-family-narrowing/scriptstate-scoped-var-writes.md) -
  `triggers.ts` `setVar` / `v2SetAuthorNote`, `chatVar.svelte.ts` `setChatVar`,
  and `command.ts` `/setvar` `/addvar` → `ChatScriptstateSnapshot`; hoist one
  snapshot per `runTrigger` pass.
- [`reroll-swipe-rollback.md`](slices/phase-2-snapshot-family-narrowing/reroll-swipe-rollback.md) -
  the `apply*` helpers' `currentChatStateSnapshot()` → a chat-scoped active-chat
  rollback (the redundant transcript clones are Phase 3).
- [`character-row-snapshot-paths.md`](slices/phase-2-snapshot-family-narrowing/character-row-snapshot-paths.md) -
  `currentCharacterStateSnapshot()` at `setCurrentCharacter`/`setCharacterByIndex`
  and the trigger `v2Set*` callers → `CharacterRowSnapshot`/`restoreCharacterRow`.
- [`global-lorebook-snapshot-paths.md`](slices/phase-2-snapshot-family-narrowing/global-lorebook-snapshot-paths.md) -
  `lorepreset.svelte` select/create/delete → `currentGlobalLorebookStateSnapshot`;
  the 6 lorebook trigger sites → `scopedLorebookStateSnapshot`; drop the redundant
  `setCurrentCharacter` re-clone.

## Exit Criteria

- [ ] Each listed call site captures a scalar/single-row/single-chat snapshot;
  none materializes the whole characters array on the hot path.
- [ ] Each narrowed rollback restores exactly the mutated slice and a failed
  command does not clobber unrelated concurrent edits (rollback-correctness test).
- [ ] `scalarChatMetadata` never serializes `chat.message` / `chat.localLore`.
- [ ] The full-collection snapshots remain in use for create/delete/reorder/fork.
- [ ] Clone-cost regression tests prove the hot paths stay O(slice); `pnpm test`,
  `pnpm api:test`, and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/compatibilityAdapters.test.ts`
- `pnpm test -- src/ts/server/chatBridge` (watcher) and the per-area suites.
- `pnpm test`
- `pnpm api:test`
- `pnpm client-thinning:audit`
