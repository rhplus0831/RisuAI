# Phase 6 Ollama Stream Errors - 2026-05-27

Slice 6C landed. Phase 6 is closed again.

## What Changed

- Updated Ollama NDJSON streaming so fetch failures, upstream non-OK
  responses, missing stream bodies, stream read failures, invalid upstream
  stream JSON, and upstream error chunks yield typed `kind: 'error'` frames.
- Preserved existing token and done stream frame names for successful streams.
- Kept intentional aborts quiet instead of converting user cancellation into
  provider errors.
- Added focused provider tests for upstream 500, raw upstream error bodies,
  missing stream bodies, fetch/read failures, and malformed NDJSON.
- Added `/api/v1/generate/completion` route tests proving Ollama stream
  failures serialize as SSE `event: error` frames.

## Final Stream Audit

The final `run*Stream` audit covered Echo, OpenAI-compatible, Anthropic,
Mistral, Gemini, and Ollama streaming providers. OpenAI-compatible,
Anthropic, Mistral, Gemini, and Ollama now emit typed provider error frames
for upstream failures. Echo only has local abort/control-flow returns and no
upstream transport.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/ollama.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts
```

## Historical Next Pickup

At this slice closeout, Phase 0 Slice 0A was the next default pickup:
remove the tracked Google Drive OAuth worker artifact under `public/`.
Phase 3 Slice 3A could land independently.
