# Phase 6 Follow-Up - Server-Side Generation

Date: 2026-05-27

Status: closed again. Slices 6A-6C landed.

## Goal

Make streaming `/api/v1/generate/completion` failures visible and typed
instead of turning upstream failures into empty successful streams.

## Audit Finding

`server/fastify/src/generation/openai.ts:256` returns from the stream
generator when the upstream response is not OK or has no body.
`server/fastify/src/routes/generation.ts:312` serializes only token and
done frames, and `server/fastify/src/routes/generation.ts:333` opens the
stream without mapping provider failures to an SSE error frame. A
streaming upstream failure can therefore become a 200 SSE response with
no useful error.

## Tasks

- [x] Extend the streaming frame contract with a typed provider error frame,
      or fail before writing the SSE headers when the upstream failure is
      known synchronously.
- [x] Update OpenAI-compatible streaming so non-OK and bodyless upstream
      responses surface the upstream status/message.
- [x] Audit remaining streaming providers for the same silent-return pattern
      and align them with the chosen error semantics.
- [x] Add focused tests for upstream 500, upstream invalid stream body,
      and missing upstream body for the remaining streaming providers.

## Session Slices

- 6A - Landed. Stream error contract and OpenAI-compatible path. Added the typed
  provider error frame or pre-header failure path, serialize it in
  `/api/v1/generate/completion`, and update OpenAI stream handling for
  upstream non-OK, invalid stream body, and missing body cases.
- 6B - Landed. Anthropic, Mistral, and Gemini stream failures now use
  the 6A typed error-frame semantics for upstream non-OK responses,
  missing stream bodies, fetch/read failures, and invalid stream JSON.
- 6C - Landed. Ollama NDJSON streaming now uses the 6A typed error-frame
  semantics for upstream non-OK responses, missing stream bodies, fetch/read
  failures, invalid stream JSON, and upstream error chunks. The final
  `run*Stream` audit found no remaining upstream-failure silent returns.

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

- Original phase: `docs/fastify/phases-completed/phase-6-server-generation-scope.md`
- OpenAI stream failure return: `server/fastify/src/generation/openai.ts:256`
- SSE frame serialization: `server/fastify/src/routes/generation.ts:312`
- Stream pipe: `server/fastify/src/routes/generation.ts:333`
