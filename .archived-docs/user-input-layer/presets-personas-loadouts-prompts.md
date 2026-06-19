# Presets, Personas, Loadouts, And Prompts

These collection editors use buttons and text fields to create, select, rename, import, delete, reorder, or patch persisted collection rows.

## Model And Prompt Presets

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/botpreset.svelte:168` | `selectPreset` | Preset row/select button. | Selects model or prompt preset id. | Model `server/fastify/src/routes/commands.ts:1891`; prompt `:2173`. |
| `src/lib/Setting/botpreset.svelte:260`, `:266`, `:271` | legacy extract/delete/copy controls | Legacy bot preset buttons. | Extracts legacy preset into model/prompt presets, deletes, or copies preset. | Legacy/model/prompt handlers `server/fastify/src/routes/commands.ts:1363` through `:2305`. |
| `src/lib/Setting/botpreset.svelte:344` | preset rename `TextInput` | Preset name field. | Patches selected model or prompt preset `name`. | Model `server/fastify/src/routes/commands.ts:1778`; prompt `:2063`. |
| `src/lib/Setting/botpreset.svelte:365` | remove modern preset | Delete preset button. | Deletes selected model or prompt preset and updates selection. | Model `server/fastify/src/routes/commands.ts:1829`; prompt `:2112`. |
| `src/lib/Setting/botpreset.svelte:398` | `createNewPreset` | Create preset button. | Creates a model or prompt preset, often selecting it. | Model `server/fastify/src/routes/commands.ts:1739`; prompt `:2024`. |
| `src/lib/Setting/botpreset.svelte:402` | import preset | Import button. | Imports model or prompt preset. | Model `server/fastify/src/routes/commands.ts:1933`; prompt `:2214`. |
| `src/lib/Setting/botpreset.svelte:410` | edit/reorder mode | Edit mode plus drag order. | Reorders presets in edit mode. | Model `server/fastify/src/routes/commands.ts:1972`; prompt `:2253`. |

## Prompt Settings And Prompt Template Items

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/Pages/PromptSettings.svelte:105` through `:125` | `createPromptSettingsDraft(...)` keys | Prompt settings text fields/buttons. | Patches prompt settings, JSON schema, templates, fallback models, extraction/fallback text. | `server/fastify/src/routes/commands.ts:2349`. |
| `src/lib/Setting/Pages/PromptSettings.svelte:168` | `dispatchCreatePromptItem` | Create prompt item button. | Adds a prompt template row. | `server/fastify/src/routes/commands.ts:2381`. |
| `src/lib/Setting/Pages/PromptSettings.svelte:182` | `dispatchDeletePromptItem` | Delete prompt item button. | Deletes a prompt template row. | `server/fastify/src/routes/commands.ts:2460`. |
| `src/lib/Setting/Pages/PromptSettings.svelte:197` | `dispatchReorderPromptItems` | Drag/reorder controls. | Reorders prompt template rows. | `server/fastify/src/routes/commands.ts:2541`. |
| `src/lib/Setting/Pages/PromptSettings.svelte:489` and later | prompt setting inputs | JSON schema/template/fallback fields and toggles. | Patches prompt settings. | `server/fastify/src/routes/commands.ts:2349`. |
| `src/lib/Setting/Pages/PromptSettings.svelte:563` | add prompt item button | Adds prompt template item. | Creates a prompt item. | `server/fastify/src/routes/commands.ts:2381`. |
| `src/lib/UI/PromptDataItem.svelte:209`, `:214`, `:219` | up/down/delete buttons | Prompt item move/delete buttons. | Reorders or deletes prompt template item. | `server/fastify/src/routes/commands.ts:2460`, `:2541`. |
| `src/lib/UI/PromptDataItem.svelte:228` | `promptItem.name` | Prompt item name `TextInput`. | Updates prompt item name. | `server/fastify/src/routes/commands.ts:2419`. |
| `src/lib/UI/PromptDataItem.svelte:271`, `:281`, `:332`, `:352` | `promptItem.text`, `defaultText`, `innerFormat` | Prompt item text fields. | Updates prompt item content/format fields. | `server/fastify/src/routes/commands.ts:2419`. |
| `src/lib/UI/PromptDataItem.svelte:147` and child controls | prompt item card | Type/role/range/check controls around the text fields. | Updates prompt item settings and enabled state. | Update `server/fastify/src/routes/commands.ts:2419`; enable `:2496`. |

