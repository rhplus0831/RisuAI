# Phase 0: Current Contracts

Status: not started.

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

- Field inventory is recorded in this phase or linked from a companion doc.
- Current behavior fixtures exist for the riskiest role, provider, preset,
  fallback, masking, and memory paths.
- Resolver, fallback, preset, custom model, and memory boundary decisions are
  recorded in `status.md`.
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
