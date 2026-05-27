# Completed Phase Archive

Date: 2026-05-27

Archive of completed phase plans, landed slice tables, and historical
status logs. Useful for auditing and archaeology, not for tracking
current work.

Archived notes preserve the wording that was true when each slice
landed. Mentions of non-Fastify implementations in this directory are
historical no-port references, not current implementation guidance.

## Phase Scope Documents

Moved here after all phases closed. These contain the goals, boundaries,
exit criteria, and closeout summaries for each phase.

| Phase | Archive |
|-------|---------|
| 0 - Removals | [`phase-0-removals-scope.md`](phase-0-removals-scope.md) |
| 0 - Removals follow-up | [`phase-0-removals-followup.md`](phase-0-removals-followup.md) |
| 1 - Foundation | [`phase-1-foundation-scope.md`](phase-1-foundation-scope.md) |
| 2 - Storage | [`phase-2-storage-scope.md`](phase-2-storage-scope.md) |
| 3 - Proxy | [`phase-3-proxy-scope.md`](phase-3-proxy-scope.md) |
| 3 - Proxy follow-up | [`phase-3-proxy-followup.md`](phase-3-proxy-followup.md) |
| 4 - sendChat tests | [`phase-4-sendchat-tests-scope.md`](phase-4-sendchat-tests-scope.md) |
| 5 - sendChat extraction | [`phase-5-sendchat-extract-scope.md`](phase-5-sendchat-extract-scope.md) |
| 6 - Server-side generation | [`phase-6-server-generation-scope.md`](phase-6-server-generation-scope.md) |
| 6 - Generation follow-up | [`phase-6-generation-followup.md`](phase-6-generation-followup.md) |
| 7 - Prompt assembly | [`phase-7-prompt-assembly.md`](phase-7-prompt-assembly.md) |
| 7 - Prompt assembly follow-up | [`phase-7-prompt-assembly-followup.md`](phase-7-prompt-assembly-followup.md) |
| 8 - Hypa V3 memory | [`phase-8-memory.md`](phase-8-memory.md) |
| 8 - Memory follow-up | [`phase-8-memory-followup.md`](phase-8-memory-followup.md) |
| 9 - Client thinning | [`phase-9-client-thinning.md`](phase-9-client-thinning.md) |
| 9 - Client thinning follow-up | [`phase-9-client-thinning-followup.md`](phase-9-client-thinning-followup.md) |
| 9 - Trigger projection writes | [`phase-9-trigger-projection-writes.md`](phase-9-trigger-projection-writes.md) |

## Fastify-Only Lockdown

A follow-up effort after Phases 0-9 removed the residual non-Fastify
runtime surfaces (Hono adapters, desktop/mobile wrappers, service
worker, local browser persistence, legacy client endpoints). The full
`docs/fastify-only/` workspace was condensed into a single archive:

- [`fastify-only.md`](fastify-only.md) — goals, per-phase removals,
  guard tests, and final verification.

## No-Port Runtime Removal

Tauri / Desktop support was explicitly removed in commit `a8dd411c`
(2026-05-27). All `@tauri-apps/*` dependencies, Tauri config, and
desktop-specific code paths are deleted. The web client only runs
against the Fastify server; non-Fastify runtime references here are
no-port history.

## Phase Closeout Slice Logs

Detailed per-slice closeout notes. Each file documents what landed in
a single implementation session.

### Phase 0
- [`phase-0-removals.md`](phase-0-removals.md) - Full removal plan.
- [`phase-0-google-drive-public-artifact-removal-2026-05-27.md`](phase-0-google-drive-public-artifact-removal-2026-05-27.md)

### Phase 3
- [`phase-3-proxy.md`](phase-3-proxy.md) - Proxy closeout.
- [`phase-3-hub-response-headers.md`](phase-3-hub-response-headers.md)
- [`phase-3-proxy-response-header-alignment-2026-05-27.md`](phase-3-proxy-response-header-alignment-2026-05-27.md)

### Phase 5
- [`phase-5-sendchat-extract.md`](phase-5-sendchat-extract.md)
- [`phase-5-sendchat-slicing.md`](phase-5-sendchat-slicing.md)
- [`phase-5-sendchat-boundary-alpha.md`](phase-5-sendchat-boundary-alpha.md)

