# Phase 7 Route-Backed Fixture Coverage - 2026-05-27

Slice 7E landed.

## What Changed

- Added an in-process Fastify harness to
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts` so
  selected browser fixture paths call the real `/api/v1/generate/chat`
  route through `app.inject`.
- Covered server-backed send, continue, regenerate, preview, and
  preview-prompt fixture paths through real route validation and SSE
  handling.
- Kept the smaller mocked `/chat` adapter replay tests for rollback,
  Hypa V3 progress side effects, dispatch failure replay, and TTS event
  behavior.

## Notes

- The route-backed client fixture harness stubs only provider output and
  command persistence side effects. Prompt assembly, mode validation,
  message patch delivery, and browser replay still pass through the real
  Fastify chat route.
- The historical browser fixture databases are partial test fixtures, so
  the harness normalizes the chat id and required prompt defaults before
  importing them into the Fastify store.

## Verification

```bash
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/providerTransport.test.ts
```

## Next Pickup

Phase 8 Slice 8A is now the default pickup: stable custom embedding job
model key.
