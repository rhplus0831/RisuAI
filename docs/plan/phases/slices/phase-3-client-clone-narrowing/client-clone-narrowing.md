# Client Clone Narrowing

Status: IMPLEMENTED (`0efa7ba6`). Phase 3. Bundles remaining client
whole-corpus clones plus one runner-rollback fix. Reuses
`src/ts/__tests__/cloneCostHarness.ts`.

## Scope

Move warm/hot callers off `cloneJsonValue(DBState.db.characters)` and onto the
existing scalar/single-row snapshot kit. Drop redundant `setDatabase` on var
writes. Make optimistic runners roll back on failure.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  M12, M13, M14, L31-L36, U4.
- `src/ts/process/command.ts:211/:232` (M12), `src/ts/storage/database.svelte.ts`
  (`setDatabase`, `setCurrentChat` U4), `src/lang/index.ts` (`changeLanguage`).
- `src/ts/characterCommands.ts:362-377` (M13 `changedCharacterFields`),
  `src/ts/process/sendChatContext.ts:96` (M14).
- `src/ts/moduleCommands.ts:196-215` (L34), `src/ts/process/mcp/risuaccess/characters.ts:584`
  (L35), `src/ts/stores.svelte.ts:195` (L33 modules `$effect`).
- `src/ts/server/scriptDefinitionBridge.svelte.ts:248-279` (L31),
  `src/ts/server/lorebookBridge.svelte.ts:122-211` (L32).
- `src/ts/chatCommands.ts:245/:260-274`, `src/ts/characterCommands.ts:150-156`,
  `src/ts/server/commands.ts:2200-2217` (L36 runners).

## Item Checklist

- [x] M12 — drop `setDatabase(db)` in `/setvar`/`/addvar` (mirror
      `setChatVar`); do not include `/send`/`mutateCurrentChatMessages`.
- [x] M13 — `changedCharacterFields` (and `prepareCompatibleCharacterUpdate`)
      clone per kept key, skipping `CHARACTER_PATCH_EXCLUDED_KEYS` before any clone.
- [x] M14 — `setupSendChatContext` uses `currentCharacterRowSnapshot(selectedChar)`
      + `restoreCharacterRow`.
- [x] L34 — `toggleSelectedChatModule` uses a chat-scoped snapshot.
- [x] L35 — MCP `setCharacterInfo` uses a single-row snapshot
      (`dispatchUpdateCharacterScoped`).
- [x] U4 — `setCurrentChat` uses `currentChatScopedSnapshot` +
      `dispatchCompatibleChatUpdateScoped`.
- [x] L33 — avoid deep-cloning the modules array as a dependency read in the
      `stores.svelte` `$effect` (`readModuleUpdateSignals` reads exactly the
      id/hideIcon/backgroundEmbedding/length signals `moduleUpdate` consumes).
- [x] L31 — scope the script-definition watcher's per-keystroke
      scan-and-stringify (`ScriptDefinitionWatchScope`; CharConfig mounts
      `character`, ModuleMenu mounts `module`; id-ensure scoped too).
- [x] L32 — scope the discrete lorebook-editor clone + whole-DB id-assign to
      the edited collection (`currentLorebookCollectionScopedSnapshot` +
      `ensureGlobalLorebookListIds`; MCP/module-apply callers stay broad)
      [known-leftover].
- [x] L36 — fire-and-forget command runners surface/await factory rejections
      and roll back (`runServerCommand` catch + sequence failure path;
      stability, not clone).

## Behavior / Invariants

- Narrowed rollbacks restore only the mutated slice.
- `currentChatStateSnapshot` stays for create/delete/reorder/fork.
- M12: the projection guard + scoped dispatch already persist the in-place
  mutation; removing `setDatabase` changes only cost.
- L36 changes only the failure path (rollback + surface), never the success path.

## Done Criteria

- Clone-cost tests prove hot paths do not clone `characters`; rollback tests
  prove restore scope.
- M12: non-English UI no longer deep-clones the language pack per var write.
- L36: a failing optimistic command rolls back and surfaces (no swallowed
  rejection).
- Gates `M12, M13, M14, L31-L36, U4` registered in Phase 8.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/compatibilityAdapters.test.ts`
- `pnpm test -- src/ts/server/scriptDefinitionBridge.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts`
- `pnpm test`, `pnpm client-thinning:audit`, both TypeScript checks.