### Phase 6
- [`phase-6-server-generation.md`](phase-6-server-generation.md)
- [`phase-6-generation-sse-tails.md`](phase-6-generation-sse-tails.md)
- [`phase-6-sse-line-endings.md`](phase-6-sse-line-endings.md)
- [`phase-6-ollama-stream-errors-2026-05-27.md`](phase-6-ollama-stream-errors-2026-05-27.md)
- [`phase-6-sse-provider-stream-errors-2026-05-27.md`](phase-6-sse-provider-stream-errors-2026-05-27.md)
- [`phase-6-stream-error-contract-openai-2026-05-27.md`](phase-6-stream-error-contract-openai-2026-05-27.md)

### Phase 7
- [`phase-7-prompt-assembly-through-7-12c.md`](phase-7-prompt-assembly-through-7-12c.md)
- [`phase-7-prompt-assembly-7-12d-i.md`](phase-7-prompt-assembly-7-12d-i.md) through [`phase-7-prompt-assembly-7-12d-iv.md`](phase-7-prompt-assembly-7-12d-iv.md)
- [`phase-7-prompt-assembly-closeout.md`](phase-7-prompt-assembly-closeout.md)
- [`phase-7-browser-regenerate-request-wiring-2026-05-27.md`](phase-7-browser-regenerate-request-wiring-2026-05-27.md)
- [`phase-7-chat-provider-dispatch-guards-2026-05-27.md`](phase-7-chat-provider-dispatch-guards-2026-05-27.md)
- [`phase-7-server-regenerate-assembly-semantics-2026-05-27.md`](phase-7-server-regenerate-assembly-semantics-2026-05-27.md)
- [`phase-7-stop-trigger-mutation-payload-delivery-2026-05-27.md`](phase-7-stop-trigger-mutation-payload-delivery-2026-05-27.md)
- [`phase-7-route-backed-fixture-coverage-2026-05-27.md`](phase-7-route-backed-fixture-coverage-2026-05-27.md)

### Phase 8
- [`phase-8-memory-8-1a-i.md`](phase-8-memory-8-1a-i.md) through [`phase-8-memory-8-9.md`](phase-8-memory-8-9.md) (35 slice files)
- [`phase-8-memory-event-isolation.md`](phase-8-memory-event-isolation.md)
- [`phase-8-custom-embedding-routing-2026-05-27.md`](phase-8-custom-embedding-routing-2026-05-27.md)
- [`phase-8-memory-progress-events-2026-05-27.md`](phase-8-memory-progress-events-2026-05-27.md)
- [`phase-8-missing-summary-diagnostics-2026-05-27.md`](phase-8-missing-summary-diagnostics-2026-05-27.md)

### Phase 9
- [`phase-9-client-thinning-9-0.md`](phase-9-client-thinning-9-0.md) through [`phase-9-client-thinning-9-9e.md`](phase-9-client-thinning-9-9e.md) (55 slice files)
- [`phase-9-projection-write-tails-9b.md`](phase-9-projection-write-tails-9b.md)
- [`phase-9-trigger-scalar-projection-writes.md`](phase-9-trigger-scalar-projection-writes.md)
- [`phase-9-trigger-collection-chat-projection-writes.md`](phase-9-trigger-collection-chat-projection-writes.md)
- [`phase-9-bot-parameter-direct-write-2026-05-26.md`](phase-9-bot-parameter-direct-write-2026-05-26.md) and other dated slices

### Cross-phase
- [`broad-closeout-typecheck-alpha.md`](broad-closeout-typecheck-alpha.md)
- [`leftover-audit-closeout.md`](leftover-audit-closeout.md)

## Historical Status Logs

| Archive | Former location |
|---------|----------------|
| [`status-next-steps-through-7-12c.md`](status-next-steps-through-7-12c.md) | `status/next-steps.md` |
| [`status-removals.md`](status-removals.md) | `status/removals.md` |
| [`status-sendchat-2026-05-24.md`](status-sendchat-2026-05-24.md) | `status/sendchat.md` |
| [`status-server-2026-05-24.md`](status-server-2026-05-24.md) | `status/server.md` |
| [`status-followup-closeout.md`](status-followup-closeout.md) | `status.md` follow-up |
| [`status-followup-next-steps.md`](status-followup-next-steps.md) | `status/next-steps.md` follow-up |
| [`status-migration-closeout.md`](status-migration-closeout.md) | `status.md` closeout |
| [`status-next-steps-migration-closeout.md`](status-next-steps-migration-closeout.md) | `status/next-steps.md` closeout |
| [`overview.md`](overview.md) | `status/overview.md` |
| [`removals.md`](removals.md) | `status/removals.md` |
| [`sendchat-slicing.md`](sendchat-slicing.md) | `status/sendchat-slicing.md` |
