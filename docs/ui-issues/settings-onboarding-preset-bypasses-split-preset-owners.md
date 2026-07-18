# Onboarding writes preset projections without updating split preset owners

## Summary

Final onboarding applies the legacy `prebuiltPresets.OAI2` object directly to
the database-shaped client projection with `setPreset()`, then persists only the
fields recognized by generic settings groups. This is incompatible with the
Fastify split-preset architecture.

Prompt-preset fields changed by `setPreset()` are not settings-group keys and
are never sent to Fastify. Mapped model fields are written only as top-level
settings and not to the selected model preset row. Fresh databases already have
selected model and prompt preset rows, so the local top-level projection, server
prompt runtime, persisted preset rows, and preset-scoped generation can represent
different configurations.
Later preset selection or a mutation that reapplies the selected preset can make
the onboarding values appear to revert.

## Location

- `src/lib/Others/WelcomeRisu.svelte:76-105` invokes final onboarding
  persistence and shows completion when it returns true.
- `src/ts/process/templates/templates.ts:227-330` defines the legacy OAI2 model,
  prompt, and runtime fields.
- `src/ts/storage/database.svelte.ts:6470-6586` assigns those legacy fields to
  the database-shaped projection.
- `src/ts/server/settingsBridge.svelte.ts:733-766` snapshots current settings,
  calls `setPreset()`, applies final choices, diffs mapped settings, and awaits
  their command receipt.
- `src/ts/server/settingsBridge.svelte.ts:1756-1881` builds the explicit final
  patch and excludes every field without a settings-group mapping.
- `src/ts/server/settingsGroups.ts` maps model/runtime fields such as `aiModel`,
  `maxContext`, and `temperature`, but intentionally does not map split prompt
  fields such as `mainPrompt`, `jailbreak`, `globalNote`, or `formatingOrder`.
- `server/fastify/src/databaseDefaults.ts:541-563` creates selected model and
  prompt preset rows before onboarding is rendered.
- `server/fastify/src/routes/commands.ts:2008-2071` writes only settings for a
  generic settings PATCH, with the sole collection exception of Hypa presets.
- `server/fastify/src/routes/commands.ts:3128-3200,3490-3550` contains the actual
  model/prompt preset row mutation paths that onboarding bypasses.
- `server/fastify/src/prompt/effectiveGenerationConfig.ts:77-141` composes chats
  with configured model/prompt preset IDs from those collection rows.
- `src/ts/server/resourceState.svelte.ts:686-724` applies a full authoritative
  settings projection, which can replace locally changed but omitted prompt
  fields.
- `src/ts/storage/database.svelte.ts:5648-5700,6163-6220` reapplies selected
  model/prompt preset rows when preset selection changes.

## Trigger

1. Complete first-run onboarding with any provider.
2. Inspect the selected model/prompt preset rows and current top-level
   provider/prompt projection, or configure a chat to use those preset IDs.
3. Select another preset and return to the default preset, edit the selected
   preset through its owner-aware command path, or make a server-generated
   request for the preset-configured chat. A full authoritative settings reload
   also replaces prompt fields that onboarding changed locally but never sent.

No request failure is required. Every settings PATCH sent by onboarding can
succeed while the owners still diverge.

## Expected behavior

Onboarding should update the durable owners used by the post-migration UI and
runtime. The selected model preset, selected prompt preset, their top-level
selected projections, Fastify prompt assembly, and settings UI should all
describe the same accepted configuration.

## Actual behavior

- On a fresh database, `setPreset()` changes local `mainPrompt` and `jailbreak`,
  but `diffServerBackedSettingsSnapshot()` omits them. (OAI2's `globalNote` and
  `formatingOrder` match the fresh defaults.) Fastify keeps the old prompt values
  and selected prompt-preset row, while the current client can temporarily
  retain the OAI2 projection until a full settings apply.
- `aiModel`, `subModel`, sampling/runtime values, and request-model fields are
  persisted as top-level settings, but the selected model-preset collection row
  remains the fresh default (for example, Gemini). A chat explicitly configured
  with that preset ID is composed from the stale row rather than the onboarding
  top-level values.
- Selecting a split preset, or mutating the selected preset through a path that
  reapplies its row projection, can later make the unchanged row authoritative
  and visibly revert provider, prompt, or parameter choices. Merely applying a
  collection resource does not itself reapply the row projection.

