# Phase 6 - Server-Side Generation

Date: 2026-05-27

Status: closed 2026-05-22.

Phase 6 moved provider dispatch behind the auth-gated
`POST /api/v1/generate/completion` route. The route owns the normalized
SSE envelope, the routed provider matrix, and the current server-side
request shaping tests.

Original closeout work is complete. Post-closeout audit work for
streaming provider failure frames closed in
[`phase-6-generation-followup.md`](phase-6-generation-followup.md).
The alpha pass also closed truncated provider SSE-tail handling in
[`../phases-completed/phase-6-generation-sse-tails.md`](../phases-completed/phase-6-generation-sse-tails.md).
Provider paths still waiting on server-side prompt flattening or fixture
demand are tracked in the provider coverage matrix.

Completed detail: [`../phases-completed/phase-6-server-generation.md`](../phases-completed/phase-6-server-generation.md).
Provider matrix: [`../coverage/providers.md`](../coverage/providers.md).
