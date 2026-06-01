# Sprawling Resource Full Bootstrap Measurement

Status: candidate; analysis only, not implemented.

## Source Anchors

- `server/fastify/src/routes/projection.ts`
- `src/ts/bootstrap.ts`
- `src/ts/server/projection.ts`
- `src/ts/server/projectionResync.ts`
- `src/ts/server/protocolDiagnostics.ts`

## Why This Exists

`resourceProjectionFields()` intentionally omits resources whose projected
state sprawls across many top-level settings or server-owned state. For those
resources, the projection route returns `mode: "full"` and the client performs
a full bootstrap resync. That is correct and self-healing, but expensive for
large projections.

Known sprawling or broad resources include `settings`, `state`,
`pluginStorage`, and unknown future resources.

## Candidate Scope

Measurement-only first pass:

- Extend diagnostics or focused tests to count which resource names trigger
  `projection-full-mode` full bootstrap fallback.
- Capture payload-size/request-count evidence for representative
  `settings.updated`, `pluginStorage.updated`, `state.restored`, and unknown
  resource events.
- Decide whether any single resource can be made targeted without widening
  command semantics or under-applying projection state.
- Keep full-bootstrap fallback as the default for resources without a precise
  field map.

## Protocol Behavior

- No event-shape, revision, or replay behavior changes are allowed in the
  measurement pass.
- A later targeted-resource slice must name the exact top-level fields, masking
  behavior, resync fallback, and focused tests before runtime changes.
- `state.restored` should remain a full bootstrap unless a separate restore
  projection contract is designed.

## Rollback And Resync Behavior

The current fallback remains full bootstrap. Measurement must not suppress
resyncs, coalesce command events, or change the cached revision cursor.

## Done When

- Diagnostics show whether expensive full-bootstrap fallback is frequent enough
  to justify targeted work.
- A later implementation candidate, if any, names one resource family and a
  precise field projection contract.
- Unexpected full-bootstrap reason coverage remains intact.

## Proof Commands

- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts`
- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
