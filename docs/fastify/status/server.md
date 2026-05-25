# Server Status

Date: 2026-05-25

This file tracks the current Fastify server surface. Historical server
logs and landed provider lists are archived or covered by the coverage
docs.

## Current State

- Fastify is the live server path. Express and the old `runserver` script
  are deleted.
- Auth, health, storage, asset, backup, proxy, hub passthrough,
  stream-job, and crypto routes are on Fastify.
- `POST /api/v1/generate/completion` owns the Phase 6 provider dispatch
  surface and normalized SSE envelope.
- `POST /api/v1/generate/chat` owns Phase 7 prompt assembly SSE events.
  It streams assembled prompt payloads and metadata, builds an internal
  typed mutation payload on `AssembleResult`, emits that payload as
  `message_patch`, persists `varChanged` for send-like requests, and can
  dispatch production providers through the chat `token`, `error`, and
  enriched `done` events when `db.useServerPromptAssembly` is enabled.
- `POST /api/v1/generate/preview-prompt` is the JSON shortcut for preview
  prompt assembly.
- Memory routes are auth-gated: `POST /api/v1/memory/jobs`,
  `GET /api/v1/memory/jobs`, `DELETE /api/v1/memory/jobs/:id`,
  `GET /api/v1/memory/chunks/:chatId`, and
  `GET /api/v1/memory/summaries/:chatId?model=...`.
- The memory worker has real default handlers for `summarize` and
  `embed`; the reserved `chunk` job kind still uses the default no-op
  handler until the live chunk-planning hook lands.

## Current Server Work

Phase 7 prompt assembly is closed. Phase 8 Hypa V3 memory is active; the
next concrete pickup is the 8-8 live chunk-planning hook in
[`next-steps.md`](next-steps.md).

## Watch Points

- Hub passthrough remains auth-gated; browser-loaded hub resources that
  cannot send `risu-auth` may need session-cookie support later.
- Ooba OAI-compatible, NovelAI text, and NovelList remain deferred until
  server-side prompt string flattening is available.
- Hypa V3 memory is in Phase 8; the live path still needs to call the
  chunk planner before Phase 8 can close.
- Browser plugin / Lua execution and image generation side effects remain
  outside the prompt assembly closeout.

## References

- Archived detailed status:
  [`../phases-completed/status-server-2026-05-24.md`](../phases-completed/status-server-2026-05-24.md)
- Provider matrix: [`../coverage/providers.md`](../coverage/providers.md)
- Server route coverage: [`../coverage/server-routes.md`](../coverage/server-routes.md)
- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
