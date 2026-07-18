# Hypa V3's valid memory summarization model is missing from the UI

## Summary

Fastify accepts and executes two Hypa V3 summarization model modes,
`subModel` and `memory`, but the Hypa V3 preset editor renders only the
`subModel` option. A preset imported or persisted with `memory` therefore has no
matching visible selection, and users cannot choose or restore that supported
mode from the settings UI.

This is primarily a stale/incomplete UI projection of valid server data. The
existing `memory` value is not inherently lost merely by rendering the select;
it remains in the deep draft unless the user explicitly chooses `subModel` or
some other code coerces the binding.

## Location

- `src/lib/Setting/Pages/OtherBotSettings.svelte:98-100` creates server-backed
  drafts for `hypaV3Presets` and the selected preset.
- `src/lib/Setting/Pages/OtherBotSettings.svelte:1492-1498` binds the selected
  preset's `settings.summarizationModel` to a select containing only
  `<OptionInput value="subModel">`.
- `src/ts/server/settingsBridge.svelte.ts:196-346` observes deep changes to the
  `hypaV3Presets` draft and queues a server-backed settings patch.
- `src/ts/server/settingsGroups.ts:152` assigns `hypaV3Presets` to the `memory`
  settings group.
- `server/fastify/src/routes/commands.ts:2008-2071` applies that settings patch,
  writes settings plus the Hypa preset collection table, and acknowledges the
  accepted keys.
- `server/fastify/src/routes/commands.ts:8865-8872` explicitly validates
  `summarizationModel` as `subModel` or `memory`.
- `server/fastify/src/memoryChunkPlanner.ts:55-68` accepts those same two modes
  at runtime.
- `server/fastify/src/databaseDefaults.ts:146-160` defaults new presets to
  `subModel`.
- `server/fastify/__tests__/assemble.test.ts:2407-2425` exercises a real Hypa V3
  preset using `summarizationModel: "memory"`.

## Trigger

1. Import, migrate, or otherwise load a Hypa V3 preset whose
   `settings.summarizationModel` is `memory`.
2. Open Other Bot Settings, enable/navigate to Hypa V3, and select that preset.
3. Inspect the Super Memory model control, or try to switch another preset from
   `subModel` to the memory role.

## Expected behavior

The editor should expose every value accepted by the command validator and
runtime planner. A `memory` preset should visibly select a Memory model option,
and the user should be able to switch between Memory and Sub Model while keeping
the draft, server collection row, and runtime plan aligned.

## Actual behavior

The select contains no option matching `memory`. Depending on browser rendering,
it appears blank/unselected even though the underlying draft still contains a
valid value. The user cannot select `memory` for another preset and can only
replace an existing `memory` value with `subModel` through this control.

This makes the displayed configuration incomplete while the server can continue
executing the hidden Memory choice.

## Underlying cause

The frontend option list was not updated when the server-side memory model role
became a first-class allowed value. There is no shared enum/schema from which the
select and Fastify validator are generated, so the valid-value sets drifted.

## Affected data flow

1. **Authoritative data:** The Hypa V3 collection resource returns a preset with
   `settings.summarizationModel = "memory"`.
2. **Client draft:** `createServerBackedSettingDraft("hypaV3Presets", ...)`
   clones the collection into `hypaV3PresetsDraft.value`.
3. **Displayed state:** `OtherBotSettings.svelte` binds the nested value to a
   select that has no matching option. The UI cannot faithfully display the
   draft even though the value remains readable to code.
4. **User mutation:** Choosing the sole visible option changes the nested draft
   to `subModel`. Deep draft observation records the whole collection change.
5. **Request:** The settings bridge sends
   `PATCH /api/v1/commands/settings/memory` with `hypaV3Presets`.
6. **Server mutation:** Fastify validates each summary model, applies the patch,
   writes the settings record and `hypaV3Presets` collection table, and emits a
   `settings.updated` event for the memory resource.
7. **Runtime:** The memory chunk planner reads the saved value and accepts either
   `subModel` or `memory`, demonstrating that the missing value is a UI defect,
   not unsupported data.

## Severity and likely user impact

**Medium.** Users cannot configure a supported memory model role and cannot tell
why an imported preset behaves differently from what the select displays. A
user trying to repair the blank control can unintentionally replace the valid
Memory mode with Sub Model, changing summarization cost, routing, or quality.

## Recommended fix

Add a `memory` option with an appropriate localized label and keep its value
identical to the server enum. Prefer defining the two summary model roles in a
shared frontend/server schema or shared TypeScript constant so validation and UI
cannot drift again.

Do not normalize an unmatched value to `subModel` during rendering. Unknown
future values should remain visible as unsupported/unknown until the user makes
an explicit choice.

## Test gap

Add a component test that seeds a Hypa V3 preset with `memory`, opens the preset,
and asserts the Memory option is selected without dispatching a patch. Then edit
an unrelated field and verify the outgoing collection still contains `memory`.
Add a second test that selects Memory from a `subModel` preset and verifies the
memory-group PATCH and authoritative resource reconciliation.
