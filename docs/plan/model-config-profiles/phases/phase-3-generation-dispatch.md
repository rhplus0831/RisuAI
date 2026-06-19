# Phase 3: Generation Dispatch

Status: in progress; Phase 3a server-owned profile selection/capability/request-model slice complete; Phase 3b Fastify OpenAI-compatible provider-options slice complete; Phase 3c Fastify Anthropic/Mistral/Cohere provider-options slice complete; Phase 3d Fastify native Ollama provider-options slice complete; Phase 3e Fastify Kobold provider-options slice complete; Phase 3f Fastify Horde provider-options slice complete; Phase 3g Fastify OobaLegacy provider-options slice complete; Phase 3h Fastify Bedrock provider-options slice complete; Phase 3i Fastify Gemini/Vertex provider-options slice complete; browser request helper role/static/fallback resolver adoption slice complete; browser-local Gemini/Vertex provider-options slice complete; browser-local OpenAI-compatible chat-completions provider-options slice complete; browser-local OpenAI Responses and legacy instruct provider-options slice complete; browser-local Anthropic-family provider-options slice complete; browser-local Mistral provider-options slice complete.

Goal: move browser and Fastify generation dispatch from ad hoc flat database
reads to the resolved profile runtime object.

## Scope

- Update browser `requestChatData` / `requestChatDataMain` to resolve a runtime
  object from the Phase 2 effective settings for the requested role or static
  fallback.
- Update server prompt preflight and server-intent completion to resolve the
  selected runtime object instead of rewriting or reinterpreting `db.aiModel`.
- Update Fastify chat dispatch to accept a resolved runtime object or resolve
  through the shared resolver internally.
- Remove provider option reconstruction from ad hoc `db.aiModel` branches where
  the resolver now owns that logic.
- Preserve server-intent rejection of provider/model/options/secrets supplied
  directly by the client.
- Keep old flat-field compatibility through the Phase 1 adapter.

## Implemented Phase 3a Slice

- Browser server-prompt preflight now resolves a profile from the Phase 2
  effective model-runtime database. Provider capability and image-input checks
  read the resolved profile instead of a hand-built completion target.
- Fastify chat dispatch now accepts or derives a resolved profile and uses it
  for provider routing, message reformat flags, and the provider request model.
- Fastify server-intent completion now resolves the selected profile from the
  unmasked server settings using `mode` plus optional `staticModel`, then passes
  that profile to chat dispatch while preserving rejection of client-supplied
  `provider`, `model`, and `options`.
- The server-only unknown OpenAI-compatible id guard is also present on
  `resolveServerSafeModelInfo`/resolved profiles, so arbitrary ids do not become
  routable through the profile path.
- Flat provider option branches remain intentionally in place. API keys, base
  URLs, additional params, and provider-specific credentials still come from the
  existing flat database fields in this slice.

## Implemented Phase 3b Slice

- Fastify chat dispatch now resolves OpenAI-compatible request variants from
  `profile.providerOptions` for provider branches `openai`, `openrouter`, and
  `nanogpt`.
- The profile-owned fields used by those branches are `apiKey`, `baseUrl`,
  `extraHeaders`, `additionalParams`, and reverse-proxy `oobaSystemHoist`.
- Covered OpenAI-wire variants include `reverse_proxy`, `xcustom:::`, OpenRouter,
  NanoGPT, key-identifier models such as DeepSeek, and `ollama-cloud` when its
  request format routes to OpenAI-compatible chat.
- The old flat OpenAI-compatible option reader remains only as a legacy helper
  fallback for callers that do not provide or derive a resolved profile.
- Focused direct dispatch coverage now creates profiles from one settings shape
  and dispatches with intentionally conflicting flat database values, proving the
  profile wins for base URL, API key, headers, additional params, reverse-proxy
  system hoist, and request model.
- OpenRouter body knobs (`fallback`, `middleOut`, and provider filters) are not
  wired in this slice because the existing Fastify OpenAI chat adapter does not
  support those body options.

