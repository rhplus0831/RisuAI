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
- Server assembly now produces a typed internal mutation payload for
  user-message appends, start-trigger / run-var message replacements,
  chat-var deltas, and `additonalSysPrompt` rows.
- Send / continue / regenerate still use local assembly and local
  provider dispatch until the 7-12d `message_patch` applier and streaming
  chain land.
- The gate defaults off and is independent of `db.useServerGeneration`.

## Active Boundary

The next risky boundary is the browser mutation applier. Server assembly
has the typed deltas internally, but `/chat` still needs to emit
`message_patch` and the SPA must apply those patches before local
dispatch.

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
