# Phase 3: Generation Dispatch

Status: in progress; Phase 3a server-owned profile selection/capability/request-model slice complete.

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

## Remaining Phase 3 Work

- Migrate the remaining browser completion/request helper paths to consume the
  resolver contract for role/static fallback selection.
- Decide and test the next provider-option migration step before moving API
  keys, base URLs, additional params, or custom provider details into
  `profile.providerOptions`.
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

Latest Phase 3a run:

```bash
pnpm exec vitest run src/ts/model/modelProfileResolver.test.ts src/ts/process/request/tests/serverPromptAssembly.test.ts src/ts/process/request/tests/serverCompletion.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/modelProfileResolver.server.test.ts server/fastify/__tests__/providerCapabilityRoute.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/providerTransport.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Results:

- Focused browser resolver/preflight/completion/routing/capability tests:
  passed, 5 files / 100 tests.
- Focused Fastify resolver/capability/completion/chat/transport tests: passed,
  5 files / 183 tests.
- Client-lib TypeScript: passed.
- Server strict TypeScript: passed.

## Risks

- Server dispatch has provider-specific branches for request model, endpoint,
  API key, and additional params. Moving only some branches can create partial
  parity failures.
- Completion `staticModel` currently carries only a model id. Do not treat it
  as a full independent profile until Phase 6 defines persisted fallback
  semantics.