## Implemented Phase 3c Slice

- Fastify chat dispatch now resolves Anthropic, Mistral, and Cohere request
  options from `profile.providerOptions` where the target adapters already
  expose equivalent fields.
- The profile-owned fields used by those branches are `apiKey`, `baseUrl`, and
  `additionalParams`; Mistral and Cohere also use profile-owned `extraHeaders`.
- Covered direct-dispatch variants include Anthropic `xcustom:::`, Mistral
  `reverse_proxy`, and Cohere `reverse_proxy`, including conflicting flat DB
  fields, request-model selection, extra headers where supported, and
  additional params.
- Cohere `safetyMode` derivation now uses the resolved profile model id instead
  of flat `db.aiModel`, so a conflicting flat DB cannot alter the safety-mode
  omission for `cohere-command-r-03-2024` and
  `cohere-command-r-plus-04-2024`.
- Missing-key dispatch coverage proves profile-owned empty credentials do not
  fall back to conflicting flat Anthropic, Mistral, or Cohere keys.

## Implemented Phase 3d Slice

- Fastify chat dispatch now resolves native Ollama `baseUrl` from
  `profile.providerOptions.ollama.url` or `profile.providerOptions.baseUrl`
  instead of flat `db.ollamaURL`.
- Native Ollama dispatch keeps using the already profile-derived request model,
  so conflicting flat `db.ollamaModel` values cannot alter the wire `model`.
- Missing-URL dispatch coverage proves profile-owned empty URLs do not fall back
  to conflicting flat `db.ollamaURL` and preserve the
  `options.ollama.baseUrl is required` error.
- `ollama-cloud` routing is unchanged and remains on the existing
  OpenAI-compatible chat, Responses, or Anthropic branches according to
  `ollamaRequestFormat`.

## Implemented Phase 3e Slice

- `resolveModelProfile()` now exposes Kobold endpoints as
  `profile.providerOptions.baseUrl`, derived from `database.koboldURL`, for
  Kobold-format profiles.
- Fastify Kobold chat dispatch now passes `profile.providerOptions.baseUrl` to
  `resolveKoboldRequest()` instead of reading flat `db.koboldURL` at dispatch
  time.
- Direct dispatch coverage proves a profile-owned Kobold URL wins over a
  conflicting flat `db.koboldURL`, and a missing profile URL does not fall back
  to flat `db.koboldURL`.
- The missing-URL path preserves the existing `options.kobold.baseUrl is required`
  error and does not call `fetch`.

## Implemented Phase 3f Slice

- `resolveModelProfile()` now exposes Horde API keys as
  `profile.providerOptions.apiKey`, derived from
  `database.hordeConfig?.apiKey`, for Horde-format profiles.
- Fastify Horde chat dispatch now passes `profile.providerOptions.apiKey` to
  `resolveHordeRequest()` instead of reading flat `db.hordeConfig?.apiKey` at
  dispatch time.
- Direct dispatch coverage proves a profile-owned Horde key wins over a
  conflicting flat `db.hordeConfig.apiKey`, and that the Stable Horde request
  model still comes from the profile-derived `horde:::`-stripped request model.
- Missing/blank profile-key coverage proves Horde dispatch does not fall back to
  a conflicting flat key and preserves the existing anonymous `0000000000` key
  behavior.

## Implemented Phase 3g Slice

- `resolveModelProfile()` now exposes OobaLegacy endpoints as
  `profile.providerOptions.baseUrl`, derived from
  `database.textgenWebUIBlockingURL`, and OobaLegacy/Mancer API keys as
  `profile.providerOptions.apiKey`, derived from `database.mancerHeader`.
- Fastify OobaLegacy chat dispatch now passes those resolved profile options to
  `resolveOobaLegacyRequest()` instead of reading flat DB URL/key fields at
  dispatch time.
