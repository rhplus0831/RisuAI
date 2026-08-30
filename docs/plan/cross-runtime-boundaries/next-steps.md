# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [browser operation metadata reconciliation
slice](phases/slices/phase-2-route-operation-and-policy-catalog/browser-operation-metadata-reconciliation.md).

1. Inventory route overlap in browser resource, cache, generation, and
   raw-generation caller metadata.
2. Join overlapping entries to stable shared route or durable command operation
   identifiers and record explicit reasons for reviewed non-overlap.
3. Add bidirectional parity checks that reject missing, stale, duplicate, or
   contradictory mappings.
4. Preserve every request, response, cache, stream, retry, persistence, and
   security behavior.
5. Close Phase 2 only after the focused metadata owners and complete affected
   lanes pass.

## Foundations Released

- `@risuai/protocol/route-operation` publishes 103 stable route IDs and reviewed
  transport descriptors at `00e49d880`.
- Fastify owns a separate 103-entry auth/writer policy catalog joined by ID.
- `@risuai/protocol/durable-command-operation` publishes 129 stable retained
  command IDs and exact method/path matchers at `3f275e9dc`.
- Durable generation intent kinds point to the shared submit, cancel, and retry
  route IDs without replacing runtime generation UUIDs.

## Not In This Slice

- Do not move resource caches, outbox storage, replay scheduling,
  authentication, active-writer, credential, rate-limit, host, persistence, or
  handler policy into protocol.
- Do not change routes, request bodies, cache headers, stream behavior, or
  generation UUIDs.
- Do not begin pure-shared-core extraction or broad consumer migration before
  the Phase 2 parity gate closes.

## Handoff

After reconciliation, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), close Phase 2, and open the
first audited leaf candidate for Phase 3 pure shared core.
