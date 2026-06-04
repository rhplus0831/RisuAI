# Phase 3: Client Clone Narrowing (Root 2)

Status: COMPLETE (`0efa7ba6`, one batch: M12-M14, L31-L36, U4). Addressed the
client whole-corpus clones left after the snapshot-family narrowing. Uses
`src/ts/__tests__/cloneCostHarness.ts`.

Goal: hot client paths use scalar/single-row rollbacks instead of
`cloneJsonValue(DBState.db.characters)`. Drop redundant full `setDatabase` on var
writes. Keep `currentChatStateSnapshot` for create/delete/reorder/fork.

Findings: M12, M13, M14, L31, L32, L33, L34, L35, L36, U4.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  M12, M13, M14, L31-L36, U4.
- `src/ts/process/command.ts` (`/setvar`, `/addvar`),
  `src/ts/storage/database.svelte.ts` (`setDatabase` normalizer, `setCurrentChat`),
  `src/lang/index.ts` (`changeLanguage`).
- `src/ts/characterCommands.ts` (`changedCharacterFields`,
  `sanitizeCharacterPatch`, `currentCharacterRowSnapshot`).
- `src/ts/process/sendChatContext.ts` (`setupSendChatContext`).
- `src/ts/chatCommands.ts` (`currentChatStateSnapshot`, scoped variants,
  `runOptimisticCommandSequence`), `src/ts/moduleCommands.ts`
  (`toggleSelectedChatModule`), `src/ts/process/mcp/risuaccess/characters.ts`
  (`setCharacterInfo`), `src/ts/stores.svelte.ts` (the modules `$effect`).
- `src/ts/server/scriptDefinitionBridge.svelte.ts`,
  `src/ts/server/lorebookBridge.svelte.ts` (watcher clones).

## Slices

- [`client-clone-narrowing.md`](slices/phase-3-client-clone-narrowing/client-clone-narrowing.md) -
  full batch:
  - M12: drop the redundant `setDatabase(db)` in `/setvar`/`/addvar` (mirror
    `setChatVar`); do not lump in `/send`/`mutateCurrentChatMessages`.
  - M13: `changedCharacterFields` clones per kept key, skipping
    `CHARACTER_PATCH_EXCLUDED_KEYS` before any clone (also
    `prepareCompatibleCharacterUpdate`).
  - M14: `setupSendChatContext` uses `currentCharacterRowSnapshot(selectedChar)`
    + `restoreCharacterRow`.
  - L34/L35/U4: `toggleSelectedChatModule`, MCP `setCharacterInfo`, and
    `setCurrentChat` use the existing scoped chat/character snapshots.
  - L33: avoid deep-cloning the modules array as a dependency read in the
    `stores.svelte` `$effect`.
  - L31: scope/throttle the script-definition watcher's per-keystroke
    scan-and-stringify.
  - L32: scope the discrete lorebook-editor clone + whole-DB id-assign to the
    edited collection [known-leftover].
  - L36: fire-and-forget command runners surface/await factory rejections and
    roll back (a stability fix, not a clone).

## Planned Shape

- The narrow snapshot kit already exists; this phase wires remaining callers to
  it.
- M12 mirrors `setChatVar`, which already works without `setDatabase`.
- L36 changes only the failure path: failed optimistic commands roll back instead
  of silently diverging.

## Exit Criteria

- [x] Each listed call site captures a scalar/single-row rollback; a clone-cost
      test proves it does not clone the `characters` array on the hot path.
- [x] Each narrowed rollback restores exactly the mutated slice; a
      rollback-correctness test proves a failed command does not clobber unrelated
      edits.
- [x] M12: `/setvar`/`/addvar` no longer call `setDatabase`; scriptstate write +
      persistence still occur; non-English UI no longer deep-clones the language
      pack per var write.
- [x] L36: a failing optimistic command rolls back and surfaces; no swallowed
      rejection on the runner paths.
- [x] `currentChatStateSnapshot` remains in use for create/delete/reorder/fork.
- [x] Gates registered in Phase 8; client suite + audit + TypeScript checks green.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/compatibilityAdapters.test.ts`
- `pnpm test -- src/ts/server/scriptDefinitionBridge.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts`
- `pnpm test`, `pnpm client-thinning:audit`, both TypeScript checks.
