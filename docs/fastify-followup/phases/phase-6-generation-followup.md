# Phase 6 Follow-Up - Server-Side Generation

Date: 2026-05-26

Status: reopened by audit.

## Goal

Make streaming `/api/v1/generate/completion` failures visible and typed
instead of turning upstream failures into empty successful streams.

## Audit Finding

`server/fastify/src/generation/openai.ts:256` returns from the stream
generator when the upstream response is not OK or has no body.
`server/fastify/src/routes/generation.ts:312` serializes only token and
done frames, and `server/fastify/src/routes/generation.ts:333` pipes the
stream without mapping provider failures to an SSE error frame. A
streaming upstream failure can therefore become a 200 SSE response with
no useful error.

## Tasks

- Extend the streaming frame contract with a typed provider error frame,
  or fail before writing the SSE headers when the upstream failure is
  known synchronously.
- Update OpenAI-compatible streaming so non-OK and bodyless upstream
  responses surface the upstream status/message.
- Audit other streaming providers for the same silent-return pattern and
  align them with the chosen error semantics.
- Add focused tests for upstream 500, upstream invalid stream body, and
  missing upstream body.

## Session Slices

- 6A - Stream error contract and OpenAI-compatible path. Add the typed
  provider error frame or pre-header failure path, serialize it in
  `/api/v1/generate/completion`, and update OpenAI stream handling for
  upstream non-OK, invalid stream body, and missing body cases.
- 6B - Anthropic, Mistral, and Gemini stream failures. Apply the chosen
  6A semantics to these SSE-style stream providers and add provider or
  route tests that prove they cannot finish as empty success streams.
- 6C - Ollama and final stream audit. Apply the chosen semantics to the
  NDJSON stream path, rerun a grep over all `run*Stream` providers for
  silent `return` branches, and close any remaining gaps found by that
  audit.

## Exit Criteria

- `/api/v1/generate/completion` streaming callers receive a typed error
  event or non-200 HTTP response for upstream failures.
- No provider stream can silently finish as a successful empty
  generation after an upstream failure.
- Existing token and done SSE event names remain compatible with current
  browser consumers unless tests and adapters are updated together.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```

## References

- Original phase: `docs/fastify/phases/phase-6-server-generation.md`
- OpenAI stream failure return: `server/fastify/src/generation/openai.ts:256`
- SSE frame serialization: `server/fastify/src/routes/generation.ts:312`
- Stream pipe: `server/fastify/src/routes/generation.ts:333`
