# Display/Language/Accessibility Settings Audit

Result: bad. I found one likely persistence issue in the translator preset editor where a locally edited value can be dropped before it reaches the command payload. I did not find the same class of issue in the checked display, accessibility, chat format, hotkey, or backup/settings export controls.

## Likely Issue

### Translator preset edits are discarded when another preset is touched before the debounce fires

- Files:
  - `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:144`
  - `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:150`
  - `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:167`
  - `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:203`
  - `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:372`
  - `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:386`

`queueTranslatorPresetUpdate()` debounces preset field updates for 250 ms. If a different `presetId` is queued while an existing update timer is active, it clears the old timer and resets the old patch without dispatching it:

```ts
if (pendingTranslatorPresetUpdate.presetId !== presetId && pendingTranslatorPresetUpdate.timer) {
  clearTimeout(pendingTranslatorPresetUpdate.timer)
  pendingTranslatorPresetUpdate.timer = null
  pendingTranslatorPresetUpdate.patch = {}
  pendingTranslatorPresetUpdate.previous = null
  pendingTranslatorPresetUpdate.attempted = null
}
```

The prompt and max-response controls enqueue their edits through that debounce at `TranslatorPresetSettings.svelte:372` and `TranslatorPresetSettings.svelte:386`. The preset selector can dispatch a select command immediately at `TranslatorPresetSettings.svelte:203`, and create/delete/import controls can also move the active preset while an edit is still pending.

Repro shape:

1. Enable LLM translator presets.
2. Edit preset A's prompt or response size.
3. Within 250 ms, switch to preset B or import/create/select another preset.
4. The pending update for preset A is cleared locally and never sent via `updateTranslatorPresetCommand()`.

This is a likely data-loss issue because the edited text/number exists in the control path briefly, but the pending patch can be thrown away before it becomes a command payload. In Fastify mode, these setters also do not update `DBState.db` optimistically for the server-backed path, so there is no durable optimistic state to recover the dropped edit from.

## Checked Areas Without This Issue

- Generic settings wrappers copy edited values into `DBState.db` under a trusted projection write and then build command patches from the edited DB value. This covers normal data-driven display, language, accessibility, and chat format controls using `bindKey`, `bindPath`, `getValue`, or `setValue`: `src/ts/setting/utils.ts:65`, `src/ts/setting/utils.ts:142`, `src/ts/setting/utils.ts:157`.
- The server settings bridge used by custom controls writes optimistic state before dispatching command patches: `src/ts/server/settingsBridge.svelte.ts:107`.
- Custom color scheme, custom text theme, and custom background controls call `applyServerBackedSetting()` with the edited object/value: `src/lib/Setting/Pages/Display/CustomColorSchemeEditor.svelte:27`, `src/lib/Setting/Pages/Display/CustomTextThemeEditor.svelte:16`, `src/lib/Setting/Pages/Display/CustomBackgroundToggle.svelte:13`.
- Hotkey edits build a fresh copied hotkey array and pass it to the settings bridge, avoiding mutation of the read-only projection: `src/lib/Setting/Pages/HotkeySettings.svelte:8`.
- Accessibility and chat-format settings are data-driven `bindKey` controls and flow through the generic wrapper path: `src/ts/setting/accessibilitySettingsData.ts:20`, `src/ts/setting/chatFormatSettingsData.ts:10`.
- The settings bug-report export is read-only and strips sensitive/config-heavy fields before download/clipboard: `src/lib/Setting/Pages/Advanced/SettingsExportButtons.svelte:32`.
- Backup restore/import controls call server backup/import helpers and then refresh projection state; they do not locally construct partial config mutation payloads from edited form state: `src/lib/Setting/Pages/UserSettings.svelte:93`, `src/lib/Setting/Pages/UserSettings.svelte:130`, `src/ts/storage/backup.ts:78`.

## Suggested Fix Direction

Before changing preset selection/create/delete/import, flush the pending translator preset update instead of clearing it, or keep one pending patch per preset ID so edits to preset A are still dispatched after the user moves to preset B. Also consider mirroring prompt/max-response/name edits into optimistic `DBState.db` in the Fastify path, matching the generic settings bridge behavior.
