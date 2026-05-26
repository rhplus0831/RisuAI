# Phase 6 Alpha Follow-Up - Server-Side Generation

Date: 2026-05-27

Status: reopened by alpha audit.

## Goal

Provider streaming must not convert malformed or truncated upstream
streams into successful empty generations. Invalid provider stream
bodies should surface as typed provider error frames or fail before SSE
headers are committed.

## Audit Finding

Typed provider error frames now exist for non-OK responses, missing
bodies, fetch/read failures, and invalid JSON in complete frames.
However, unterminated SSE tails are still ignored by several providers.

Example reproduction from the audit against OpenAI-compatible streaming:
an upstream body of `data: {nope}` without the terminating blank line
returned `[{ "kind": "done", "finishReason": "stop" }]`.

Code surfaces:

- OpenAI-compatible processes complete `\n\n` blocks:
  `server/fastify/src/generation/openai.ts:317`
- OpenAI-compatible yields `done` at EOF regardless of leftover buffer:
  `server/fastify/src/generation/openai.ts:352`
- Anthropic complete-block parsing:
  `server/fastify/src/generation/anthropic.ts:297`
- Mistral complete-block parsing:
  `server/fastify/src/generation/mistral.ts:354`
- Gemini complete-block parsing:
  `server/fastify/src/generation/gemini.ts:418`

## Tasks

- Add EOF leftover-buffer handling for SSE providers. If the leftover
  tail is non-whitespace/non-comment data, emit a typed provider error
  for an invalid or truncated stream.
- Cover OpenAI-compatible, Anthropic, Mistral, and Gemini truncated-SSE
  tails with focused tests.
- Confirm valid streams with normal `[DONE]`, `message_stop`, or
  provider-specific terminal events still yield `done`.

## Exit Criteria

- No provider stream can silently finish as successful `done` after a
  malformed unterminated SSE tail.
- Browser-facing `/api/v1/generate/completion` receives the same typed
  error event shape used by previous Phase 6 follow-up work.
- Focused tests prove both truncated-tail errors and valid terminal
  streams.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/openai.test.ts server/fastify/__tests__/anthropic.test.ts server/fastify/__tests__/mistral.test.ts server/fastify/__tests__/gemini.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```

## References

- Original phase: `docs/fastify/phases/phase-6-server-generation.md`
- Completed follow-up: `docs/fastify-followup/phases/phase-6-generation-followup.md`
