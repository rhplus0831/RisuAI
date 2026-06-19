# Phase 3: Generation Dispatch

Status: in progress; Phase 3a server-owned profile selection/capability/request-model slice complete; Phase 3b Fastify OpenAI-compatible provider-options slice complete; Phase 3c Fastify Anthropic/Mistral/Cohere provider-options slice complete; Phase 3d Fastify native Ollama provider-options slice complete; Phase 3e Fastify Kobold provider-options slice complete; Phase 3f Fastify Horde provider-options slice complete; Phase 3g Fastify OobaLegacy provider-options slice complete.

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

## Remaining Phase 3 Work

- Migrate the remaining browser completion/request helper paths to consume the
  resolver contract for role/static fallback selection.
- Migrate remaining provider option branches outside OpenAI-compatible,
  Anthropic, Mistral, Cohere, native Ollama, Kobold, Horde, and OobaLegacy to
  `profile.providerOptions` where the target adapters already expose equivalent
  request fields. Residual branches include Gemini/Vertex and Bedrock.
- Broaden provider parity beyond the Phase 3a request-model surface before
  marking the full Phase 3 complete.

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

Latest Phase 3g run:

```bash
pnpm exec vitest run src/ts/model/modelProfileResolver.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/chatDispatchProfileOptions.test.ts server/fastify/__tests__/oobaLegacy.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/generation.completion.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Results:

- Focused resolver tests: passed, 1 file / 16 tests.
- Focused Fastify chat dispatch/OobaLegacy/chat/completion tests: passed, 4 files /
  192 tests.
- Client-lib TypeScript: passed.
- Server strict TypeScript: passed.

## Risks

- Server dispatch has provider-specific branches for request model, endpoint,
  API key, and additional params. Moving only some branches can create partial
  parity failures.
- Completion `staticModel` currently carries only a model id. Do not treat it
  as a full independent profile until Phase 6 defines persisted fallback
  semantics.
