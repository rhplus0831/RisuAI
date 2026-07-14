# Split Bot Preset Execution Plan

## Goal

Separate the legacy `botPreset` concept into two first-class concepts:

- `modelPreset`: provider, model, endpoint, request-shaping, sampling, context,
  response, reasoning, fallback, tool, and related model execution settings.
- `promptPreset`: prompt text, prompt template, jailbreak/global note, prompt
  preprocessing, prompt variables/toggles, prompt regex/scripts, and other
  prompt-behavior settings.

After the split, chat generation must use `modelPresetId` and `promptPresetId`.
The old `generationSettings.presetId` and legacy `botPresets` must not be used
by the generation path.

The Fastify variation has not shipped yet, so the implementation can use a
direct schema/data reset or conversion approach instead of preserving old chat
compatibility indefinitely.

## Product Decisions

1. Legacy `botPresets` are a migration inbox only.
   They may remain in the database so users can manually extract them, but no
   new chat or generation code should depend on them.

2. The legacy Chat Bot preset UI is shown only when legacy `botPresets` exist.
   Each legacy preset row must offer:
   - Extract everything: create/update a `modelPreset` and create a
     `promptPreset`, then remove the legacy item.
   - Extract model only: create/update only a `modelPreset`, then remove the
     legacy item.
   - Extract prompt only: create only a `promptPreset`, then remove the legacy
     item.

3. Model extraction should dedupe equivalent model presets.
   When many legacy presets share the same model/provider configuration, they
   should point users toward one shared `modelPreset` instead of producing
   duplicate model presets.

4. Preset import/export is prompt-oriented.
   Export should write prompt-related behavior only, with empty/custom-model
   compatibility fields if the file format still needs them. Import should
   extract only prompt-related fields into `promptPresets`.

5. New and existing chats must be forced onto the new shape.
   `Chat.generationSettings` should require `modelPresetId` and
   `promptPresetId`; missing values make the chat generation settings
   incomplete. Do not silently fall back to a legacy `presetId`.

## Data Model

Add these database fields:

```ts
interface Database {
  modelPresets: ModelPreset[]
  modelPresetId: number
  promptPresets: PromptPreset[]
  promptPresetId: number

  // Legacy migration inbox. Used by settings/import migration UI only.
  botPresets?: botPreset[]
  botPresetsId?: number
}

interface ChatGenerationSettings {
  configured?: boolean
  personaId?: string
  modelPresetId?: string
  promptPresetId?: string
  jailbreakToggle?: boolean
  sidebarToggles?: Record<string, string>
}
```

Use stable ids for `modelPresets` and `promptPresets`, matching the existing
command style used by personas, presets, modules, and loadouts.

## Field Split

### Model Preset Fields

Model presets should own fields that affect model selection, provider routing,
transport, request body shape, token budget, sampling, model tools, and fallback
behavior.

Initial field set:

- `apiType`
- `openAIKey` if still persisted per preset during migration
- `localNetworkMode`
- `localNetworkTimeoutSec`
- `temperature`
- `maxContext`
- `maxResponse`
- `frequencyPenalty`
- `PresensePenalty`
- `aiModel`
- `subModel`
- `currentPluginProvider`
- `textgenWebUIStreamURL`
- `textgenWebUIBlockingURL`
- `forceReplaceUrl`
- `koboldURL`
- `proxyKey`
- `ooba`
- `ainconfig`
- `proxyRequestModel`
- `openrouterRequestModel`
- `NAISettings`
- `localStopStrings`
- `customProxyRequestModel`
- `reverseProxyOobaArgs`
- `top_p`
- `repetition_penalty`
- `min_p`
- `top_a`
- `openrouterProvider`
- `useInstructPrompt`
- `top_k`
- `instructChatTemplate`
- `JinjaTemplate`
- `jsonSchemaEnabled`
- `jsonSchema`
- `strictJsonSchema`
- `extractJson`
- `seperateParametersEnabled`
- `seperateParameters`
- `customAPIFormat`
- `systemContentReplacement`
- `systemRoleReplacement`
- `customFlags`
- `enableCustomFlags`
- `reasonEffort`
- `thinkingTokens`
- `thinkingType`
- `deepseekThinkingType`
- `adaptiveThinkingEffort`
- `deepseekReasoningEffort`
- `outputImageModal`
- `seperateModelsForAxModels`
- `seperateModels`
- `modelTools`
- `fallbackModels`
- `fallbackWhenBlankResponse`
- `verbosity`
- `dynamicOutput`

