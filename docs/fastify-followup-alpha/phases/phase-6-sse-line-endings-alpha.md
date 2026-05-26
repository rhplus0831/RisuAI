# Phase 6 Alpha - SSE Line Ending Handling

Date: 2026-05-27

## Goal

Make the Phase 6 SSE provider parsers accept standard SSE event
delimiters before applying truncated-tail detection.

## Finding

The truncated-tail slice correctly rejects non-empty leftover SSE data
after stream EOF, but the active parsers still split completed provider
events only on `\n\n`. Standard SSE streams may use CRLF event
delimiters (`\r\n\r\n`). Today those complete CRLF-delimited events can
stay buffered until EOF and then be reported as
`truncated upstream stream event` because tail detection normalizes CRLF
only after parsing has already failed to find a block boundary.

Source evidence:

- `server/fastify/src/generation/openai.ts`
- `server/fastify/src/generation/anthropic.ts`
- `server/fastify/src/generation/mistral.ts`
- `server/fastify/src/generation/gemini.ts`

Affected streaming providers:

- OpenAI-compatible providers: OpenAI, NanoGPT, OpenRouter, and routed
  OpenAI-compatible reverse proxy / custom providers.
- Anthropic Messages.
- Mistral.
- Gemini / Vertex AI Gemini.

The `/api/v1/generate/completion` route and the `/api/v1/generate/chat`
production dispatch path both consume these same provider stream
generators, so fixing the provider parsers is the shared boundary.

## Scope

- Add shared SSE framing/parsing behavior, or equivalent provider-local
  handling, that recognizes LF and CRLF event block delimiters.
- Keep the existing alpha truncated-tail behavior: non-empty,
  non-comment leftover data after EOF must still emit a typed provider
  error instead of a successful `done`.
- Add focused happy-path tests proving CRLF-delimited provider events are
  parsed for OpenAI-compatible, Anthropic, Mistral, and Gemini streams.
- Add route-level `/api/v1/generate/completion` coverage proving a
  CRLF-delimited upstream stream reaches the browser-facing SSE envelope.
- Re-run the existing truncated-tail regression tests to ensure the CRLF
  fix does not reintroduce silent successful tails.

## Boundaries

- Do not broaden this slice into deferred helper routes, local-only
  provider families, or buffered-only provider streaming support.
- Native Ollama uses NDJSON, not SSE, and is out of this line-ending
  slice unless the implementation changes shared stream utilities that
  affect it.
- Do not add compatibility migrations for intermediate Fastify shapes.

## Exit Criteria

- CRLF-delimited SSE events from the four Phase 6 SSE provider families
  produce the same token and done/error frames as LF-delimited events.
- Unterminated SSE tails still produce typed provider errors.
- Focused provider and route tests pass:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/openai.test.ts server/fastify/__tests__/anthropic.test.ts server/fastify/__tests__/mistral.test.ts server/fastify/__tests__/gemini.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```
