# Phase 0: Current Contracts

Status: complete.

Goal: freeze the current behavior before extraction, so later phases can prove
that model-profile resolution has not changed legacy semantics by accident.

## Scope

- Build an inventory table mapping current flat fields to target groups:
  selected model, role binding, provider options, runtime options, fallback
  options, preset-only fields, secret fields, custom-model catalog fields, and
  non-profile globals.
- Capture the current behavior of `aiModel`, `subModel`, `modelRoles`,
  `seperateModelsForAxModels`, `seperateModels`, `staticModel`, `scriptAux`,
  fallback models, custom flags, separate parameters, and model tools.
- Capture provider-specific behavior for `reverse_proxy`, `xcustom:::`,
  OpenAI-compatible key identifiers, OpenRouter, NanoGPT, Ollama local/cloud,
  Gemini/Vertex, Anthropic, Mistral, Cohere, Bedrock, Horde, Kobold, and Ooba
  legacy paths.
- Record current preset precedence: base database, selected model preset,
  selected prompt preset, prompt "Others" overrides, and legacy flags such as
  `doNotChangeSeperateModels` and `doNotChangeFallbackModels`.
- Record current secret masking paths and masked-placeholder write behavior.
- Record memory summary and memory embedding differences before deciding what
  joins the chat-model resolver.

## Field Inventory

| Target group | Current fields | Phase 0 contract |
| --- | --- | --- |
| Selected chat models | `aiModel`, `subModel` | `chatMain` resolves from `aiModel`; `chatAux`/legacy `submodel` resolves from `subModel`. `modelRoles.chatMain` and `modelRoles.chatAux` are normalized but ignored for current resolution. |
| Role binding overrides | `modelRoles.chatMain`, `chatAux`, `memory`, `emotion`, `translate`, `otherAx`, `scriptMain`, `scriptAux` | Non-blank overrides win for non-chat roles only. Blank values inherit from legacy fields. |
| Legacy separate role models | `seperateModelsForAxModels`, `seperateModels.memory`, `emotion`, `translate`, `otherAx`, `scriptMain`, `scriptAux` | When enabled, auxiliary roles use their separate model. `scriptMain` falls back to `aiModel`; `scriptAux` falls back through `seperateModels.scriptAux` -> `seperateModels.otherAx` -> `subModel`. When disabled, auxiliary roles inherit `subModel` and `scriptMain` inherits `aiModel`. |
| Static model bypass | Request `staticModel` | A non-empty `staticModel` is a raw model id. It bypasses role resolution and `modelRoles` without creating or selecting a profile. |
| Fallback models | `fallbackModels.model`, `memory`, `emotion`, `translate`, `otherAx`, `scriptMain`, `scriptAux`, plus `fallbackWhenBlankResponse` | Fallback entries are legacy raw model ids. The request fallback path passes each fallback id as `staticModel`; `submodel` has no fallback key. Fallback static models borrow the current/global provider settings instead of carrying their own provider configuration. |
| Provider/runtime options | `apiType`, `openAIKey`, `proxyKey`, `forceReplaceUrl`, `customProxyRequestModel`, `customAPIFormat`, `additionalParams`, `reverseProxyOobaArgs`, `reverseProxyOobaMode`, `openrouterKey`, `openrouterRequestModel`, `openrouterProvider`, `nanogptKey`, `nanogptRequestModel`, `nanogptProvider`, `nanogptUseSubscriptionEndpoint`, `ollamaApiKey`, `ollamaCloudModel`, OpenAI-compatible key maps, Claude/Gemini/Mistral/Cohere/Bedrock/Horde/Kobold/Ooba fields | Current dispatch reconstructs provider options from flat database fields after the model id is known. Phase 1 should derive profiles from this flat shape; it must not persist provider settings into profiles yet. |
| Generation parameters | `temperature`, `maxContext`, `maxResponse`, `frequencyPenalty`, `PresensePenalty`, `top_p`, `top_k`, `min_p`, `top_a`, `repetition_penalty`, thinking/reasoning fields, `seperateParametersEnabled`, `seperateParameters`, `modelTools`, `verbosity`, `dynamicOutput`, custom flags and JSON/schema fields | Parameters remain flat settings. Separate-parameter buckets are still applied by legacy mode/role and optional model-id overrides. |
| Split presets | `modelPresets`, `modelPresetsId`, `promptPresets`, `promptPresetsId` | Effective settings compose as base database -> selected model preset -> selected prompt preset. Selecting/applying a model preset reapplies the currently selected prompt preset afterward. Prompt preset "Others" model override fields always win; prompt model-parameter override fields win only when `overrideModelParameters === true`. |
| Legacy bot presets | `botPresets`, `botPresetsId`, `doNotChangeSeperateModels`, `doNotChangeFallbackModels`, `disableSeperateParameterChangeOnPresetChange` | Legacy `setPreset` honors the `doNotChangeSeperateModels` and `doNotChangeFallbackModels` guards. These are preset-application guards, not profile semantics. |
| Secret fields | Top-level provider keys, `botPresets[*].openAIKey`, `botPresets[*].proxyKey`, `modelPresets[*].openAIKey`, `modelPresets[*].proxyKey`, `customModels[*].key`, TTS/memory/media/provider key paths | Secret masking uses stable row identity for arrays. `modelPresets` and `customModels` resolve masked placeholders by `id`; rows without stable identity are rejected when placeholders need resolution. |
| Custom model catalog | `customModels[*].id`, `internalId`, `url`, `key`, `format`, `params`, `flags`, `tokenizer` | `customModels` is still a catalog keyed by model id such as `xcustom:::`. Profiles may later depend on catalog rows, but Phase 0/1 should not migrate the catalog. |
| Memory summary | `modelRoles.memory`, `seperateModels.memory`, `subModel`, OpenAI-compatible provider fields, `customModels` | Server memory summary already resolves the memory role and can use chat-like OpenAI-compatible options for `reverse_proxy`, `xcustom:::`, OpenRouter, NanoGPT, and related flat settings. It can later join the chat resolver. |
| Memory embeddings | `hypaModel`, `hypaCustomSettings`, `hypaV3Key`, `hypaMemoryKey`, `voyageApiKey`, Hypa V3 settings/presets | Embeddings stay separate for now. Phase 0 does not move embedding provider selection into the chat/profile resolver. |
| Non-profile globals | Characters/chats/lore, display/theme, language/translation defaults, assets/media settings, plugin state, account/auth, sidebar/UI settings | These remain outside model profiles unless a later phase explicitly scopes them. |

