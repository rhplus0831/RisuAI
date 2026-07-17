# Legacy GUI setting does not update mounted settings layouts

## Summary

`useLegacyGUI` is persisted and reconciled through the Fastify settings path, but three mounted settings pages project it into one-time local `submenu` state. After the setting changes, the authoritative value and the visible tabbed-versus-stacked layout can disagree until the page is remounted.

## Location

- Setting definition: `src/ts/setting/displaySettingsData.svelte.ts:403-407`
- Generic setting control and write path: `src/lib/Setting/Wrappers/SettingCheck.svelte:15-30`; `src/ts/setting/utils.ts:158-189`
- Display Settings local layout state: `src/lib/Setting/Pages/DisplaySettings.svelte:14-16,22-64`
- Legacy Bot Settings local layout state: `src/lib/Setting/Pages/BotSettings.svelte:406-443,457-458,1203-1256`
- Media/Memory Settings local layout state: `src/lib/Setting/Pages/OtherBotSettings.svelte:52-53,140,594-638,1282-1324`
- Settings group mapping and client command: `src/ts/server/settingsGroups.ts:325-345`; `src/ts/server/commands.ts:2043-2061,2112-2144`
- Server persistence and response: `server/fastify/src/routes/commands.ts:1844-1907`
- Client acknowledgement projection: `src/ts/server/commands.ts:5623-5670`; `src/ts/server/resourceState.svelte.ts:771-825`

## Trigger

Either of these paths exposes the issue:

1. In mounted Display Settings, open the Other tab and toggle **Use Legacy GUI**.
2. While Display Settings, legacy Bot Settings, or Media/Memory Settings is mounted, change `useLegacyGUI` from another tab and allow its resource update to arrive.

## Expected behavior

When `useLegacyGUI` becomes `true`, the affected legacy settings pages should switch to their stacked layout. When it becomes `false`, they should switch to tabbed navigation while retaining a valid selected tab.

## Actual behavior

- Display Settings and Media/Memory Settings remain in whichever mode was selected at mount in both directions.
- Legacy Bot Settings remains in modern tab mode when the value changes from `false` to `true`. Its `true` to `false` direction happens to reset because `-1` becomes invalid.
- The persisted setting and resource projection are correct, but the mounted UI remains stale until remount.

## Underlying cause

Display Settings and Media/Memory Settings initialize `submenu` from `useLegacyGUI` once at `src/lib/Setting/Pages/DisplaySettings.svelte:14` and `src/lib/Setting/Pages/OtherBotSettings.svelte:140`. Their render branches subsequently consult only `submenu`; neither component projects later resource changes into it. The `watchServerBackedSettings(['useLegacyGUI'])` call in OtherBotSettings watches direct local mutations for persistence and does not synchronize resource state into component navigation state (`src/ts/server/settingsBridge.svelte.ts:399-448`).

Bot Settings also initializes once at `src/lib/Setting/Pages/BotSettings.svelte:406-413`. Its repair effect only changes an unavailable submenu at `src/lib/Setting/Pages/BotSettings.svelte:439-443`; for legacy Bot Settings, `0` remains in the fixed `[0, 1, 2, 3]` set when `useLegacyGUI` becomes `true`, so the effect never selects the stacked sentinel `-1`.

## Affected data flow

### UI

The data-driven checkbox is defined at `src/ts/setting/displaySettingsData.svelte.ts:403-407` and rendered through `SettingCheck`, which detects a user change at `src/lib/Setting/Wrappers/SettingCheck.svelte:22-30`.

### Client request

`setSettingValue` performs the optimistic resource write and queues the server-backed setting at `src/ts/setting/utils.ts:158-189`. `useLegacyGUI` maps to the `display` group at `src/ts/server/settingsGroups.ts:325-345`, producing `PATCH /settings/display` through `src/ts/server/commands.ts:2043-2061,2112-2144`.

### Server persistence

Fastify validates the display-group patch, applies it to the database, and writes the settings row at `server/fastify/src/routes/commands.ts:1844-1864`.

### Response

The server returns `acknowledgedKeys` and any canonicalized values at `server/fastify/src/routes/commands.ts:1875-1907`. The client validates the `settings.updated` acknowledgement at `src/ts/server/commands.ts:5623-5670` and applies the canonical projection/revision fence at `src/ts/server/resourceState.svelte.ts:771-825`.

### Display

Despite that successful projection, Display Settings renders from its local `submenu` at `src/lib/Setting/Pages/DisplaySettings.svelte:22-64`, Bot Settings from `submenu` and `sectionVisible` at `src/lib/Setting/Pages/BotSettings.svelte:422-458,1203-1256`, and OtherBotSettings from `submenu` at `src/lib/Setting/Pages/OtherBotSettings.svelte:594-638,1282-1324`. None of those display paths derives the current mode from the reconciled `useLegacyGUI` value.

## Severity and user impact

**Medium.** Persistence succeeds, but the current UI contradicts the saved setting. Cross-tab changes appear to be ignored, and users can see different layout modes before and after navigation or refresh.

## Recommended fix

Add a resource-driven mode transition shared by the three pages. On an observed `false` to `true` transition, set the applicable legacy page to `submenu = -1`. On `true` to `false`, replace `-1` with a valid default but preserve an already valid user-selected tab. In Bot Settings, apply this only when `settingsKind === 'legacy'` so the dedicated model and prompt pages keep their own navigation contracts.

## Test coverage gap

`src/lib/Setting/Pages/DisplaySettings.svelte.test.ts:55-77` checks only modern local tab selection against a fixed `useLegacyGUI: false` mock. `src/lib/Setting/Pages/OtherBotSettings.svelte.test.ts:185-228` also initializes the database with `false`, and the Bot Settings setup at `src/lib/Setting/Pages/BotSettings.pendingFlush.svelte.test.ts:240-265` does not exercise legacy mode transitions.

Add mounted tests for authoritative `false` to `true` and `true` to `false` projections on all three pages. Assert both tab-strip presence and whether all stacked sections are rendered, without remounting the component.
