# Phase 5: Custom, Secrets & Auxiliary

Status: complete.

Goal: harden the non-main-chat surfaces that could otherwise keep borrowing
global provider settings after the resolver migration.

## Closed Scope

- Memory summary model resolution now uses the resolver for the `memory` role,
  while preserving summary alias behavior.
- Memory embedding remains a separate server-side embedding model type on the
  Hypa/Voyage/custom embedding fields and is pinned by regression coverage.
- Dynamic OpenRouter and NanoGPT catalog fetches pass explicit keys instead of
  implicitly borrowing global settings.
- Fastify OpenAI-family dispatch and retained browser OpenAI/Responses helpers
  use profile-owned options.
- Auto suggestions and image prompts route through the auxiliary role, while
  playground subtitle generation routes through the translate role.
- Translation cache entries are scoped to resolved profile identity.
- `xcustom:::` static fallback options are covered so fallback execution keeps
  resolved provider settings instead of only a bare model id.
- MCP AI access role routing is pinned by tests.
- `seperateParameters` auxiliary fallback ownership is resolved through the
  auxiliary profile path.
- Secret masking remains flat for existing stable rows, custom-model rows, and
  provider settings. Profile-local secret masking is deferred to Phase 6, when
  durable profile identity exists.
- No durable `modelProfiles`, `profileBindings`, schema changes, or migrations
  were added. Existing flat compatibility fields remain the source of truth
  until Phase 6.

## Anchors

- `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte`
- `src/ts/model/openrouter.ts`
- `src/ts/model/nanogpt.ts`
- `src/ts/model/providers/nanogpt.ts`
- `src/ts/model/ollama.ts`
- `src/ts/model/ooba.ts`
- `src/ts/horde/getModels.ts`
- `src/lib/UI/NanoGPTDashboard.svelte`
- `src/lib/UI/NanoGPTProviderPicker.svelte`
- `src/lib/UI/OpenrouterProviderList.svelte`
- `server/fastify/src/providerSecrets.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/commands/splitPresets.ts`
- `server/fastify/src/memorySummaryModel.ts`
- `server/fastify/src/memoryEmbeddingModel.ts`
- `server/fastify/src/memorySummaryAdapter.ts`
- `server/fastify/src/memoryEmbeddingAdapter.ts`
- `src/ts/translator/translator.ts`
- `src/ts/process/postGeneration/emotionFallbackLlm.ts`
- `src/ts/process/postGeneration/igp.ts`
- `src/ts/process/triggers.ts`
- `src/ts/process/scriptings.ts`
- `src/ts/process/mcp/aiaccess.ts`
- `src/lib/ChatScreens/Suggestion.svelte`
- `src/lib/Playground/*`
- `src/lib/Others/AllSeperateParameters.svelte`
- `src/lib/Others/ProTools/EasyPanel.svelte`

## Exit Criteria

- Done: committed auxiliary request slices route known suggestion, image prompt,
  subtitle, and MCP AI access paths through role-aware behavior.
- Done: memory summary profile behavior is covered by server tests.
- Done: memory embedding separation is documented here and covered by server
  tests.
- Done: fallback execution has `xcustom:::` static-model option coverage.
- Done: separate parameters have an auxiliary fallback owner under the resolver
  contract.
- Done: dynamic catalog fetches receive explicit keys.
- Done: Fastify and browser OpenAI option gaps use profile-owned options.
- Done: profile-local secret masking is explicitly deferred to Phase 6. Existing
  stable custom/provider masking remains flat and covered by existing tests.

## Validation

```bash
pnpm exec vitest run src/lib/ChatScreens/Suggestion.svelte.test.ts src/lib/Playground/PlaygroundSubtitle.sourceLang.svelte.test.ts src/lib/Others/AllSeperateParameters.svelte.test.ts
pnpm exec vitest run src/ts/model/openrouter.test.ts src/ts/model/nanogpt.test.ts src/ts/process/request/tests/openaiProfileOptions.test.ts src/ts/process/request/tests/openaiResponsesLegacyProfileOptions.test.ts src/ts/process/stableDiff.test.ts src/ts/translator/translator.html.test.ts src/ts/translator/translator.cache.test.ts src/ts/process/mcp/aiaccess.test.ts src/ts/process/mcp/mcp.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/chatDispatchProfileOptions.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/memorySummaryModel.test.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Residual Notes

- Phase 6 must introduce durable profile identity before adding profile-local
  secrets or masking. Do not retrofit profile-local masking into the flat Phase 5
  compatibility surface.
- Provider option panels still remain global/flat for compatibility. Phase 6 can
  move or mirror them only after persisted profiles and flat-field compatibility
  rules are explicit.
- Auxiliary paths still have legacy mode names such as `submodel`, `otherAx`, or
  `scriptAux`. Preserve aliases until a later cleanup explicitly retires them.