- Direct dispatch coverage proves a profile-owned OobaLegacy URL/key wins over
  conflicting flat DB values, including URL normalization to `/api/v1/generate`
  and forwarding `X-API-KEY` from the profile key.
- Missing profile URL coverage preserves the existing
  `options["ooba-legacy"].baseUrl is required` error and does not call `fetch`.
- Blank profile-key coverage proves OobaLegacy dispatch does not fall back to a
  conflicting flat DB key and omits `X-API-KEY`.

## Implemented Phase 3h Slice

- `resolveModelProfile()` now exposes Bedrock legacy credential strings as
  `profile.providerOptions.apiKey`, derived from `database.claudeAPIKey`, for
  AWS Bedrock Claude profiles.
- Fastify Bedrock chat dispatch now parses only
  `profile.providerOptions.apiKey` as the legacy
  `accessKeyId:secretAccessKey:region` string instead of reading flat
  `db.claudeAPIKey` at dispatch time.
- Direct dispatch coverage proves profile-owned Bedrock credentials win over a
  conflicting flat `db.claudeAPIKey`, including the signed URL/Auth region and
  the profile-derived request model.
- Missing or blank profile-key coverage proves Bedrock dispatch does not fall
  back to a conflicting flat DB key and does not call `fetch`.
- Malformed profile-key coverage proves chat dispatch errors before `fetch`.
- Focused coverage keeps Bedrock system extraction and profile-derived
  `us.`/`global.` request-model behavior pinned.

## Implemented Phase 3i Slice

- `resolveModelProfile()` now exposes Google AI Studio API keys as
  `profile.providerOptions.apiKey`, derived from
  `database.google?.accessToken`, for Google Cloud Gemini profiles.
- `resolveModelProfile()` now exposes Vertex service-account auth as
  `profile.providerOptions.vertex`, derived from `database.google?.projectId`,
  `database.vertexRegion`, `database.vertexClientEmail`, and
  `database.vertexPrivateKey`, for Vertex Gemini profiles.
- Vertex profile credentials intentionally do not use
  `database.vertexAccessToken`, which remains cached/projection state rather
  than a source credential.
- Fastify Gemini chat dispatch now passes Google API keys and Vertex auth to
  `resolveGeminiRequest()` only from `profile.providerOptions` instead of flat
  `db.google` / `db.vertex*` fields.
- Direct dispatch coverage proves profile-owned Google keys and Vertex
  project/region/service-account auth win over conflicting flat DB fields, that
  missing or partial profile credentials do not fall back to flat credentials or
  call `fetch`, and that profile-derived Gemini request-model behavior,
  including `models/` stripping, remains pinned.

## Implemented Browser Request Helper Role/Static/Fallback Slice

- Browser `requestChatData()` now derives fallback attempts from
  `resolveModelProfile({ database, role }).fallbacks` instead of reconstructing
  fallback buckets directly from `db.fallbackModels`.
- Legacy fallback model ids are still sent to each attempt as `staticModel`
  values, configured fallback ids are attempted before the final primary
  `staticModel: ""` attempt, and `submodel` still has no fallback bucket.
- Browser `requestChatDataMain()` now resolves once with
  `resolveModelProfile({ database, role, staticModel })`, then populates
  `targ.aiModel` and `targ.modelInfo` from the resolved profile.
- Behavior-equivalent defaults for max tokens, temperature, streaming, multigen,
  and JSON extraction now read from profile runtime options with the legacy flat
  fields as fallback.
- The `reverse_proxy` and `xcustom:::` local target shims now prefer
  `profile.providerOptions` for equivalent key/custom-model data and keep the
  legacy raw URL/key fallbacks needed by retained browser-local provider
  helpers.
- `requestServerCompletion()` payload shape is unchanged: server intent still
  sends only `kind`, `messages`, `stream`, `mode`, `staticModel`, `maxTokens`,
  `temperature`, and `currentCharName`.

## Implemented Browser-Local Gemini/Vertex Provider-Options Slice

