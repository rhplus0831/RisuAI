# Model Config Profiles Status

Date: 2026-06-19

This workstream is open. Phase 0 is complete, the Phase 1 additive resolver
slice is complete, the Phase 2 preset composition slice is complete, the Phase
3a server-owned profile selection/capability/request-model slice is complete,
the Phase 3b Fastify OpenAI-compatible provider-options slice is complete, and
the Phase 3c Fastify Anthropic/Mistral/Cohere provider-options slice is
complete. The Phase 3d Fastify native Ollama provider-options slice is
complete. The Phase 3e Fastify Kobold provider-options slice is complete. The
Phase 3f Fastify Horde provider-options slice is complete. The
Phase 3g Fastify OobaLegacy provider-options slice is complete. The
Phase 3h Fastify Bedrock provider-options slice is complete. The
Phase 3i Fastify Gemini/Vertex provider-options slice is complete. The browser
request helper role/static/fallback resolver adoption slice is complete. The
browser-local Gemini/Vertex provider-options slice is complete. The
browser-local OpenAI-compatible chat-completions provider-options slice is
complete. The browser-local OpenAI Responses and legacy instruct
provider-options slice is complete. The browser-local Anthropic-family
provider-options slice is complete. The browser-local Mistral provider-options
slice is complete. The browser-local Kobold provider-options slice is complete.
The browser-local native Ollama provider-options slice is complete. The broader
Phase 3 generation dispatch phase remains in progress because other retained
browser-local provider helper branches still reconstruct provider options from
flat fields; see
[`latest-verification.md`](latest-verification.md).

## Snapshot

- Plan state: open.
- Current phase: Phase 3 generation dispatch in progress; Phase 3a complete;
  Phase 3b Fastify OpenAI-compatible provider-options slice complete; Phase 3c
  Fastify Anthropic/Mistral/Cohere provider-options slice complete; Phase 3d
  Fastify native Ollama provider-options slice complete; Phase 3e Fastify
  Kobold provider-options slice complete; Phase 3f Fastify Horde
  provider-options slice complete; Phase 3g Fastify OobaLegacy provider-options
  slice complete; Phase 3h Fastify Bedrock provider-options slice complete;
  Phase 3i Fastify Gemini/Vertex provider-options slice complete; browser
  request helper role/static/fallback resolver adoption slice complete;
  browser-local Gemini/Vertex provider-options slice complete; browser-local
  OpenAI-compatible chat-completions provider-options slice complete;
  browser-local OpenAI Responses and legacy instruct provider-options slice
  complete; browser-local Anthropic-family provider-options slice complete;
  browser-local Mistral provider-options slice complete; browser-local Kobold
  provider-options slice complete; browser-local native Ollama provider-options
  slice complete.
