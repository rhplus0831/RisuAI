# Phase 7 Slice 7D - Stop-Trigger Mutation Payload Delivery

Date: 2026-05-27

## Scope

- Emitted assembly-produced `message_patch` events on the `/chat`
  stop-trigger abort path before the terminal `error` and `done` frames.
- Included assembly restoration metadata on the stop-trigger error event.
- Kept pre-error patches visible in the browser `/chat` adapters and
  replayed them in `sendChat` before surfacing the stop-trigger error.

## Tests

- Added Fastify route coverage for a start trigger that mutates chat
  variables and messages before stopping prompt assembly.
- Added browser adapter coverage for pre-error `message_patch` and
  restoration payload delivery.
- Added `sendChat` coverage proving stop-trigger patches are applied
  before the server assembly error is reported.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/assemble.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
```

## Next

Continue with 7E: replace seeded prompt snapshots with real Fastify
route-backed fixture coverage for send, continue, regenerate, preview,
and preview-prompt.
