# Phase 6 Stream Error Contract And OpenAI - 2026-05-27

Slice 6A landed. Phase 6 remains reopened for slices 6B and 6C.

## What Changed

- Added a typed `kind: 'error'` completion stream frame with optional
  upstream status and code metadata.
- Serialized `/api/v1/generate/completion` provider stream failures as
  `event: error` SSE frames with provider error data, while preserving
  existing `chunk` and `done` events.
- Updated OpenAI-compatible streaming so fetch failures, upstream non-OK
  responses, missing stream bodies, upstream stream read failures, and
  invalid upstream stream JSON become visible stream errors instead of
  empty successful streams.
- Updated the server-side provider transport and browser
  `requestServerCompletion` stream parser so provider error frames are
  terminal failures.

## Notes

- No compatibility migration was added because there are no actual
  Fastify users yet.
- Slice 6B should reuse the 6A error-frame semantics for Anthropic,
  Mistral, and Gemini SSE-style providers. Slice 6C should do the same
  for Ollama NDJSON and then rerun the final stream audit.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/openai.test.ts server/fastify/__tests__/providerTransport.test.ts server/fastify/__tests__/generation.completion.test.ts
pnpm test -- src/ts/process/request/tests/serverCompletion.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```

## Next Pickup

Phase 6 Slice 6B is now the default pickup: align Anthropic, Mistral,
and Gemini stream failures with the typed error-frame contract.
