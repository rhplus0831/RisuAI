# sendChat Status

Date: 2026-05-24

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
- Behind `db.useServerPromptAssembly`, send-like calls can consume the
  server prompt payload, apply message/scriptstate patches, and then
  continue into local browser provider dispatch.
- The gate defaults off and is independent of `db.useServerGeneration`.
- `/chat` can now transport server provider chunks through the chat SSE
  `token`, `error`, and `done` events via an internal server-only
  dispatcher hook. Browser send orchestration still does not consume those
  events.

## Active Boundary

The next risky boundary is server send orchestration. Browser provider
dispatch remains local; 7-12d-iii-b needs to connect the real server
dispatch path, `generationId`, reroll accumulation, enriched `done`, and
fixture coverage.

Track that work in [`next-steps.md`](next-steps.md) and
[`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md).

## Guardrails

- Local `sendChat` fixture sweep.
- Server-backed provider parity sweep.
- Fastify generation route tests.
- `pnpm check`, `pnpm test`, `pnpm api:test`, and `pnpm build` before
  closing a slice.

## References

- Archived detailed status:
  [`../phases-completed/status-sendchat-2026-05-24.md`](../phases-completed/status-sendchat-2026-05-24.md)
- Archived Phase 5 slicing:
  [`../phases-completed/phase-5-sendchat-slicing.md`](../phases-completed/phase-5-sendchat-slicing.md)
- Fixture coverage: [`../coverage/sendchat-fixtures.md`](../coverage/sendchat-fixtures.md)
