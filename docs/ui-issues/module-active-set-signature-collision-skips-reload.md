# Module active-set signature collision skips chat reparse

## Summary

Active module changes are serialized by joining module IDs with `-`. Different active-module arrays can produce the same string, so applying a loadout can update and persist the underlying module set without invalidating already parsed module-dependent chat text.

## Location

- `src/ts/process/modules.ts:637-677,1087-1115`
- `src/ts/stores.svelte.ts:224-228,250-268,298-309`
- `src/lib/ChatScreens/Chat.svelte:1065-1077,1137-1157`
- `src/ts/cbs.ts:1962-2002`
- `src/ts/loadout.ts:1803-1828,1962-1974,2037-2147,2262-2264`
- `src/ts/moduleCommands.ts:663-710`
- `src/ts/server/commands.ts:4614-4631`
- `server/fastify/src/commands/modules.ts:88-107`
- `server/fastify/src/routes/commands.ts:7245-7287`
- `src/ts/process/modules.test.ts:1212-1242`

## Trigger

Use persisted modules with IDs that contain the separator, then perform one atomic active-set change whose arrays have the same joined form. For example:

- old active IDs: `["a-b", "c"]`
- new active IDs: `["a", "b-c"]`

Applying a loadout replaces `enabledModules` with the second list in one projection update.

Fastify preserves any existing non-empty module ID (`commands/modules.ts:88-107`), so legacy, restored, or externally created module rows are not constrained to UUID-only values.

## Expected behavior

The active module set should change to the requested list and mounted messages should re-evaluate module-dependent CBS expressions against the new set.

## Actual behavior

The projection and server persistence can both contain the new module IDs, and direct module lookups return the new module rows. `moduleUpdate()` nevertheless considers the active set unchanged because both arrays serialize to `a-b-c`. It updates hide-icon/background state but skips the chat and GUI reload pointers. A mounted message such as `{{moduleenabled::...}}` can therefore continue displaying the previous set while Module Settings reflects the new one.

## Underlying cause

`getModules()` already uses `JSON.stringify(ids)` for its cache key and therefore distinguishes the two arrays. `moduleUpdate()` independently computes `m.map(module => module.id).join('-')`, which loses element boundaries. Its `lastModuleIds` comparison is therefore not injective.

The existing collision regression test only exercises `getModuleRegexScripts()`/`getModules()` and proves that the lower-level cache is safe. It does not call `moduleUpdate()` or assert GUI invalidation, leaving the second signature bug uncovered.

## Affected data flow

1. **UI:** The user applies a loadout that atomically swaps the active module list.
2. **Client projection:** Loadout application assigns the complete `nextModules` array to `getDatabase().enabledModules` in one trusted write (`loadout.ts:2037-2147`). Unlike the normal one-module toggle helper, this path does not explicitly call `reloadGuiAfterDefinitionChange()`.
3. **Request:** The loadout's module plans call `enableModuleCommand()` for the membership differences, sending `POST /api/v1/commands/modules/enable` with `{ baseRevision, moduleId, enabled }` (`loadout.ts:1621-1690`; `server/commands.ts:4614-4631`).
4. **Server persistence:** Fastify updates `enabledModules`, writes settings to SQLite, and returns the revision/event plus `{ moduleId, enabled }` (`routes/commands.ts:7245-7283`).
5. **Client acknowledgement:** Optimistic acknowledgements fence the revision without replacing the newer local projection. The root stores effect observes the active-module change and calls `moduleUpdate()` (`stores.svelte.ts:298-309`).
6. **Display:** `getModules()` resolves the correct new rows, but the ambiguous joined signature matches `lastModuleIds`, so `reloadGuiAfterDefinitionChange()` is skipped (`modules.ts:1089-1115`). Because `Chat.svelte` untracks `risuChatParser()` and its parse key has no active-module signature, mounted module-dependent CBS text is not recomputed (`Chat.svelte:1065-1077,1137-1157`).

## Severity and user impact

**Medium, conditional.** Modern UI imports normally generate UUID module IDs, but the server accepts legacy/custom non-empty IDs and restored data can retain them. For an affected database, a loadout can report successful application while mounted module-dependent chat text remains from the previous module set.

## Recommended fix

Use a collision-safe serialization for the invalidation key, such as `JSON.stringify(m.map(module => module.id))`, or compare arrays element by element. Prefer sharing one active-module identity helper with `getModules()` so cache and GUI invalidation cannot diverge again. Add the authoritative definition revision as a separate invalidation input for the related same-ID refresh problem documented in `foreign-module-definition-refresh-leaves-rendered-ui-stale.md`.

## Test coverage gap

Extend the existing hyphenated-ID regression at `modules.test.ts:1212-1242` to call `moduleUpdate()` before and after the colliding swap and assert that `reloadGuiAfterDefinitionChange()` runs for both distinct active sets. Add a loadout/UI test that renders `{{moduleenabled::...}}`, applies the colliding swap, and verifies the projection, command acknowledgements, and displayed expansion converge.
