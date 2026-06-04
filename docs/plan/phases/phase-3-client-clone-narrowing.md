# Phase 3: Client Clone Narrowing (Root 2)

Status: not started. Addresses the surviving client whole-corpus deep clones the
frontend-performance workstream's snapshot-family narrowing did not cover.
Depends on the existing client clone-cost harness
(`src/ts/__tests__/cloneCostHarness.ts`).

Goal: each warm/hot client path captures a scalar or single-row rollback instead
of `cloneJsonValue(DBState.db.characters)`, and the redundant full-`setDatabase`
normalize on var writes is dropped. Keep `currentChatStateSnapshot` for genuine
restructures (create/delete/reorder/fork).

Findings: **M12, M13, M14, L31, L32, L33, L34, L35, L36, U4**.

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
  the full batch:
  - M12: drop the redundant `setDatabase(db)` in `/setvar`/`/addvar` (mirror
    `setChatVar`); do **not** lump in `/send`/`mutateCurrentChatMessages`.
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
    edited collection **[known-leftover]**.
  - L36: fire-and-forget command runners surface/await factory rejections and
    roll back (a stability fix, not a clone).

## Planned Shape

- The narrow snapshot kit already exists (`currentChatScopedSnapshot`,
  `currentCharacterRowSnapshot`, `dispatchCompatibleChatUpdateScoped`,
  `restoreCharacterRow`); this phase wires the remaining callers through it,
  mirroring the landed Phase 2 of the frontend-performance workstream.
- M12's redundancy is proven by `setChatVar` doing the identical mutation without
  `setDatabase`; the projection write guard's refreeze already persists the
  in-place mutation.
- L36 changes the failure mode (a failed optimistic command rolls back instead of
  silently diverging); it must not change the success path.

## Exit Criteria

- [ ] Each listed call site captures a scalar/single-row rollback; a clone-cost
      test proves it does not clone the `characters` array on the hot path.
- [ ] Each narrowed rollback restores exactly the mutated slice; a
      rollback-correctness test proves a failed command does not clobber unrelated
      edits.
- [ ] M12: `/setvar`/`/addvar` no longer call `setDatabase`; scriptstate write +
      persistence still occur; non-English UI no longer deep-clones the language
      pack per var write.
- [ ] L36: a failing optimistic command rolls back and surfaces; no swallowed
      rejection on the runner paths.
- [ ] `currentChatStateSnapshot` remains in use for create/delete/reorder/fork.
- [ ] Gates registered in Phase 8; client suite + audit + TypeScript checks green.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/compatibilityAdapters.test.ts`
- `pnpm test -- src/ts/server/scriptDefinitionBridge.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts`
- `pnpm test`, `pnpm client-thinning:audit`, both TypeScript checks.