- `RequestDataArgumentExtended` now carries the resolved profile computed in
  `requestChatDataMain()`, allowing retained local helpers to read
  `profile.providerOptions` without changing the server-intent completion
  payload.
- Browser-local Google AI Studio dispatch now uses
  `profile.providerOptions.apiKey` and `profile.providerOptions.requestModel`
  when a resolved profile is present. This preserves resolver-owned `models/`
  prefix stripping and prevents conflicting flat `db.google.accessToken` or
  `arg.modelInfo.internalID` values from changing profile-backed URLs.
- Browser-local Vertex dispatch now uses
  `profile.providerOptions.vertex.projectId`, `region`, `clientEmail`, and
  `privateKey`, plus `profile.providerOptions.requestModel`, when a resolved
  profile is present. Conflicting flat `db.google.projectId`,
  `db.vertexRegion`, `db.vertexClientEmail`, `db.vertexPrivateKey`, and cached
  `db.vertexAccessToken` values cannot override the profile path.
- No-resolved-profile Gemini/Vertex callers keep the legacy flat field
  fallbacks, including cached `vertexAccessToken` behavior.

## Implemented Browser-Local OpenAI-Compatible Chat-Completions Provider-Options Slice

- Browser-local `requestOpenAI()` now uses
  `resolvedProfile.providerOptions.requestModel` for profile-backed
  chat-completions request body `model`, including reverse-proxy, `xcustom:::`,
  OpenRouter, NanoGPT, key-identifier, and `ollama-cloud` OpenAI-compatible
  calls. No-resolved-profile callers keep the legacy flat request-model
  fallbacks.
- Profile-backed URL, API key, and extra-header options now win over conflicting
  flat DB fields for OpenAI, OpenRouter, NanoGPT, reverse-proxy, `xcustom:::`,
  key-identifier models, and `ollama-cloud` routed through OpenAI-compatible
  chat. Reverse-proxy `risu::` identification and URL autofill remain preserved
  through resolver-normalized base URLs and profile extra headers.
- Profile OpenRouter options now drive browser-local `route`, `transforms`, and
  provider filters. Profile NanoGPT options now drive the provider hint header
  and subscription endpoint. Profile reverse-proxy options now drive Ooba system
  hoist and Ooba body args.
- Profile `providerOptions.additionalParams` now drives browser-local
  reverse-proxy and `xcustom:::` additional-parameter application when a
  resolved profile is present. `getAdditionalParameters(aiModel)` remains the
  no-profile legacy fallback, so the existing additional-parameter DSL semantics
  are unchanged.
- Profile runtime `genTime` now drives `body.n` for profile-backed multigen
  `requestOpenAI()` calls, with flat `db.genTime` retained for no-profile
  callers.

## Implemented Browser-Local OpenAI Responses And Legacy Instruct Provider-Options Slice

- Browser-local `requestOpenAIResponseAPI()` now uses
  `resolvedProfile.providerOptions.requestModel` for profile-backed Responses
  request body `model`, including reverse-proxy, `xcustom:::`, NanoGPT
  Responses, key-identifier, and `ollama-cloud` Responses calls.
  No-resolved-profile callers keep the legacy model-info internal id, then
  `aiModel`, request-model fallback.
- Profile-backed Responses URL, API key, and extra-header options now win over
  conflicting flat DB fields. Profile `baseUrl` values receive a `/responses`
  suffix without double-appending; profile `endpoint` values are preserved as
  exact URLs. Reverse-proxy `risu::` identification remains represented through
  resolver-provided extra headers, while no-resolved-profile reverse-proxy
  callers keep the existing URL autofill behavior.
- Profile `providerOptions.additionalParams` now drives browser-local
  Responses reverse-proxy and `xcustom:::` additional-parameter application
  when a resolved profile is present. `getAdditionalParameters(aiModel)` remains
  the no-profile Responses fallback. `ollama-cloud` Responses calls continue to
  delete `store` from the body.
