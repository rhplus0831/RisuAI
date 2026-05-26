# Phase 6 Alpha - Provider SSE Tail Handling

Date: 2026-05-27

## Scope

Closed the reopened Phase 6 alpha finding where truncated upstream SSE
tails could be ignored and converted into successful `done` streams.

## Landed Changes

- Added shared SSE tail detection for non-empty, non-comment leftover
  data after stream EOF.
- OpenAI-compatible, Anthropic, Mistral, and Gemini stream parsers now
  flush their `TextDecoder`, inspect leftover buffers, and emit a typed
  provider error for unterminated stream events.
- Focused provider tests cover unterminated `data:` tails for all four
  SSE providers.
- `/api/v1/generate/completion` now has route-level coverage proving
  truncated provider SSE tails reach the browser-facing
  `provider_error` event shape.

## Verification

Passed:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/openai.test.ts server/fastify/__tests__/anthropic.test.ts server/fastify/__tests__/mistral.test.ts server/fastify/__tests__/gemini.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```

Pending before broad alpha closeout:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

## Next Pickup

The alpha handoff now points to Phase 3 hub response-header filtering as
the default next slice. Phase 8 memory event isolation can proceed in
parallel.
