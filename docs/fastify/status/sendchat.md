# sendChat Status

Date: 2026-05-26

This file tracks the current `sendChat` boundary. Historical extraction
and fixture inventories are archived or covered by the coverage docs.

## Current State

- Phase 5 extraction is closed. The coordinator remains in
  `src/ts/process/index.svelte.ts`, with prompt assembly, request
  budgeting, dispatch, response orchestration, Stage 4 closeout, and
  entry-context setup split into helper modules.
- Phase 7 preview paths are server-backed behind
  `db.useServerPromptAssembly`: `preview` fills `previewFormated`, and
  `previewPrompt` fills `previewBody` from `/api/v1/generate/chat`.
- Server assembly now emits a typed `message_patch` payload for
  user-message appends, start-trigger / run-var message replacements,
  chat-var deltas, and `additonalSysPrompt` rows.
- Behind `db.useServerPromptAssembly`, send-like calls consume the server
  prompt payload, apply message/scriptstate patches, and then consume the
  `/chat` provider token stream instead of calling local browser provider
  dispatch.
- The gate defaults off and is independent of `db.useServerGeneration`.
- `/chat` now emits `info.generationId`, `info.generationInfo`, provider
  `token` events, terminal `error` events, and enriched terminal `done`
  events for server-dispatched sends.

## Active Boundary

Phase 7 prompt assembly is closed. Rollback and side effects are covered
for server-dispatched `/chat`: TTS arrives as typed `side_effect` events,
and terminal provider errors can restore the pre-dispatch chat
message/scriptstate snapshot before the existing error path reports the
failure.

Phase 7 closeout detail lives in
[`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md);
Phase 8 memory is closed, and current pickup work is Phase 9 client
thinning in [`next-steps.md`](next-steps.md).

## Guardrails

- Local `sendChat` fixture sweep.
- Server-backed provider parity sweep, including the `/chat` dispatch path
  proving send-like fixtures do not escape to `/api/v1/generate/completion`.
- Fastify generation route tests.
- `pnpm check`, `pnpm test`, `pnpm api:test`, and `pnpm build` before
  closing a slice.

## References

- Archived detailed status:
  [`../phases-completed/status-sendchat-2026-05-24.md`](../phases-completed/status-sendchat-2026-05-24.md)
- Archived Phase 5 slicing:
  [`../phases-completed/phase-5-sendchat-slicing.md`](../phases-completed/phase-5-sendchat-slicing.md)
- Fixture coverage: [`../coverage/sendchat-fixtures.md`](../coverage/sendchat-fixtures.md)
