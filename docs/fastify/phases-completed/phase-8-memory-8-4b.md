# Phase 8 Memory - 8-4b Closeout

Date: 2026-05-24

## Scope Landed

- Added `server/fastify/src/memorySummaryAdapter.ts` with
  `summarizeOnce(messages, opts)` for non-streaming API-backed Hypa V3
  summary calls.
- Extracted OpenAI-compatible provider variant resolution into
  `server/fastify/src/generation/openaiCompatible.ts` so the summary
  adapter and `/completion` route use the same OpenAI, NanoGPT, and
  OpenRouter routing behavior.
- `summarizeOnce` wraps `resolveOpenAIRequest` and `runOpenAI`
  directly, normalizing success and failure into
  `{ text, tokens } | { error }`.
- Aborted `runOpenAI` responses now normalize to `{ error: "aborted" }`
  for the adapter.
- Summary provider output is scrubbed through the existing
  `<Thoughts>` and `<think>` cleanup helpers before returning to the
  future job handler.

## Boundaries

- No call or refactor of `handleOpenAICompatibleBuffered` landed; it
  remains route-handler-shaped and reply-writing.
- No SPA `requestChatData` provider-routing logic was ported.
- No local MLC, ONNX, or WebLLM summary runtime landed.
- No worker wiring, summary persistence, embedding, rate limiting,
  memory prompt selection, browser listeners, or browser controls
  landed.
- Adapter token reporting is currently `0` because `runOpenAI` does not
  expose upstream usage data yet.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySummaryAdapter.test.ts server/fastify/__tests__/memorySummaryPrompt.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused summary adapter and prompt verification passed with 14 tests.
`pnpm check` was clean. `pnpm test` passed with 639 tests plus 4
skipped. `pnpm api:test` passed with 969 tests. `pnpm build` passed with
existing CSS `::highlight`, browser externalization, plugin-timing, and
chunk-size warnings.

## Next Pickup

Continue with 8-4c - Summarize job handler. Wire the `summarize` memory
job handler against planned chunks: load the chunk payload, build the
summary prompt, call `summarizeOnce`, persist `memory_summaries`, mark
chunks summarized, and complete or fail jobs through the queue
primitives. Keep embedding, similarity selection, prompt assembly reads,
rate limiting, ordered batch writes, and browser progress UI out of
scope for 8-4c.