- Current implementation state: existing flattened `Database` fields remain the
  source of truth. `src/ts/model/modelProfileResolver.ts` now derives a
  read-only legacy profile object from the flat shape, and
  `src/ts/presetSplit.ts` now provides the shared effective preset composition
  helper used by browser server-prompt preflight and Fastify prompt assembly.
  Browser server-prompt preflight, Fastify server-intent completion selection,
  and Fastify chat dispatch provider routing/message flags/request model now
  use resolved profiles for the Phase 3a server-owned slice. Fastify chat
  dispatch now also uses `profile.providerOptions` for OpenAI-compatible
  provider branches `openai`, `openrouter`, and `nanogpt`, including
  `reverse_proxy`, `xcustom:::`, key-identifier models, and `ollama-cloud`
  routed through OpenAI-compatible chat. Fastify chat dispatch also uses
  `profile.providerOptions` for Anthropic, Mistral, and Cohere `apiKey`,
  `baseUrl`, and `additionalParams`, plus Mistral/Cohere `extraHeaders`, where
  those adapter fields already exist. Cohere safety-mode derivation now reads
  the resolved profile model id instead of flat `db.aiModel`. Fastify native
  Ollama dispatch now uses `profile.providerOptions.ollama.url` or
  `profile.providerOptions.baseUrl` plus the resolved profile request model
  instead of flat `db.ollamaURL`/`db.ollamaModel`. Fastify Kobold dispatch now
  uses `profile.providerOptions.baseUrl`, derived from `database.koboldURL`,
  instead of flat `db.koboldURL` at dispatch time. Fastify Horde dispatch now
  uses `profile.providerOptions.apiKey`, derived from
  `database.hordeConfig?.apiKey`, instead of flat `db.hordeConfig?.apiKey` at
  dispatch time; missing or blank profile keys keep the existing anonymous
  Horde key behavior. Fastify OobaLegacy dispatch now uses
  `profile.providerOptions.baseUrl`, derived from
  `database.textgenWebUIBlockingURL`, and `profile.providerOptions.apiKey`,
  derived from `database.mancerHeader`, instead of flat fields at dispatch time;
  missing profile URLs preserve the existing required-option error, and blank
  profile keys omit `X-API-KEY` instead of falling back to flat DB keys.
  Fastify Bedrock dispatch now uses `profile.providerOptions.apiKey`, derived
  from `database.claudeAPIKey`, and parses the legacy
  `accessKeyId:secretAccessKey:region` string on the profile-owned chat path
  instead of reading flat `db.claudeAPIKey` at dispatch time. Conflicting flat
  Bedrock keys cannot override the profile key, missing or blank profile keys do
  not fall back to flat DB keys, malformed profile keys fail before `fetch`, and
  profile-derived `us.`/`global.` request-model behavior remains covered.
  Fastify Gemini dispatch now uses `profile.providerOptions.apiKey`, derived
  from `database.google?.accessToken`, for Google AI Studio profiles, and
  `profile.providerOptions.vertex`, derived from `database.google?.projectId`,
  `database.vertexRegion`, `database.vertexClientEmail`, and
  `database.vertexPrivateKey`, for Vertex profiles. It intentionally does not
  use `database.vertexAccessToken` as a profile credential. Conflicting flat
  Google and Vertex fields cannot override the profile key/auth, missing or
  partial profile credentials do not fall back to flat DB credentials, and
  profile-derived Gemini request-model behavior, including `models/` stripping,
  remains covered. Browser `requestChatData()` now builds fallback attempts from
  `resolveModelProfile(...).fallbacks`, keeping legacy fallback model ids as
  `staticModel` attempts before the final primary `staticModel: ""` attempt and
  preserving the no-fallback-bucket behavior for `submodel`.
  `requestChatDataMain()` now resolves the selected profile once with
  `{ role, staticModel }`, uses the resolved `modelId` and `modelInfo`, and uses
  resolver runtime options for behavior-equivalent defaults such as max tokens,
  temperature, streaming, multigen, and JSON extraction. The reverse-proxy and
  `xcustom:::` local target shims now prefer profile provider options where
  equivalent while preserving legacy raw URL/key behavior, and the server-intent
  completion payload remains thin.
  `requestChatDataMain()` now also attaches the resolved profile to the retained
  browser request argument so local helpers can read profile provider options
  without changing the server-intent completion payload. Browser-local
  Gemini/Vertex dispatch now uses profile-owned Google AI Studio API keys,
  Vertex project/region/service-account credentials, and profile request models
  (including legacy `models/` prefix stripping) when a resolved profile is
  present. Conflicting flat Google keys, flat Vertex project/region/service
  account/private key fields, and cached flat `vertexAccessToken` cannot
  override a profile-backed Gemini/Vertex request; no-resolved-profile callers
  keep the legacy flat fallbacks.
  Browser-local `requestOpenAI()` chat-completions dispatch now uses
  `resolvedProfile.providerOptions` for profile-backed OpenAI-compatible calls,
  including OpenAI API keys, key-identifier API keys/base URLs, OpenRouter
  keys/request models/body knobs/provider filters, NanoGPT keys/request models/
  provider hints/subscription endpoints, reverse-proxy base URLs/API keys/
  `risu::` headers/Ooba system hoist/Ooba args/additional params,
  `xcustom:::` base URLs/API keys/internal ids/additional params, and
  `ollama-cloud` OpenAI-compatible base URL/API key/request model. Profile
  runtime `genTime` now drives `body.n` for profile-backed multigen
  `requestOpenAI()` calls. No-resolved-profile callers keep the legacy flat
  fallbacks, including the additional-parameter DSL.
  Browser-local `requestOpenAIResponseAPI()` now uses profile-owned request
  models, base URLs or exact endpoints, API keys, extra headers, and
  reverse-proxy/`xcustom:::` additional params when a resolved profile is
  present. Profile-backed Responses `ollama-cloud` calls use the Ollama Cloud
  base URL/API key/request model and keep the existing `store` deletion.
  No-resolved-profile Responses callers keep legacy URL/key fallbacks and the
  existing reverse-proxy autofill path while using the legacy additional
  parameter DSL fallback. Browser-local `requestOpenAILegacyInstruct()` now
  builds a previewable payload and uses profile-owned request models, base URLs
  or exact endpoints, API keys, extra headers, and profile additional params for
  reverse-proxy/`xcustom:::` callers. No-resolved-profile legacy instruct
  callers keep the hard-coded `gpt-3.5-turbo-instruct` model and
  `arg.customURL`/`arg.key`/`db.openAIKey` fallback behavior.
  Browser-local `requestClaude()` now uses profile-owned request models, base
  URLs or exact endpoints, API keys, extra headers, and profile additional
  params when a resolved profile is present. Profile-backed Anthropic-family
  calls cover reverse-proxy Anthropic, Bedrock Claude, and `ollama-cloud`
  Anthropic routing: reverse-proxy `risu::` identification survives through
  resolver-provided extra headers, Bedrock uses the resolver-prefixed
  `us.`/`global.` request model directly without adding another prefix, and
  `ollama-cloud` uses the Ollama Cloud base URL/API key/request model.
  No-resolved-profile Anthropic callers keep legacy `arg.customURL`/`arg.key`,
  flat DB key, reverse-proxy autofill, and additional-parameter fallbacks.
  Browser-local `requestOpenAI()` Mistral dispatch now uses profile-owned
  request models, profile chat-completions URL resolution, API keys, extra
  headers, and profile additional params when a resolved profile is present.
  Reverse-proxy Mistral keeps resolver-provided `X-Proxy-Risu`, and
  `xcustom:::` Mistral keeps profile custom-model URL/key/internal-id/params.
  No-resolved-profile Mistral callers keep the legacy `arg.customURL` default,
  `arg.key ?? db.mistralKey`, body model `aiModel`, and no additional-parameter
  fallback.
  Browser-local `requestKobold()` now uses
  `resolvedProfile.providerOptions.baseUrl` for profile-backed Kobold URLs and
  `resolvedProfile.runtimeOptions.maxContext` for `max_context_length`.
  Conflicting flat `db.koboldURL` and `db.maxContext` values cannot override a
  profile-backed Kobold preview/request; callers without a resolved profile keep
  the legacy flat `db.koboldURL` fallback. Missing or blank profile Kobold URLs
  fail with `options.kobold.baseUrl is required` before fetch instead of falling
  back to flat DB fields.
  Browser-local `requestOllama()` now uses profile-owned
  `providerOptions.ollama` and common provider options for native local and cloud
  Ollama preview/request paths: request format, request model, local base URL,
  cloud API key, model source, and thinking mode. Conflicting flat
  `db.ollamaURL`, `db.ollamaModel`, `db.ollamaCloudModel`, `db.ollamaApiKey`,
  `db.ollamaModelSource`, `db.ollamaThinkingMode`, and
  `db.ollamaRequestFormat` values cannot override profile-backed native Ollama
  dispatch; callers without a resolved profile keep the legacy flat fallbacks.
  Missing or blank profile local Ollama URLs fail with
  `options.ollama.baseUrl is required` before SDK/fetch instead of falling back
  to flat DB fields. `ollama-cloud` OpenAI-compatible, Responses, and Anthropic
  delegate semantics remain unchanged and receive profile-derived URL/key/model
  values where applicable.
  Outside those dispatch slices, remaining provider credentials, base URLs,
  additional params, durable storage, and UI writes remain on the existing flat
  fields.
