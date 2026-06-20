# Phase 5: Generation Guardrails

Status: completed.

Goal: ensure active incomplete, unsupported, or broken profile-bound generation
fails early and clearly in both browser and server paths.

## Scope

- Browser preflight blocks before sending when the active resolved profile is
  Incomplete or Unsupported.
- Server generation routes reject active incomplete/unsupported profile-bound
  requests with clear 4xx errors.
- Explicit profile binding to a missing profile fails early.
- Profile-bound roles do not silently fall back to legacy fields when profile
  config is incomplete.
- Keep the Phase 4 Custom API optional-auth dispatch support covered by
  regression tests.
- Official OpenAI still requires API key.
- Raw model fallback rows map to static-model-style compatibility behavior.
- Fallback profile refs use their own full provider/runtime config.
- Audit prompt assembly paths that still depend on `db.aiModel` and thread
  resolved profile/model information where required.

## Out Of Scope

- Additional first-class providers beyond the approved five.
- Full prompt assembly refactors unrelated to profile correctness.

## Anchors

- `src/ts/process/request/serverPromptAssembly.ts`
- `src/ts/process/request/providerCapability.ts`
- `src/ts/process/request/request.ts`
- `src/ts/process/request/tests/modelRoleRouting.test.ts`
- `src/ts/process/request/tests/providerCapability.test.ts`
- `server/fastify/src/routes/generation.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/chatDispatch.ts`
- `server/fastify/src/generation/openai.ts`
- `server/fastify/__tests__/generation.chat.test.ts`
- `server/fastify/__tests__/generation.completion.test.ts`

## Exit Criteria

- Active incomplete profiles are blocked before provider dispatch.
- Active unsupported profiles return clear user-facing/provider-independent
  errors.
- Broken explicit profile bindings do not generate through legacy fallback.
- Custom API unauthenticated local OpenAI-compatible endpoint support remains
  covered by regression tests.
- Prompt assembly uses the effective profile/model where provider-first
  correctness requires it.

## Validation

```bash
pnpm exec vitest run src/ts/process/request/tests/modelRoleRouting.test.ts src/ts/process/request/tests/providerCapability.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/chatDispatchProfileOptions.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Risks

- The current OpenAI generation adapter expects an API key. Keep optional auth
  narrow to `custom-api`.
- Prompt assembly legacy assumptions can produce correct dispatch with wrong
  prompt/tokenizer behavior if not audited.
- Generation chat streaming must validate before sending irreversible SSE
  headers.
