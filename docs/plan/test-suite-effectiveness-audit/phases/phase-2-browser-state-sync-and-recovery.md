# Phase 2: Browser State Synchronization And Recovery

Status: Pending; depends on Phases 0-1.

## Objective

Audit whether browser-side tests protect durable intent, authoritative resource
state, writer/observer ownership, replay, recovery, and stale-work fencing
against the failures users can actually experience.

## Scope

- Bootstrap and startup readiness.
- Active writer sessions, observer projection, denial, takeover, and promotion.
- Encrypted pending-mutation outbox, dependencies, replay, terminal rejection,
  and cross-tab settlement.
- Resource hydration, invalidation, refresh, retained projections, replacement
  ownership, and lifecycle recovery.
- Route/resource loading, event gaps, response loss, offline behavior, reload,
  service worker, and startup/recovery browser matrices.
- Browser-side command dispatch only where the primary contract is durable
  intent/recovery; entity mutation semantics belong to Phase 3.

Primary discovery guide:
[`docs/tests/browser-state-sync-and-recovery.md`](../../../tests/browser-state-sync-and-recovery.md).

## Audit Questions

- Do tests distinguish accepted, queued, failed, replayed, and rejected intent?
- Are stable mutation identity and exactly-once effects proved under response
  loss, retry, restart, and cross-tab changes?
- Do stale async completions fail closed after target, route, writer, or epoch
  changes?
- Are browser storage and locking semantics over-mocked in ways that hide quota,
  upgrade, multi-tab, or reload behavior?
- Does lower-layer recovery evidence have sufficient visible/browser companion
  proof for user-facing states?

## Required Outputs

- Contract/disposition map for every Phase 2 inventory row.
- Explicit defense-in-depth map from pure state machines through DOM and browser
  recovery journeys.
- Findings for false-success states, self-fulfilling storage/network mocks,
  fixed-timing races, missing reload/cross-tab outcomes, and obsolete bridge
  assumptions.
- Strengthened or replacement proof for every accepted removal/merge.

## Exit Criteria

- Every state/recovery test has a disposition and named production owner.
- Unique response-loss, offline, event-gap, writer-transfer, and reload contracts
  remain represented at faithful layers.
- Critical/High findings are fixed or explicitly routed with owner and gate.
- No removal weakens outbox, replay, stale-target, or visible recovery coverage.
- Exact count delta and residual browser gaps are recorded.

## Validation

- Focused owning frontend tests
- Relevant startup/recovery Playwright specs
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:smoke`
- `pnpm coverage:ui-map` when mapped visible-state owners change
- `pnpm format:check`
- `git diff --check`
