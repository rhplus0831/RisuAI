# Plugin bridge settings writes bypass the selected model-preset mirror

## Summary

When a plugin writes model-preset-owned scalars (`temperature`, `maxContext`,
`maxResponse`, penalties, `currentPluginProvider`, …) through the V2.1 db
proxy / `setDatabaseLite`, the bridge persists them as plain settings patches
(or the provider command). UI edits of the same fields go preset-first: they
mirror into the selected model preset row. Nothing reconciles the preset row
after a bridge write, so the next preset edit or re-selection re-applies the
preset's stale copy over the plugin's accepted value — the UI flips back while
the server settings row still holds the plugin's value, and surfaces disagree
until the next refresh.

## Location

- `src/ts/plugins/plugins.svelte.ts:889-922` — the bridge routes
  `currentPluginProvider` to `dispatchSelectPluginProvider` (`:893-895`) and
  other allowed keys to a plain settings patch (`:920`); no preset mirror.
- `src/ts/pluginCommands.ts:630-658` — provider dispatch writes settings only.
- `server/fastify/src/routes/commands.ts:8068-8100` — `/plugins/provider`
  persists settings only; `:2130-2197` — the settings-group PATCH has no
  preset mirror either.
- `src/ts/presetSplit.ts:3-68` — the affected keys are model-preset fields.
- `src/ts/storage/database.svelte.ts:5522-5546` — `updateModelPreset`
  re-applies all fields of the selected preset to the projection, stomping the
  bridge-written value.
- `src/lib/Setting/Pages/BotSettings.svelte:327-346` — UI edits go through the
  preset mirror (`mirrorTopLevelPresetField`), which the bridge bypasses.

## Trigger

1. A plugin sets `db.temperature = 0.9` (or `db.currentPluginProvider = 'X'`)
   via `setDatabaseLite` or the V2.1 proxy; the command is accepted and
   persisted into settings.
2. The user later edits any other model field in Bot Settings (patching the
   selected model preset), or re-selects the preset.

## Expected behavior

The plugin's accepted, persisted value survives unrelated preset edits; all
components agree on the effective value.

## Actual behavior

The preset row still holds the pre-plugin value. `updateModelPreset`
re-applies every preset field to the projection, visibly reverting the
plugin's value in the UI, while the server settings row keeps the plugin's
value — projection and server disagree until the next settings read flips the
UI again (flip-flop across components). Re-selecting the preset also reverts
the value server-side via `applyModelPreset`.

## Underlying cause

Two owners for the same scalar: UI writes are preset-first (mirrored), plugin
bridge writes are settings-first, and nothing reconciles the selected preset
row after a bridge write.

## Affected data flow

1. Plugin proxy set → optimistic top-level write + settings/provider command.
2. Server settings updated; selected preset row stale.
3. User preset edit → client re-applies all preset fields → UI reverts.
4. Later settings/providers refresh re-applies the plugin value → flip-flop.

## Severity and likely user impact

**Medium** (medium confidence — depends on plugins that write these keys).
Silent generation-parameter/provider flip-flops; plugin-visible state diverges
from Bot Settings.

## Recommended fix

In `applyPluginDatabasePatch`, route model-preset-owned keys through the same
mirror BotSettings uses (`mirrorTopLevelPresetField`, falling back to the
plain settings patch when no preset is selected); apply the same mirroring for
`dispatchSelectPluginProvider`.

## Test gap

A test where a plugin writes `temperature`, then a preset field edit runs, and
the projection retains the plugin's value.
