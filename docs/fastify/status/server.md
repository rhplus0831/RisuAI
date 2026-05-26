# Server Status

Date: 2026-05-26

This file tracks the current Fastify server surface. Historical server
logs and landed provider lists are archived or covered by the coverage
docs.

## Current State

- Fastify is the live server path. Express and the old `runserver` script
  are deleted.
- Auth, health, storage, asset, backup, proxy, hub passthrough,
  stream-job, and crypto routes are on Fastify.
- Backup restore emits a `state.restored` command-event payload after the
  repository revision bump so server-backed browsers re-fetch bootstrap.
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
- Command routes are live under `/api/v1/commands/*` for settings,
  bot presets, prompt settings/items, personas, translator presets,
  loadouts, characters, chats, chat folders, messages, generation
  persistence, chat scriptstate, lorebook collections, script/trigger
  definitions, module records/enablement, asset references through owning
  resources, plugin records/configuration, and plugin storage.
  Implemented families use `baseRevision` / 409 conflict handling and
  emit their mapped command event.
- `GET /api/v1/events` is the auth-gated Phase 9 command-event SSE
  stream. It sends committed command events as `event: command` frames
  with `{ type, revision, resource, id?, parentId? }` payloads for
  browser projection invalidation.
- Memory routes are auth-gated: `POST /api/v1/memory/jobs`,
  `GET /api/v1/memory/jobs`, `DELETE /api/v1/memory/jobs/:id`,
  `GET /api/v1/memory/chunks/:chatId`, and
  `GET /api/v1/memory/summaries/:chatId?model=...`.
- The memory worker has real default handlers for `summarize` and
  `embed`; the reserved `chunk` job kind remains no-op by design because
  live chunk planning runs from prompt assembly context.

## Current Server Work

Phase 8 Hypa V3 memory is closed. Phase 9 client thinning is active; the
current pickup is 9-6e, provider secret masking in
[`next-steps.md`](next-steps.md).

## Watch Points

- Hub passthrough remains auth-gated; browser-loaded hub resources that
  cannot send `risu-auth` may need session-cookie support later.
- Ooba OAI-compatible, NovelAI text, and NovelList remain deferred until
  server-side prompt string flattening is available.
- Browser plugin / Lua execution and image generation side effects remain
  outside the prompt assembly closeout.

## References

- Archived detailed status:
  [`../phases-completed/status-server-2026-05-24.md`](../phases-completed/status-server-2026-05-24.md)
- Provider matrix: [`../coverage/providers.md`](../coverage/providers.md)
- Server route coverage: [`../coverage/server-routes.md`](../coverage/server-routes.md)
- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
