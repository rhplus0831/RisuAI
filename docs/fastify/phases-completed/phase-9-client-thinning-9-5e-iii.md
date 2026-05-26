# Phase 9-5e-iii - Guard Audit Closeout

Date: 2026-05-26

Status: complete.

## Summary

- Enabled the Fastify projection write guard across the server-backed
  sendChat fixture path for both `/completion` and `/chat` dispatch flows.
- Routed entry-context optimistic writes for `lastInteraction` and message
  id backfill through trusted projection scopes while keeping existing
  character/message command dispatch where stable ids exist.
- Routed server `/chat` patch replay, terminal restoration, response
  streaming/non-streaming display updates, output-trigger replay, stage-4
  generation metadata, and `lastMemory` fixture/runtime writes through
  trusted projection scopes.
- Added command routing for `lastMemory` when the chat has a stable id; no
  new command endpoints were introduced.
- Left Tauri/local behavior untouched and did not fold storage/provider
  gating, server-side `.risu` import/export, asset byte work, server-side
  plugin execution, or surgical event patching into this audit.

## Classification

- Command-owned optimistic writes: sendChat entry-context
  `lastInteraction`, message id backfill, server message-patch replay,
  terminal restoration, generation response rows, output-trigger replay,
  and stage-4 generation metadata.
- Durable metadata with an existing command: `lastMemory` uses the existing
  chat metadata patch command when the chat has a stable id.
- Fixture/runtime-only local projection state: streaming flags,
  `reloadKeys`, and no-id fixture `lastMemory` updates remain local
  trusted projection writes.
- Follow-up residual slices: none found during the guarded server-backed
  fixture audit.

## Verification

- `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
  - 27 tests passed.
- `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/process/__tests__/sendChatContext.test.ts`
  - 22 tests passed.
- `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChatContext.test.ts`
  - 49 tests passed.
- `pnpm exec vitest run src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/stage4Finalize.test.ts`
  - 40 tests passed.
- `pnpm check`
  - 0 Svelte errors and 0 warnings.

## Follow-Up

Continue with **9-6a - Server-backed persistence gate**. Stop
Fastify-served web startup, save, and backup maintenance paths from
initializing or writing AutoStorage, OPFS, NodeStorage, or localForage
while keeping Tauri/local storage behavior unchanged.
