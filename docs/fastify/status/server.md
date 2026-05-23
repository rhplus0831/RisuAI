# Server Status

Date: 2026-05-24

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
  It currently streams assembled prompt payloads and metadata, but not
  provider output for the browser send path.
- `POST /api/v1/generate/preview-prompt` is the JSON shortcut for preview
  prompt assembly.

## Current Server Work

Phase 7 needs the `/chat` route to expose send-time mutations, then carry
provider chunks and dispatch metadata. The next concrete slice is 7-12d-i
in [`next-steps.md`](next-steps.md).

## Watch Points

- Hub passthrough remains auth-gated; browser-loaded hub resources that
  cannot send `risu-auth` may need session-cookie support later.
- Ooba OAI-compatible, NovelAI text, and NovelList remain deferred until
  server-side prompt string flattening is available.
- Hypa V3 memory jobs belong to Phase 8, not the current server dispatch
  work.

## References

- Archived detailed status:
  [`../phases-completed/status-server-2026-05-24.md`](../phases-completed/status-server-2026-05-24.md)
- Provider matrix: [`../coverage/providers.md`](../coverage/providers.md)
- Server route coverage: [`../coverage/server-routes.md`](../coverage/server-routes.md)
- Active phase: [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