- Browser-local `requestOpenAILegacyInstruct()` now builds preview payloads
  after composing the prompt and uses profile-owned request models, base URLs or
  exact endpoints, API keys, extra headers, and profile additional params for
  reverse-proxy/`xcustom:::` callers. No-resolved-profile legacy instruct
  callers keep the hard-coded `gpt-3.5-turbo-instruct` model and the existing
  `arg.customURL`/`arg.key`/`db.openAIKey` fallback behavior.
- Focused coverage proves profile-generated reverse-proxy Responses,
  `ollama-cloud` Responses, and NanoGPTLegacy instruct settings beat
  intentionally conflicting flat DB values, and pins the no-resolved-profile
  legacy instruct fallback.

## Implemented Browser-Local Anthropic-Family Provider-Options Slice

- Browser-local `requestClaude()` now uses
  `resolvedProfile.providerOptions.requestModel` for profile-backed Anthropic
  request body `model`, including reverse-proxy Anthropic and `ollama-cloud`
  Anthropic calls. No-resolved-profile callers keep the legacy
  `arg.modelInfo.internalID` request-model fallback.
- Profile-backed Anthropic URLs now prefer exact `endpoint` values, otherwise
  append `/messages` to profile `baseUrl` without double-appending. Legacy
  `arg.customURL` defaults and reverse-proxy `db.autofillRequestUrl` mutation
  remain limited to no-resolved-profile callers.
- Profile-backed API keys now come only from `providerOptions.apiKey`, so
  conflicting `arg.key`, `db.proxyKey`, `db.claudeAPIKey`, and `db.ollamaApiKey`
  values cannot override profile Anthropic, Bedrock, or `ollama-cloud`
  Anthropic requests.
- Profile `providerOptions.additionalParams` now drives browser-local
  Anthropic reverse-proxy additional-parameter application when a resolved
  profile is present. Resolver-provided `extraHeaders`, including
  `X-Proxy-Risu`, are merged before additional params. Bedrock profile
  additional params are applied before AWS signing, matching the legacy signed
  header/body order.
- Bedrock profile-backed requests use the resolver-owned `requestModel`
  directly as the AWS model segment, preserving the existing `us.`/`global.`
  prefix chosen by the resolver without adding another prefix. Bedrock callers
  without a resolved profile keep the legacy prefix calculation.
- Focused coverage proves profile-generated reverse-proxy Anthropic, Bedrock,
  and `ollama-cloud` Anthropic settings beat intentionally conflicting flat DB
  and arg values, and pins a no-resolved-profile reverse-proxy Anthropic
  fallback.

## Implemented Browser-Local Mistral Provider-Options Slice

- Browser-local `requestOpenAI()` now uses
  `resolvedProfile.providerOptions.requestModel` for profile-backed Mistral
  request body `model`, including reverse-proxy Mistral and `xcustom:::`
  Mistral calls. No-resolved-profile native Mistral callers keep the legacy
  body model `aiModel`.
- Profile-backed Mistral URLs now use the shared profile chat-completions URL
  resolver, so profile `baseUrl`, exact `endpoint`, and custom-model URL
  normalization win over conflicting flat DB and arg URLs. No-resolved-profile
  Mistral callers keep `arg.customURL ?? "https://api.mistral.ai/v1/chat/completions"`.
- Profile-backed API keys now come only from `providerOptions.apiKey`, so
  conflicting `arg.key`, `db.proxyKey`, custom model keys, or `db.mistralKey`
  values cannot override profile-backed Mistral requests.
- Resolver-provided `extraHeaders`, including reverse-proxy `X-Proxy-Risu`, are
  merged before profile `additionalParams`, and profile additional params drive
  both body and header mutation. No-resolved-profile Mistral callers do not use
  the legacy additional-parameter DSL fallback.
- Focused coverage proves profile-generated reverse-proxy Mistral and
  `xcustom:::` Mistral settings beat intentionally conflicting flat DB and arg
  values, and pins no-resolved-profile native Mistral custom URL/key/model
  behavior.

