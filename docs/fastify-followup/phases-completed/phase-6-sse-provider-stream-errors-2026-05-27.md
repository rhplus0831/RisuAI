# Phase 6 SSE Provider Stream Errors - 2026-05-27

Slice 6B landed. Phase 6 remains reopened for slice 6C.

## What Changed

- Updated Anthropic streaming so fetch failures, upstream non-OK
  responses, missing stream bodies, stream read failures, and invalid
  upstream event JSON yield typed `kind: 'error'` frames.
- Updated Mistral streaming with the same typed error-frame behavior,
  including OpenAI-style upstream error message and code extraction.
- Updated Gemini streaming with the same typed error-frame behavior,
  including Gemini error message/status extraction and Vertex auth
  failure reporting.
- Added focused provider tests for upstream non-OK responses, missing
  stream bodies, and invalid stream JSON for Anthropic, Mistral, and
  Gemini.

## Notes

- Existing token and done stream frames were preserved.
- Intentional aborts still return quietly instead of emitting provider
  errors.
- No compatibility migration was added because there are no actual
  Fastify users yet.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/anthropic.test.ts server/fastify/__tests__/mistral.test.ts server/fastify/__tests__/gemini.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```

## Next Pickup

Phase 6 Slice 6C is now the default pickup: align Ollama's NDJSON stream
path with the typed error-frame contract, rerun the final `run*Stream`
silent-return audit, and close any remaining stream failure gaps.