## Current Contract Decisions

| Decision | Phase 0 result |
| --- | --- |
| Resolver input | Phase 1 should introduce a read-only resolver over the existing composed database/settings shape plus explicit role/static-model context. It should not require persisted profile records. |
| Static model behavior | Keep `staticModel` as a raw model-id bypass. It maps to a derived legacy profile only conceptually; no explicit profile is required. |
| Fallback shape | Keep fallback entries as legacy model ids. Runtime resolution passes fallback ids as `staticModel`, and those models borrow the current/global provider options. `submodel` has no fallback key. |
| Custom model relation | Keep `customModels` as a catalog in Phase 0/1. A derived profile may reference a custom-model row by id, but the catalog is not migrated before durable profiles. |
| Preset precedence | Preserve base -> selected model preset -> selected prompt preset. Prompt "Others" override fields, including `modelRoles`, `seperateModels`, and `fallbackModels`, always apply over the selected model preset; prompt parameter fields apply only when `overrideModelParameters` is true. |
| Legacy preset guards | `doNotChangeSeperateModels` and `doNotChangeFallbackModels` remain legacy bot-preset guards. They are not general split-preset or profile flags. |
| Memory boundary | Memory summary can later join the chat resolver because it already follows memory-role model resolution and OpenAI-compatible provider options. Memory embeddings stay on separate Hypa/Voyage/custom embedding settings for now. |

## Anchors

- `src/ts/storage/database.svelte.ts`
- `src/ts/model/modelRoles.ts`
- `src/ts/model/modelRoles.test.ts`
- `src/ts/process/request/tests/modelRoleRouting.test.ts`
- `src/ts/process/request/providerCapability.ts`
- `server/fastify/src/routes/generation.ts`
- `server/fastify/src/prompt/chatDispatch.ts`
- `server/fastify/src/providerSecrets.ts`
- `server/fastify/src/memorySummaryModel.ts`
- `server/fastify/src/memoryEmbeddingModel.ts`
- `src/ts/presetSplit.ts`
- `server/fastify/src/commands/splitPresets.ts`

## Contract Decisions To Record

| Decision | Options | Required output |
| --- | --- | --- |
| Resolver input | Full database, already-composed generation settings, or explicit role context | Chosen function signatures for Phase 1 |
| Static model behavior | Keep as model-id bypass, map to derived legacy profile, or require explicit profile | Compatibility rule and fixtures |
| Fallback shape | Legacy model ids now, profile ids later, or mixed compatibility list | Runtime resolution precedence |
| Custom model relation | Keep `customModels` catalog, derive profile dependency, or migrate in Phase 6 | Migration and UI rule |
| Preset precedence | Existing precedence, profile precedence, or explicit version marker | Deterministic apply order |
| Memory boundary | Chat resolver for summary only, both summary and embedding, or separate resolver types | Exact Phase 5 target |

## First Regression Fixtures

| Pattern | Fixture choice | Likely owner |
| --- | --- | --- |
| Legacy role parity | `resolveModelForRole` and the future resolver agree for `aiModel`, `subModel`, optional roles, `scriptAux`, and `seperateModels`. | `src/ts/model/modelRoles.test.ts` |
| Custom API parity | Legacy `reverse_proxy` resolves to the same provider, URL, key, request model, format, flags, and params. | `src/ts/process/request/tests/providerCapability.test.ts`, server generation tests |
| Custom model parity | Existing `xcustom:::` rows keep URL/key/format/tokenizer/params/flags behavior. | model registry and dispatch tests |
| Provider-specific parity | OpenAI, OpenRouter, NanoGPT, Ollama, Anthropic, Gemini/Vertex, Mistral, Cohere, Bedrock, Horde, Kobold, and Ooba legacy resolve as before. | provider capability and server dispatch tests |
| Preset compatibility | Applying legacy model/prompt presets produces the same effective generation settings. | split preset and server prompt assembly tests |
| Secret masking | Masked placeholders are preserved or resolved exactly as today. | `providerSecrets` and commands tests |

## Exit Criteria

- Field inventory is recorded above.
- Current behavior fixtures exist for fallback/static model routing, split
  preset precedence, masking for split/custom rows, and memory summary
  OpenAI-compatible options.
- Resolver, fallback, preset, custom model, and memory boundary decisions are
  recorded here and in `status.md`.
- Phase 1 can start without choosing durable profile storage yet.

## Validation

```bash
pnpm exec vitest run src/ts/model/modelRoles.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/providerSecrets.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

For documentation-only changes inside Phase 0, also run:

```bash
pnpm exec prettier --check 'docs/plan/model-config-profiles/**/*.md'
```

## Risks

- If Phase 0 skips fixtures, later resolver changes can silently change
  provider options even when model ids still match.
- Preset precedence must be explicit before implementation. Otherwise legacy
  model presets can overwrite role/profile bindings during later phases.