## Remaining Phase 3 Work

- Broaden provider parity for retained browser-local request helpers before
  marking full Phase 3 complete. The browser role/static/fallback selection path
  now uses the resolver, browser-local Gemini/Vertex provider options are
  adopted, and browser-local OpenAI-compatible chat-completions provider options
  are adopted, and browser-local OpenAI Responses/legacy instruct provider
  options are adopted, and browser-local Anthropic-family provider options are
  adopted, and browser-local Mistral provider options are adopted. Other local
  helper branches such as Cohere, native Ollama, Kobold, Horde, and Ooba legacy
  still read many provider-specific options directly from flat database fields.
- Verify any future browser-local provider option adoption without changing the
  server-intent payload shape or editing Fastify generation routes unless a real
  regression is exposed.

## Anchors

- `src/ts/process/request/request.ts`
- `src/ts/process/request/shared.ts`
- `src/ts/process/request/serverPromptAssembly.ts`
- `src/ts/process/request/serverCompletion.ts`
- `server/fastify/src/routes/generation.ts`
- `server/fastify/src/prompt/chatDispatch.ts`
- `server/fastify/src/generation/*`
- `src/ts/process/request/tests/serverCompletion.test.ts`
- `src/ts/process/request/tests/serverChat.test.ts`
- `server/fastify/__tests__/providerTransport.test.ts`

## Dispatch Conversion Rules

- Provider adapters should receive resolved request options, not infer from
  global database fields.
- Browser preflight and server dispatch should agree on the provider-capability
  verdict for the same resolved profile and effective settings input.
- Preserve reverse proxy format mutation, `xcustom` params, Bedrock, Horde,
  OpenRouter, NanoGPT, Ollama, Kobold, and Ooba quirks.
- Preserve `staticModel` behavior exactly as recorded in Phase 0.
- Streaming, additional params, system-role replacements, custom flags, tools,
  and provider request models must be covered by fixtures.

## Exit Criteria

- Browser completion helpers and Fastify completion/chat dispatch use the
  resolver or its normalized runtime object.
- `reverse_proxy`, `xcustom:::`, OpenAI, OpenRouter, NanoGPT, Ollama,
  Anthropic, Gemini/Vertex, Mistral, Cohere, Bedrock, Horde, Kobold, and Ooba
  legacy keep current behavior under the compatibility adapter.
- No known runtime path relies on `db.aiModel` alone when a role/profile context
  is available.
- Server-intent validation still rejects client-supplied provider settings.

## Validation

```bash
pnpm exec vitest run src/ts/process/request/tests/providerCapability.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/serverChat.test.ts src/ts/process/request/tests/google.fastify.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/providerTransport.test.ts server/fastify/__tests__/providerCapabilityRoute.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Latest browser-local Mistral provider-options run:

```bash
pnpm exec prettier --write --ignore-path /dev/null src/ts/process/request/openAI/requests.ts src/ts/process/request/tests/openaiProfileOptions.test.ts docs/plan/model-config-profiles/status.md docs/plan/model-config-profiles/latest-verification.md docs/plan/model-config-profiles/phases/phase-3-generation-dispatch.md docs/plan/model-config-profiles/SOLVE-NOTE.md
pnpm exec vitest run src/ts/process/request/tests/openaiProfileOptions.test.ts src/ts/model/modelProfileResolver.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

Results:

- Prettier: passed.
- Focused browser request/provider tests: passed, 5 files / 92 tests.
- Client-lib TypeScript: passed.
- Server strict TypeScript: passed.
- Whitespace check: passed.

## Risks

- Server dispatch has provider-specific branches for request model, endpoint,
  API key, and additional params. Moving only some branches can create partial
  parity failures.
- Completion `staticModel` currently carries only a model id. Do not treat it
  as a full independent profile until Phase 6 defines persisted fallback
  semantics.