### Prompt Preset Fields

Prompt presets should own fields that affect prompt composition, prompt content,
prompt-side toggles, and prompt-side scripts.

Initial field set:

- `mainPrompt`
- `jailbreak`
- `globalNote`
- `formatingOrder`
- `promptPreprocess`
- `bias`
- `autoSuggestPrompt`
- `autoSuggestPrefix`
- `autoSuggestClean`
- `promptTemplate`
- `NAIadventure`
- `NAIappendName`
- `promptSettings`
- `customPromptTemplateToggle`
- `templateDefaultVariables`
- `moduleIntergration`
- `regex` / `presetRegex`

If implementation finds a field with mixed semantics, prefer the placement that
matches runtime ownership:

- provider compatibility and request validity -> model preset
- semantic prompt assembly and user-visible prompt behavior -> prompt preset

Document any exceptions in this file before committing.

## Server Behavior

1. Add server command modules and routes for:
   - create/update/delete/select/reorder/import model presets
   - create/update/delete/select/reorder/import prompt presets
   - extract legacy bot preset as all/model/prompt

2. Update chat generation settings validation:
   - reject unknown fields, including legacy `presetId`
   - require known `modelPresetId`
   - require known `promptPresetId`
   - keep persona, jailbreak toggle, and sidebar toggle validation

3. Update `buildEffectiveGenerationConfig()`:
   - resolve selected `modelPreset` from `currentChat.generationSettings`
   - resolve selected `promptPreset` from `currentChat.generationSettings`
   - apply model preset fields first
   - apply prompt preset fields second
   - resolve prompt sidebar toggles from the prompt preset
   - record prompt/model ids in assembly metadata where relevant

4. Preserve provider secret masking behavior for model preset secrets.

5. Projection/bootstrap should expose lightweight preset stubs when practical
   and hydrate large prompt preset data lazily if needed. Existing bot preset
   lazy hydration can be used as the migration reference, but generation should
   not hydrate legacy bot presets.

## Frontend Behavior

1. Rename the visible modern settings concept away from broad "Chat Bot" where
   useful, but avoid a large UI redesign. The minimum acceptable UI is:
   - model preset management
   - prompt preset management
   - legacy bot preset migration panel shown only when legacy `botPresets`
     exist

2. Active chat generation controls must show separate model and prompt pickers.

3. Prompt template editing should edit the selected prompt preset.

4. Model/settings editing should edit the selected model preset.

5. Legacy bot preset extraction UI removes the legacy item after extraction. If
   all legacy items are removed, the legacy panel disappears.

6. Add frontend language keys under `src/lang` for new visible strings.

## Import/Export

1. `.risupreset` export should produce a prompt preset payload.
2. Export should not include real provider/model secrets.
3. Import should create a `promptPreset` only.
4. Legacy imported files that contain old bot-preset model fields should ignore
   model fields unless they are needed as empty compatibility placeholders.

## Testing

Minimum test coverage:

1. Unit tests for field extraction:
   - legacy -> model preset
   - legacy -> prompt preset
   - legacy -> both
   - model preset dedupe
   - legacy item removed after extraction

2. Server command tests:
   - model preset CRUD/select/reorder
   - prompt preset CRUD/select/reorder
   - chat generation settings rejects legacy `presetId`
   - generation settings require valid `modelPresetId` and `promptPresetId`

3. Prompt assembly tests:
   - different chats can share a model preset and use different prompt presets
   - different chats can share a prompt preset and use different model presets
   - missing model/prompt preset fails as incomplete generation settings
   - sidebar toggles come from the prompt preset

4. Import/export tests:
   - export contains prompt fields only
   - import creates prompt preset only

5. Frontend tests where existing harnesses make this practical:
   - active chat controls show separate model/prompt selections
   - legacy panel hidden when `botPresets` is empty
   - extraction removes a legacy item

## Suggested Implementation Order

1. Add shared model/prompt preset field lists and extraction helpers.
2. Add database defaults/normalization for `modelPresets` and `promptPresets`.
3. Update chat generation settings types and validation.
4. Update server effective generation config and assembly tests.
5. Add commands/routes/projection handling.
6. Update frontend storage commands and active chat generation controls.
7. Add legacy migration UI.
8. Update prompt-oriented import/export behavior.
9. Run formatting and checks:

```bash
pnpm exec prettier --write docs/split-bot-preset.md src server/fastify
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
pnpm test -- --run
```

If the full test suite is too slow, run the targeted tests for changed modules
and still run both TypeScript checks.
