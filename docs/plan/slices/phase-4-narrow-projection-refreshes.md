# Phase 4: Narrow Projection Refreshes

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-4-narrow-projection-refreshes)

Status: planning slice.

Goal: reduce the amount of projected data shipped after message/generation
events.

## Implementation Slices

### 4.1 Event Identity Audit

- Audit message and generation events for existing `id` and `parentId`
  identity.
- Prefer extending existing event identity over adding a second invalidation
  stream.
- For `generation.persisted`, identify the minimum event data needed for the
  client to refresh only the affected chat.

Done when the server can distinguish narrowable events from broad invalidation
events.

### 4.2 Narrow Chat Projection

- Add a narrower projection response for message/generation events.
- Support refreshing one chat's metadata and/or hydrated messages by id.
- Keep projection narrowing as a read-side optimization only.
- Avoid changing command semantics.

Done when a single-chat refresh path exists without replacing the broader
projection contract.

### 4.3 Client Refresh Routing

- Route message/generation events with enough identity to the narrow refresh
  path.
- Keep open-chat hydration refreshed when a projection re-stubs messages.
- Avoid replacing the whole `characters` array for a narrow
  `generation.persisted` event.

Done when the client can refresh only the affected chat for narrowable events.

### 4.4 Fallback Compatibility

- Keep the current `characters` fallback for events without sufficient identity.
- Keep broad resources on `mode: full` or existing top-level field refresh.
- Browser-smoke event refresh if the projection shape changes.

Done when unknown or broad events retain current behavior.

## Acceptance

- A generation-persisted event for one chat no longer needs to replace the whole
  `characters` array when the event carries enough identity.
- Unknown or broad resources still use `mode: full` or existing top-level field
  refresh.
- Open-chat hydration is still refreshed when a projection re-stubs messages.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
- Browser smoke for event refresh if the projection shape changes.
