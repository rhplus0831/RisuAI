# Phase 5: Custom, Secrets & Auxiliary

Status: not started.

Goal: harden the non-main-chat surfaces that can otherwise keep borrowing
global provider settings after the resolver migration.

## Scope

- Treat `customModels` / `xcustom:::` as profile dependencies with stable row
  identity, even if they remain a separate catalog.
- Extend secret masking only for existing stable rows such as `customModels` or
  already-keyed provider settings. Durable profile-secret masking waits for
  Phase 6, when profile ids exist.
- Avoid generic deep-object copying for secret-bearing structures.
- Update memory summary model resolution to use the resolver for the `memory`
  role while keeping memory embedding as a separate model type unless Phase 0
  decided otherwise.
- Preserve `subModel` summary alias behavior and server-only embedding
  constraints.
- Update LLM translation, emotion/inlay generation, auto suggestions, scripts,
  MCP AI access, playground tools, and plugin-accessible generation helpers.
- Resolve fallback behavior, `seperateParameters`, custom flags, and
  `modelTools` ownership under the resolver contract.
- Audit dynamic model registry/catalog fetches that currently use global keys.

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

- All `requestChatData(..., mode)` callers either pass a role/profile context or
  intentionally use a legacy compatibility wrapper.
- Memory summary profile behavior is covered by server tests.
- Memory embedding separation is documented and tested if it is not migrated.
- Fallback execution can use resolved provider settings rather than only a bare
  model id.
- Separate parameters, custom flags, and model tools have one documented owner.
- Secret masking paths cover existing stable custom/provider rows touched in
  this phase.
- Profile-local secret masking is explicitly deferred to Phase 6 unless Phase 0
  selected another stable identity mechanism.

## Validation

```bash
pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/translator/translator.html.test.ts src/ts/process/__tests__/emotionFallbackLlm.test.ts src/ts/process/__tests__/igp.test.ts src/ts/process/mcp/mcp.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/providerSecrets.test.ts server/fastify/__tests__/memorySummaryModel.test.ts server/fastify/__tests__/memoryEmbeddingModel.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Risks

- Auxiliary paths often use legacy mode names such as `submodel`, `otherAx`, or
  `scriptAux`. Preserve aliases until every caller is updated.
- Fallback model ids are insufficient for profile-specific URLs and keys. Do
  not close this phase until fallback semantics are tested.