The final helper returns true because every generic settings PATCH it actually
sent was accepted. It never checks the skipped prompt owner or either selected
preset row, so Welcome shows All Done for a configuration that is not internally
consistent.

## Underlying cause

`setPreset()` was designed for the frontend-owned monolithic `Database`, where
mutating top-level fields was the durable operation. After migration, many of
those fields are projections owned by selected model/prompt preset rows. Normal
settings controls call preset-aware mirroring helpers, and normal preset
commands co-write the selected projection.

Onboarding suppresses the settings watcher, invokes the legacy bulk assignment,
and filters the resulting diff through `settingsGroupForKey()`. That filter:

- drops split prompt fields with no generic settings mapping; and
- routes mapped model fields through the wrong server writer.

The Fastify settings route cannot repair the ownership mismatch because it does
not mutate model or prompt preset collection rows.

## Affected data flow

1. **UI interaction:** The user selects provider, chat mode, and memory choices,
   then chooses the final onboarding option.
2. **Client projection:** `applyOnboardingServerBackedSettings()` snapshots the
   database-shaped projection, runs `setPreset(OAI2)`, and applies the selected
   provider/memory/language choices plus `didFirstSetup = true`.
3. **Diff:** Only keys mapped by `settingsGroupForKey()` enter `fullPatch`.
   Prompt-preset fields are excluded; model-preset fields are treated as ordinary
   settings keys.
4. **Requests:** The bridge sends one or more
   `PATCH /api/v1/commands/settings/:group` requests. It sends no
   `PATCH /model-presets/:id` or `PATCH /prompt-presets/:id` request.
5. **Server persistence:** Each settings command applies its slice and calls
   `writeSettingsOnly()`. Existing model/prompt collection rows remain unchanged,
   and omitted prompt values remain the server's prior values.
6. **Acknowledgement:** Accepted settings receipts make the helper return true,
   so Welcome displays All Done and unmounts.
7. **Displayed/runtime state:** Top-level client fields initially reflect the
   legacy assignment, selected-preset UI reads old rows, and server prompt
   assembly reads the authoritative old prompt. A later preset selection or
   selected-preset mutation can overwrite the temporary model projection; a full
   settings application can restore omitted prompt fields from Fastify.
8. **Preset-scoped generation:** If a chat references the model/prompt preset
   IDs, `buildEffectiveGenerationConfig()` composes the request from the stale
   collection rows, not from the divergent onboarding top-level projection.

## Severity and likely user impact

**High.** Every fresh setup can finish with model/prompt configuration that
changes or appears to revert when the user opens preset settings, reloads, or
makes a request. Preset-scoped generation can disagree with legacy/top-level
controls, and the prompt users believe onboarding selected can differ from what
Fastify actually assembles. The UI's success state is not evidence that the
generation configuration was durably established.

## Recommended fix

Remove the legacy `setPreset()` projection write from onboarding. Build an
explicit, ownership-aware onboarding transaction:

1. Construct the intended model-preset patch for the selected model preset and
   prompt-preset patch for the selected prompt preset.
2. Have a dedicated Fastify onboarding command validate and persist those rows,
   their selected top-level projections, non-preset settings, and
   `didFirstSetup` in one transaction.
3. Return canonical preset rows/projections in the acknowledgement and apply
   them through the normal resource/local-effect path.
4. Set `didFirstSetup` only after every owner mutation succeeds. On failure,
   restore/rebase the full client projection and keep the final choice available
   for retry.

If a single transaction cannot be introduced immediately, use the existing
exact model/prompt preset commands in a compensating workflow and do not mark
setup complete until all are accepted. That remains weaker than one atomic
onboarding command but avoids writing projections without their owners.

## Test gap

The current settings-bridge onboarding test mocks a reduced `setPreset()` and
explicitly expects a changed `mainPrompt` to be absent from the settings patch.
It does not seed or assert real split-preset owners, so it codifies the incomplete
write rather than detecting divergence.

Add an integration test using the real OAI2 template and real fresh split-preset
defaults. Assert that:

- selected model/prompt preset rows contain the intended onboarding values;
- top-level selected projections and Fastify prompt assembly match those rows;
- no later preset re-selection or selected-preset edit reverts the
  configuration;
- a chat configured with those preset IDs builds the same effective model and
  prompt; and
- any owner-write failure leaves `didFirstSetup` false.