- Current compatibility state: no profile data model exists yet.
- Current verification state: browser request helper role/static/fallback
  resolver adoption tests pass, browser-local Gemini/Vertex provider-options
  tests pass, browser-local OpenAI-compatible chat-completions provider-options
  tests pass, browser-local OpenAI Responses and legacy instruct
  provider-options tests pass, browser-local Anthropic-family provider-options
  tests pass, browser-local Mistral provider-options tests pass, browser-local
  Kobold provider-options tests pass, browser-local native Ollama
  provider-options tests pass, server-intent completion payload tests pass, the
  requested focused provider tests pass, client-lib TypeScript passes, full
  server strict TypeScript passes, and `git diff --check` passes. See
  [`latest-verification.md`](latest-verification.md).

## Phase Router

| Phase                                | Status      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0: Current Contracts           | Complete    | Freeze current role, provider, preset, fallback, masking, static model, and memory behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Phase 1: Read-Only Profile Resolver  | Complete    | Add a shared resolver and compatibility adapter while storage stays flat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Phase 2: Preset Composition          | Complete    | Centralize base DB, selected model preset, and selected prompt preset composition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Phase 3: Generation Dispatch         | In progress | Adopt resolved profiles in browser and Fastify generation paths. Phase 3a server-owned selection/capability/request-model, Phase 3b Fastify OpenAI-compatible provider-options, Phase 3c Fastify Anthropic/Mistral/Cohere provider-options, Phase 3d Fastify native Ollama provider-options, Phase 3e Fastify Kobold provider-options, Phase 3f Fastify Horde provider-options, Phase 3g Fastify OobaLegacy provider-options, Phase 3h Fastify Bedrock provider-options, Phase 3i Fastify Gemini/Vertex provider-options, browser request helper role/static/fallback resolver adoption, browser-local Gemini/Vertex provider-options, browser-local OpenAI-compatible chat-completions provider-options, browser-local OpenAI Responses/legacy instruct provider-options, browser-local Anthropic-family provider-options, browser-local Mistral provider-options, browser-local Kobold provider-options, and browser-local native Ollama provider-options slices complete. |
| Phase 4: UI & Command Adapter        | Not started | Adapt role/profile UI and settings commands while writes target existing fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Phase 5: Custom, Secrets & Auxiliary | Not started | Harden custom models, masking, memory, translation, scripts, MCP, playground, fallbacks, and tools.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Phase 6: Persisted Profiles          | Not started | Add durable profile records and role bindings after derived parity is proven.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Phase 7: Verification & Cleanup      | Not started | Run final regression, browser smoke, docs updates, compatibility cleanup, and TypeScript proof.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Immediate Next Steps

