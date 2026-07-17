# Custom sidebar `databaseKey` item renders blank

## Summary

The persisted custom-sidebar schema accepts `type: "databaseKey"`, but the runtime custom sidebar has no render branch for it. The configuration survives normalization, server persistence, reload, and display in the configuration dialog while producing a silent blank in the actual sidebar.

## Location

- `src/lib/SideBars/CustomSidebar.svelte:11-43`
- `src/lib/Others/CustomSidebarConfig.svelte:12-40,55-74,91-151`
- `src/ts/storage/database.svelte.ts:3113-3125,3138-3152,3957-3990`
- `src/ts/server/settingsBridge.svelte.ts:137-268,451-486,535-567,1379-1395`
- `src/ts/server/settingsGroups.ts:75-86`
- `server/fastify/src/routes/commands.ts:1844-1907`
- `server/fastify/src/routes/commands.ts:8464-8503`

## Trigger

Load or import a persisted `customSidebarItems` entry with valid `id`, `subType`, and `label` fields and `type: "databaseKey"`, then open both the custom-sidebar configuration dialog and the custom sidebar.

## Expected behavior

The runtime sidebar should render the database-backed control represented by the item. If that item type is no longer supported, normalization should explicitly migrate or remove it so configuration and runtime display agree.

## Actual behavior

The configuration dialog lists the item by label, and edits to the list remain persisted, but the corresponding runtime sidebar position renders no control and no error or fallback.

## Underlying cause

`CustomSideBarItem` and `normalizeCustomSidebarItems` explicitly accept `databaseKey` (`database.svelte.ts:3957-3990`), including when applying full or targeted server resources (`database.svelte.ts:3113-3125,3138-3152`). `CustomSidebar` also retains the type in its filter (`CustomSidebar.svelte:13-24`), but its markup handles only `model`, `loadout`, and `setting` (`CustomSidebar.svelte:28-43`). Because the item is neither rejected nor rendered, it becomes a durable schema/display mismatch.

## Affected data flow

1. **UI:** The configuration dialog renders every item in its server-backed `customSidebarItems` draft (`CustomSidebarConfig.svelte:12-40,55-74`). Its current add UI creates model, loadout, or setting items, but existing/imported `databaseKey` rows remain visible (`CustomSidebarConfig.svelte:91-151`).
2. **Client state:** `createServerBackedSettingDraft` writes changed arrays optimistically and queues a settings patch (`settingsBridge.svelte.ts:137-268,451-486`).
3. **Client request:** `customSidebarItems` belongs to the `sidebar` settings group (`settingsGroups.ts:75-86`), so the durable intent sends `PATCH /api/v1/commands/settings/sidebar` (`settingsBridge.svelte.ts:535-567,1379-1395`).
4. **Server persistence/response:** Fastify's custom-sidebar validator explicitly accepts `databaseKey` (`server/fastify/src/routes/commands.ts:8464-8503`). The settings route then applies the patch, writes settings to SQLite, and acknowledges the accepted key (`server/fastify/src/routes/commands.ts:1844-1907`).
5. **Hydration/display:** Resource normalization preserves the entry (`database.svelte.ts:3113-3125,3957-3990`). `CustomSidebar` filters it in but reaches no matching markup branch, so the persisted row remains invisible (`CustomSidebar.svelte:11-43`).

## Severity and user impact

**Low to medium.** No underlying settings data is lost, but the UI persistently disagrees with its configuration and gives no indication why a configured control is absent. Legacy or imported custom sidebars can contain multiple silent gaps.

## Recommended fix

Choose one schema contract and enforce it end to end:

- implement a `databaseKey` render branch backed by the appropriate server-backed setting draft and validate allowed keys; or
- remove `databaseKey` from `CustomSideBarItem` and `CUSTOM_SIDEBAR_ITEM_TYPES`, migrate supported legacy entries to `setting`, and discard unsupported entries with an explicit migration diagnostic.

Do not leave the type accepted by normalization while omitted by rendering.

## Test coverage gap

`src/lib/SideBars/CustomSidebar.svelte.test.ts:1-63` exercises normal rendered item types but does not assert behavior for every accepted schema discriminant. Add a parameterized contract test over `CUSTOM_SIDEBAR_ITEM_TYPES` that requires each accepted type to render a control or be removed during normalization, plus a reload round-trip for a legacy `databaseKey` item.
