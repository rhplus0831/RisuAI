# Phase 6 Alpha - SSE Line Ending Handling

Date: 2026-05-27

## Scope

Closed the reopened Phase 6 alpha finding where completed
CRLF-delimited upstream SSE events could be buffered until EOF and
misreported as truncated stream tails.

## Landed Changes

- Added shared SSE event-block framing that recognizes LF and CRLF
  delimiters before provider-specific parsing.
- OpenAI-compatible, Anthropic, Mistral, and Gemini stream parsers now
  consume completed CRLF-delimited provider events without changing the
  existing truncated-tail EOF guard.
- Focused provider tests cover CRLF-delimited happy paths for all four
  SSE provider families.
- `/api/v1/generate/completion` now has route-level coverage proving a
  CRLF-delimited OpenAI-compatible upstream stream reaches the
  browser-facing SSE envelope.

## Verification

Passed:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/openai.test.ts server/fastify/__tests__/anthropic.test.ts server/fastify/__tests__/mistral.test.ts server/fastify/__tests__/gemini.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```

## Next Pickup

Phase 6 is closed for the alpha audit. Continue with Phase 9 projection
write tails, then Phase 5 sendChat boundary drift, then the broad
closeout typecheck blocker.