## Personas

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/Pages/PersonaSettings.svelte:67` | Sortable persona list | Drag/reorder personas. | Reorders personas and keeps selected persona id. | `server/fastify/src/routes/commands.ts:2813`. |
| `src/lib/Setting/Pages/PersonaSettings.svelte:108` | persona row button | Select persona. | Updates selected persona. | `server/fastify/src/routes/commands.ts:2758`. |
| `src/lib/Setting/Pages/PersonaSettings.svelte:137` | create/import chooser button | Create or import persona. | Creates persona row; may select it. | `server/fastify/src/routes/commands.ts:2580`. |
| `src/lib/Setting/Pages/PersonaSettings.svelte:159` | `selectUserImg` | Persona icon button. | Uploads/selects persona icon and updates persona/user icon fields. | Assets `server/fastify/src/routes/assets.ts:220`; persona patch `commands.ts:2627`. |
| `src/lib/Setting/Pages/PersonaSettings.svelte:177` | `username` | Persona name `TextInput`. | Updates selected persona name and legacy `username` mirror. | `server/fastify/src/routes/commands.ts:2627` plus settings mirror where applicable. |
| `src/lib/Setting/Pages/PersonaSettings.svelte:183` | `userNote` | Persona note `TextAreaInput`. | Updates selected persona note and legacy `userNote` mirror. | `server/fastify/src/routes/commands.ts:2627`. |
| `src/lib/Setting/Pages/PersonaSettings.svelte:189` | `personaPrompt` | Persona prompt `TextAreaInput`. | Updates selected persona prompt and legacy `personaPrompt` mirror. | `server/fastify/src/routes/commands.ts:2627`. |
| `src/lib/Setting/Pages/PersonaSettings.svelte:195` | import persona button | Imports persona. | Creates persona row. | `server/fastify/src/routes/commands.ts:2580`. |
| `src/lib/Setting/Pages/PersonaSettings.svelte:197` | delete selected persona button | Deletes selected persona. | Removes persona and updates selection. | `server/fastify/src/routes/commands.ts:2679`. |
| `src/lib/Setting/listedPersona.svelte:70` | persona picker row | Persona select button. | Updates selected persona or chat generation persona id depending on mode. | Persona select `server/fastify/src/routes/commands.ts:2758`; chat generation settings `:3665`. |

## Translator Presets

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:281` | preset `<select>` | Select translator preset. | Updates `translatorPresetId`. | `server/fastify/src/routes/commands.ts:3021`. |
| `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:307` | create translator preset button | Creates translator preset. | Adds preset row and may select it. | `server/fastify/src/routes/commands.ts:2867`. |
| `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:328` | rename button/input prompt | Renames selected translator preset. | Patches preset `name`. | `server/fastify/src/routes/commands.ts:2911`. |
| `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:358` | delete button | Deletes selected translator preset. | Removes preset and updates selection. | `server/fastify/src/routes/commands.ts:2959`. |
| `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:422` | import button | Imports translator preset. | Adds preset row. | `server/fastify/src/routes/commands.ts:2867`. |
| `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:458` | max response number field | Translator max response field. | Updates preset max response and mirrored setting. | `server/fastify/src/routes/commands.ts:2911`. |
| `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte:477` | translator prompt `TextAreaInput` | Prompt textarea. | Updates translator preset prompt and mirrored setting. | `server/fastify/src/routes/commands.ts:2911`. |

## Loadouts

| Source | Unique id | Control | Database change | Server handling |
| --- | --- | --- | --- | --- |
| `src/lib/Others/LoadoutModal.svelte:84` | loadout select row | Loadout row button. | Applies loadout and touches/recenters it. | Loadout touch `server/fastify/src/routes/commands.ts:3222`; applying may patch chat generation settings `:3665`. |
| `src/lib/Others/LoadoutModal.svelte:93` | favorite button | Favorite toggle. | Toggles loadout favorite. | `server/fastify/src/routes/commands.ts:3183`. |
| `src/lib/Others/LoadoutModal.svelte:102` | delete button | Delete loadout. | Removes loadout row. | `server/fastify/src/routes/commands.ts:3145`. |
| `src/lib/Others/LoadoutModal.svelte:201` | loadout name input | Save-name text field. | Provides name for save action. | Persists only when save button is used. |
| `src/lib/Others/LoadoutModal.svelte:206` | save button | Save current loadout. | Creates or updates a loadout. | Create `server/fastify/src/routes/commands.ts:3059`; update `:3099`. |

