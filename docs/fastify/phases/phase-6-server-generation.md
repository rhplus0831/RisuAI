# Phase 6 - Server-Side Generation

Date: 2026-05-24

Status: closed 2026-05-22.

Phase 6 moved provider dispatch behind the auth-gated
`POST /api/v1/generate/completion` route. The route owns the normalized
SSE envelope, the routed provider matrix, and the current server-side
request shaping tests.

Current work: none in Phase 6. Provider paths still waiting on server-side
prompt flattening or fixture demand are tracked by Phase 7 and the
provider coverage matrix.

Completed detail: [`../phases-completed/phase-6-server-generation.md`](../phases-completed/phase-6-server-generation.md).
Provider matrix: [`../coverage/providers.md`](../coverage/providers.md).