1. Continue Phase 3 by broadening resolver-derived provider option use in the
   retained browser-local request helpers without reshaping provider secrets or
   storage. Fastify chat provider-option slices are complete through
   Gemini/Vertex for the adapter fields exposed today; browser role/static/
   fallback selection now uses the resolver; and browser-local Gemini/Vertex
   OpenAI-compatible chat-completions, OpenAI Responses, legacy instruct,
   Anthropic-family, Mistral, Kobold, and native Ollama requests now use profile
   provider options.
2. Keep UI writes targeting existing fields until the profile editor behavior
   is proven.
3. Update `status.md` at the end of each phase with proof or explicit gaps.

## Phase 0 Contract Decisions

- `staticModel` remains a raw model-id bypass. It skips role resolution and
  does not require a stored profile.
- Legacy fallback entries remain raw model ids. The request fallback path passes
  each fallback id as `staticModel`; fallback static models borrow the current
  global/provider settings. The legacy `submodel` mode has no fallback key.
- Preset composition remains deterministic: base database -> selected model
  preset -> selected prompt preset. Prompt preset "Others" overrides, including
  `modelRoles`, `seperateModels`, and `fallbackModels`, apply over model
  presets; prompt parameter overrides apply only when
  `overrideModelParameters === true`.
- `doNotChangeSeperateModels` and `doNotChangeFallbackModels` remain legacy
  bot-preset application guards, not general split-preset or profile flags.
- `customModels` remains a model catalog for now. Future derived profiles may
  reference catalog rows by id, but durable migration is deferred.
- Memory summary can later join the chat resolver because it already follows
  memory-role resolution and OpenAI-compatible provider options. Memory
  embeddings stay separate for now on Hypa/Voyage/custom embedding fields.

## Known Open Decisions

- Whether durable profiles eventually store provider secrets inline, in a nested
  credentials block, or by reference to provider-account records.
- Whether `customModels` should stay a model catalog consumed by profiles or
  move into provider-specific profile records.
- Which legacy fields become profile-local first when Phase 6 introduces
  persisted records, especially OpenAI-compatible, OpenRouter, NanoGPT, Ollama,
  and Custom API options.
- Whether prompt preset model overrides should bind roles to alternate profiles,
  patch selected profile fields, or remain as explicit legacy overrides during
  compatibility.
- Whether memory embeddings eventually join any profile model after the chat
  resolver is proven, since they currently use `hypaModel`,
  `hypaCustomSettings`, `hypaV3Key`, and `voyageApiKey`.
