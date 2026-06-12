# Sprawling Resource Full Bootstrap Measurement

Status: implemented measurement; no runtime narrowing yet.

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

## Implemented Scope

The measurement is opt-in and changes no route behavior:

- The server `projection_response` metric now records `mode` for every
  projection response and a `fallbackClass` (`sprawling` | `unknown`) for the
  resource-level `mode: 'full'` fallback. `settings`, `state`, and
  `pluginStorage` classify as `sprawling`; any other unlisted resource is
  `unknown`. The classification is exported as `fullBootstrapFallbackClass()`
  from `server/fastify/src/routes/projection.ts`.
- The client protocol diagnostics gained
  `fullBootstrapResyncResources: Record<string, number>`, populated through
  `recordFullBootstrapResync(reason, resource?)`. `forceServerProjectionResync`
  forwards the triggering command-event resource for the event-driven resyncs
  (`no-baseline`, `projection-full-mode`, `projection-error`, `revision-gap`),
  so the cost of each fallback can be attributed per resource. Restore and
  replay-unavailable resyncs have no single resource and stay unattributed.

### Findings

- The `mode: 'full'` projection _response_ payload is tiny (47-56 bytes for
  `settings`/`state`/`pluginStorage`/unknown in the focused fixture): it only
  tells the client to bootstrap. The real cost of a sprawling-resource fallback
  is the subsequent full bootstrap the client performs, not the projection
  route response. The per-resource client diagnostic is therefore the signal
  that gates any later targeted-resource work.
- No runtime narrowing is justified from the focused fixtures alone. A later
  targeted-resource slice must show, from the per-resource fallback counts on a
  real corpus, that one named resource family is both frequent and expensive
  before naming its exact field projection contract.

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
- `RISU_PROTOCOL_METRICS=1 RISU_PROJECTION_FULL_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/projection.test.ts --reporter verbose`
