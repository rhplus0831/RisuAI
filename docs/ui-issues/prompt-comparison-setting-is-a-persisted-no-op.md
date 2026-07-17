# Prompt-comparison setting is a persisted no-op

## Summary

The Display Settings checkbox **Show Prompt Comparison** persists `showPromptComparison`, but the active preset picker never reads it. The former compare icon, selection state, and `PromptDiffModal` mount were removed from `botpreset.svelte`; the modal component remains in the repository without a production importer.

Turning the setting on therefore produces no comparison control for prompt, model, or legacy presets even though Fastify successfully stores and acknowledges the value.

## Location

- Setting definition: `src/ts/setting/displaySettingsData.svelte.ts:370-376`
- Setting group and client request: `src/ts/server/settingsGroups.ts:290`; `src/ts/server/commands.ts:2043-2061,2112-2184`
- Fastify persistence and response: `server/fastify/src/routes/commands.ts:1844-1907`
- Active preset-picker mount: `src/App.svelte:41,305-310`
- Current picker: `src/lib/Setting/botpreset.svelte:1-224,226-360`
- Unmounted comparison implementation: `src/lib/Others/PromptDiffModal.svelte`
- Former compare control and modal mount: `/home/codex/Risuai/src/lib/Setting/botpreset.svelte:171-195,295-301`

## Trigger

1. Enable **Show Prompt Comparison** in Display Settings.
2. Open the prompt-preset picker and inspect its preset rows.
3. Repeat with model and legacy preset modes or after reload.

No compare icon or modal entry point appears in any mode.

## Expected behavior

When enabled, preset rows should expose the comparison workflow: select two appropriate prompt presets and open a diff that reflects their current contents. When disabled, those controls should be hidden.

## Actual behavior

The active picker renders the same controls in both states. It imports no compare icon or diff modal, has no selected-diff state/handlers, and never reads `getDatabase().showPromptComparison`. `PromptDiffModal.svelte` has no production reference, so it cannot be mounted through another path.

## Underlying cause

Preset management was rewritten around split model/prompt presets, stable IDs, active-chat selection, and server-owned mutations. The comparison block from the legacy index-based picker was not carried into the rewritten component, but the display setting and its persistence metadata were retained.

The generic settings pipeline has no knowledge that the sole consumer disappeared. It correctly stores and synchronizes the boolean, giving the UI a normal successful-save signal while no render dependency observes it.

## Affected data flow

1. **UI setting:** `SettingCheck` writes `database.showPromptComparison` optimistically.
2. **Request:** the settings bridge sends `PATCH /api/v1/commands/settings/display`.
3. **Persistence/acknowledgement:** Fastify stores the boolean, emits `settings.updated`, and returns `acknowledgedKeys`; resource projection keeps the checkbox correct.
4. **Feature UI:** `App.svelte` mounts the current `Botpreset` for the requested picker kind. That component derives preset rows and selection from resource data but has no dependency on the accepted comparison setting.
5. **Missing display update:** no compare control renders and the existing diff component is never mounted, so the successful setting update has no visible behavioral effect.

## Severity and user impact

**Medium.** A complete prompt-inspection feature is inaccessible while its controlling setting appears functional. Users comparing migrated or edited prompt presets may assume the option is broken transiently and repeatedly toggle it, but reload and cross-client synchronization cannot restore the missing consumer.

## Recommended fix

Either restore comparison in the modern prompt-preset picker or remove the setting. A restored workflow should be limited to compatible prompt presets, identify both operands by stable preset ID, resolve their latest authoritative versions when opening the modal, and close/rebase safely if either preset is deleted or changed remotely. The existing modal should be audited for the split preset schema before simply remounting it.

Add a mounted picker test that projects `showPromptComparison` false to true without remount, selects two stable IDs, and verifies the diff uses their latest resource versions. Add foreign update/delete cases. If the feature is retired, delete the orphaned modal and migrate the stored flag.
