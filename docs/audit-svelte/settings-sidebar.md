# Settings And Sidebar Findings

## Mobile Hotkey Settings Can Render Blank

- Source:
  `src/lib/Setting/Settings.svelte:169-179`,
  `src/lib/Setting/Settings.svelte:291-292`
- Symptom:
  On narrow screens, tapping Hotkey can select the menu item but leave the
  content pane blank.
- Why likely:
  The navigation button is always available, but `HotkeySettings` only renders
  when `window.innerWidth >= 768`. Direct `window.innerWidth` reads are also not
  reactive on resize.
- Remediation:
  Always render `HotkeySettings` and let it provide its small-screen fallback, or
  hide/disable the nav item with reactive viewport state.

## Chat Row Actions Bubble To Chat Selection

- Source:
  `src/lib/SideBars/SideChatList.svelte:448-455`,
  `src/lib/SideBars/SideChatList.svelte:468-534`,
  `src/lib/SideBars/SideChatList.svelte:599-607`,
  `src/lib/SideBars/SideChatList.svelte:619-684`
- Symptom:
  Opening the chat menu or toggling edit mode can also select/switch to that
  chat.
- Why likely:
  Action controls are nested inside the row `<button>` and the menu/edit
  handlers do not stop propagation. Some later actions do call
  `e.stopPropagation()`, which makes the inconsistency visible.
- Remediation:
  Make action controls siblings of the row-select button, or stop propagation on
  every nested action.

## Plugin Row Controls Toggle Expansion

- Source:
  `src/lib/Setting/Pages/PluginSettings.svelte:70-81`,
  `src/lib/Setting/Pages/PluginSettings.svelte:91-179`
- Symptom:
  Clicking plugin update/delete/enable/warning/link controls can also
  expand/collapse the plugin detail panel.
- Why likely:
  The whole row has an expansion `onclick`, and child controls mostly do not
  stop propagation.
- Remediation:
  Move expansion onto a dedicated header button, or call `stopPropagation()` on
  child controls.

## Expanded Plugin State Uses List Indexes

- Source:
  `src/lib/Setting/Pages/PluginSettings.svelte:37`,
  `src/lib/Setting/Pages/PluginSettings.svelte:65-80`
- Symptom:
  After deleting, reordering, or importing plugins, an expanded details panel can
  appear under the wrong plugin.
- Why likely:
  `showParams` stores numeric indexes and the plugin `{#each}` is unkeyed, so
  Svelte and the state both track rows by position.
- Remediation:
  Key the each block by stable plugin identity and store expanded plugin names or
  ids instead of indexes.

## Plugin Select Options Render Literal Text

- Source:
  `src/lib/Setting/Pages/PluginSettings.svelte:211-222`
- Symptom:
  Every option in plugin select arguments appears as `a`.
- Why likely:
  The option body is literal text instead of interpolating the loop variable.
- Remediation:
  Render `<OptionInput value={a}>{a}</OptionInput>` or a richer label from
  plugin metadata.

## Streaming Auto-Toggle Predicate Is Asymmetric

- Source:
  `src/lib/Setting/Pages/BotSettings.svelte:456-459`
- Symptom:
  Some TextGen/Mancer combinations do not auto-sync streaming from the
  `wss://` URL, while other combinations do.
- Why likely:
  The predicate checks `aiModel === 'textgen_webui'` or `subModel === 'mancer'`,
  but misses the inverse combinations exposed elsewhere in the UI.
- Remediation:
  Centralize a provider predicate that checks both `aiModel` and `subModel` for
  both providers.

## WaveSpeed Reference Reset Appears Inverted

- Source:
  `src/lib/Setting/Pages/OtherBotSettings.svelte:246-255`
- Symptom:
  Selecting an image-reference-capable model clears `reference_mode` and
  reference images; selecting a text-only model can leave hidden stale reference
  values.
- Why likely:
  The code resets when `selectedModel?.supportsImageInput` is true, while the
  comment says the reset is for text-to-image models.
- Remediation:
  Reset when `!selectedModel?.supportsImageInput`.

## One-Item Drop Lists Can Corrupt The List

- Source:
  `src/lib/SideBars/DropList.svelte:10-45`
- Symptom:
  A one-item formatting list can be transformed into extra `undefined` slots by
  clicking reorder arrows.
- Why likely:
  Boundary wrapping reads `list[i + 1]` or `list[i - 1]` without guarding
  `list.length < 2`.
- Remediation:
  Disable or no-op reorder controls when the list has fewer than two items.
