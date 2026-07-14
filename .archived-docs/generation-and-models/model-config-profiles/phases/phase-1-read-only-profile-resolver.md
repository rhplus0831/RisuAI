# Phase 1: Read-Only Profile Resolver

Status: complete; ready for Phase 2.

Goal: introduce a shared resolver that derives a profile-like runtime object
from existing flat settings without changing persisted storage or UI writes.

## Scope

- Add a pure resolver module for role/static model resolution.
- Keep `aiModel`, `subModel`, `modelRoles`, `seperateModelsForAxModels`,
  `seperateModels`, and `scriptAux` behavior readable through a compatibility
  adapter.
- Return a normalized object with role, legacy profile marker, model id,
  cloned model metadata, provider capability input, custom-model dependency,
  provider options, runtime options, and fallback references.
- Reuse `resolveProviderCapability`; do not fork the provider capability table.
- Keep server-safe model-info resolution separate from browser-only dynamic
  registry behavior.
- Add parity tests before runtime consumers switch.

## Implemented Slice

- Added `src/ts/model/modelProfileResolver.ts` as a pure shared resolver over
  the existing flat `Database` shape.
- Exported:
  - `resolveModelProfile({ database, role?, staticModel?, lookupModelInfo? })`
  - `resolveLegacyFallbackRefs(database, role)`
  - `resolveServerSafeModelInfo(database, modelId)`
  - `buildProfileProviderCapabilityInput(profile)`
  - `resolveProfileRequestModel(profile)`
- The resolved object includes role/source metadata, a legacy profile marker,
  selected model id, cloned model info, provider capability input/verdict,
  normalized request model, provider options, runtime options, custom-model
  dependency, and fallback refs.
- The resolver preserves current compatibility behavior:
  - `chatMain` and `chatAux` use `aiModel` and `subModel`; their `modelRoles`
    entries are ignored.
  - Non-chat roles honor non-blank `modelRoles` first, then legacy
    `seperateModelsForAxModels`/`seperateModels` inheritance.
  - `scriptAux` keeps the legacy `scriptAux` -> `otherAx` -> `subModel` chain.
  - `staticModel` remains a raw model-id bypass and does not emit recursive
    fallback refs.
  - Fallback refs are legacy raw model ids, and legacy `submodel` has no
    fallback bucket.
- Provider capability still comes from
  `src/ts/process/request/providerCapability.ts`; no runtime dispatch consumer
  was switched in this phase.
- The resolver avoids importing `src/ts/model/modellist.ts`. It uses
  `src/ts/model/types.ts`, server-safe provider lists, prefix/custom-model
  compatibility logic, and an optional lookup callback for richer metadata.
- Added focused browser-side resolver tests and a Fastify server-safe import
  proof.

## Anchors

- `src/ts/model/modelRoles.ts`
- `src/ts/model/modellist.ts`
- `src/ts/model/types.ts`
- `src/ts/process/request/providerCapability.ts`
- `src/ts/process/request/shared.ts`
- `server/fastify/src/prompt/chatDispatch.ts`
- `server/fastify/src/memorySummaryModel.ts`

## Resolver Contract

The resolver should answer these questions for a given role or static fallback:

- Which role and compatibility profile marker are active?
- Which model id and model metadata should be used?
- Which provider can dispatch the request?
- Which request model should be sent on the wire?
- Which endpoint, API key, headers, auth config, and additional parameters
  apply?
- Which runtime parameters, tokenizer flags, tools, schema/output options, and
  streaming preferences apply?
- Which fallback references apply, and whether they are legacy model ids or
  future profile ids?

## Compatibility Fixtures

- Covered in `src/ts/model/modelProfileResolver.test.ts`:
  - `chatMain`, `chatAux`, memory, script main, and script auxiliary role
    behavior with explicit `modelRoles`.
  - Legacy `seperateModelsForAxModels` and `seperateModels` inheritance,
    including the `scriptAux` fallback chain.
  - `staticModel` bypass behavior and legacy fallback refs.
  - `reverse_proxy` OpenAI-compatible normalization.
  - `xcustom:::` matching formats and missing-key incomplete config.
  - OpenRouter request model and provider hints.
  - NanoGPT subscription endpoint and provider hints.
  - Ollama local, Ollama cloud, and cloud format remapping.
  - `OaiCompAPIKeys` key-identifier models with DeepSeek.
  - Custom flags overriding lookup-provided model metadata.
- Not exhaustively matrixed yet:
  - `reverse_proxy` Responses, Anthropic, Cohere, and legacy instruct URL
    variants are implemented in the resolver but not individually fixture-tested
    in this slice.
  - DeepInfra key-identifier behavior is implemented by prefix but not covered
    by a separate focused assertion.
  - Runtime dispatch has not adopted the resolver yet, by phase design.

## Exit Criteria

- New resolver is covered by focused parity tests: passed.
- Existing `resolveModelForRole` remains as a compatibility helper, and new code
  has a profile-aware API to call: passed.
- Server and browser tests can build provider-capability input from a resolved
  profile: passed through focused resolver tests plus server import proof.
- No runtime dispatch path is switched before this phase is green: passed.
- No durable profile fields are added in this phase: passed.
- Full server strict TypeScript proof: passed after completing the
  `server/fastify/__tests__/memorySummaryModel.test.ts` custom model fixture
  metadata.

## Validation

```bash
pnpm exec vitest run src/ts/model/modelRoles.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/providerCapabilityRoute.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Latest Phase 1 run:

```bash
pnpm exec vitest run src/ts/model/modelProfileResolver.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/modelProfileResolver.server.test.ts
pnpm exec vitest run src/ts/model/modelRoles.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts src/ts/model/modelProfileResolver.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/providerCapabilityRoute.test.ts server/fastify/__tests__/modelProfileResolver.server.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memorySummaryModel.test.ts
```

Results:

- Focused resolver tests: passed, 1 file / 12 tests.
- Fastify resolver import proof: passed, 1 file / 1 test.
- Phase 1 client regression bundle: passed, 4 files / 74 tests.
- Phase 1 Fastify regression bundle: passed, 2 files / 12 tests.
- Client-lib TypeScript: passed.
- Server strict TypeScript: passed.
- Focused memory summary model test: passed, 1 file / 4 tests.

## Risks

- A resolver that reads live Svelte stores directly will be hard to share with
  server code. Keep the core pure and pass the needed database/settings input.
- A resolver that imports browser dynamic registry state into server code can
  break Fastify tests. Define server-safe model lookup boundaries.
