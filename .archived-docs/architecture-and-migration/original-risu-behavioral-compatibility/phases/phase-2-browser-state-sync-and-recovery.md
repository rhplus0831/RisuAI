# Phase 2 — Browser State Synchronization And Recovery

Status: Complete
Depends on: Phase 1
Completed at Fastify: `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74`

## Objective

Verify that the Fastify writer/observer and server-authoritative state model
preserves the original logical results across bootstrap, mutation, navigation,
reload, multi-tab observation, loss, replay, and recovery.

## Audit Questions

- Do bootstrap and hydration preserve defaults, legacy shapes, identity,
  ordering, selection, and absent values?
- Do optimistic writes, outbox replay, receipts, invalidations, and replacement
  converge on the same logical state after success, rejection, disconnect, and
  restart?
- Can stale completion, rapid repeated action, writer takeover, or target
  disappearance apply a result to the wrong chat/entity?
- Do observer tabs show timely, ordered outcomes without becoming hidden writers?
- Does reload recover terminal, partially streamed, queued, and failed state
  without duplication or loss?

## Required Outputs

- Inventory of bootstrap/projected resources, writer commands, observer events,
  hydration/replacement rules, and recovery paths.
- Structural ownership gates for resource/event/command vocabularies.
- Deterministic race and fault fixtures for replay, response loss, reconnect,
  restart, target deletion, and cross-chat navigation.
- Built-browser multi-tab/reload journeys for user-visible outcomes.
- Findings and signed decisions for deliberate server-authoritative differences.

## Exit Criteria

- Every in-scope state path converges or has a signed visible divergence.
- No success/failure can silently lose, duplicate, mis-target, or resurrect
  durable logical state.
- Observer/writer boundaries and unsupported multi-writer behavior are explicit.
- Focused state, browser recovery, current compatibility, and required full
  differential evidence pass.

## Validation

Run owning browser-state and server integration lanes, controlled fault tests,
built-browser reload/multi-tab smoke, compatibility lanes selected by Phase 1,
formatting, and `git diff --check`.

Completed execution record:
[Phase 2 bootstrap, writer, outbox, and recovery](slices/phase-2-browser-state-sync-and-recovery/phase-2-bootstrap-writer-outbox-recovery.md).

## Completion Evidence

- Shell, full-settings, cache, and grouped-setting reads share one strict
  projection normalizer at `3ce85c1f034b3afc493e291f8a8f5e9227064463`;
  valid partial object settings remain intact after the correction at
  `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74`.
- Command-response and SSE parsing preserve durable generation lineage and
  reject malformed optional identity at
  `3ce85c1f034b3afc493e291f8a8f5e9227064463`.
- Existing durable mutation, encrypted outbox, replay, invalidation, lifecycle,
  writer/observer, response-loss, reconnect, takeover, and reload owners were
  re-verified; the legacy projection also passed through the built browser at the
  completion commit.
- Category B rows `ORC-SURFACE-086` through `ORC-SURFACE-088` own the new
  projection, lineage, and recovery assurance surfaces. Historical Category B
  rows `ORC-SURFACE-023` and `ORC-SURFACE-072` are re-verified with no residual.
- The post-correction pinned differential passed at the completion commit: 16
  baseline tests, 18 current/cluster tests, 16 compared cells, 15 governed
  divergences, and healthy cluster 10. Exact focused commands and counts are in
  [`latest-verification.md`](../latest-verification.md).
