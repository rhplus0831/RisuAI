# Phase 1: Read-Only Profile Resolver

Status: not started.

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

- `chatMain`, `chatAux`, memory, emotion, translate, other auxiliary, script
  main, and script auxiliary roles with and without explicit `modelRoles`.
- Legacy `seperateModelsForAxModels` and `seperateModels` behavior.
- `staticModel` bypass behavior for completion and server-intent paths.
- `reverse_proxy` with OpenAI-compatible, Responses, Anthropic, Mistral, Cohere,
  and legacy instruct formats.
- `xcustom:::` entries with matching/mismatching format and missing key/url.
- OpenRouter request model and provider hints.
- NanoGPT regular/subscription endpoints and provider hints.
- Ollama local, Ollama cloud, and cloud format remapping.
- `OaiCompAPIKeys` key-identifier models such as DeepSeek and DeepInfra.
- Custom flags overriding model registry flags.

## Exit Criteria

- New resolver is covered by focused parity tests.
- Existing `resolveModelForRole` can remain as a compatibility helper, but new
  code has a profile-aware API to call.
- Server and browser tests can build the same provider-capability input from a
  resolved profile.
- No runtime dispatch path is switched before this phase is green.
- No durable profile fields are added in this phase.

## Validation

```bash
pnpm exec vitest run src/ts/model/modelRoles.test.ts src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/providerCapabilityRoute.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Risks

- A resolver that reads live Svelte stores directly will be hard to share with
  server code. Keep the core pure and pass the needed database/settings input.
- A resolver that imports browser dynamic registry state into server code can
  break Fastify tests. Define server-safe model lookup boundaries.
