# Phase 7 Slice 7A - Browser Regenerate Request Wiring

Date: 2026-05-27

## Scope

- Added a `regenerateMessageId` sendChat intent field for browser
  server-backed prompt assembly.
- Updated the server-assembly mode selector to send
  `mode: "regenerate"` with the target message id instead of falling
  through to `send`.
- Threaded the reroll UI's removed assistant message id into sendChat
  before trimming local messages.
- Extended the `/chat` test fetch stub and focused client tests to pin
  the regenerate request body.

## Deliberate Boundary

Slice 7A only covered browser request wiring. At this slice closeout,
server prompt assembly still did not consume `regenerateMessageId` to
reconstruct local regenerate transcript and mutation semantics; Slice 7B
was next.

## Verification

```bash
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts
pnpm exec vitest run src/ts/process/__tests__/sendChat.serverPreview.test.ts
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts
```
