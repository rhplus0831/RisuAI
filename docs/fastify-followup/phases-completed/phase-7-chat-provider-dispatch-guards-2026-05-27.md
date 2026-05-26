# Phase 7 Slice 7C - Chat Provider Dispatch Guards

Date: 2026-05-27

## Scope

- Added explicit `/chat` unsupported-provider guards before production
  server provider dispatch.
- Blocked NovelAI text, NovelList, Ooba OpenAI-compatible reverse proxy,
  plugin providers, local WebLLM models, and unknown OpenAI-compatible
  model ids from falling through to OpenAI dispatch.
- Kept the route behavior SSE-native: assembly still streams prompt
  metadata, then dispatch rejects with an explicit error and terminal
  done frame.

## Tests

- Added route coverage proving each guarded provider family emits
  `prompt`, `message_patch`, `info`, `error`, and `done` without token
  events.
- Covered the unknown OpenAI-compatible fallback so unrecognized model
  ids cannot silently use `provider = "openai"`.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts
```

## Historical Next

At this slice closeout, 7D was next: emit assembly-produced
`message_patch` and restoration metadata for stop-trigger aborts before
the terminal error or done frame.
