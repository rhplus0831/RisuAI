# Phase 3: Generation Dispatch

Status: not started.

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

## Risks

- Server dispatch has provider-specific branches for request model, endpoint,
  API key, and additional params. Moving only some branches can create partial
  parity failures.
- Completion `staticModel` currently carries only a model id. Do not treat it
  as a full independent profile until Phase 6 defines persisted fallback
  semantics.
