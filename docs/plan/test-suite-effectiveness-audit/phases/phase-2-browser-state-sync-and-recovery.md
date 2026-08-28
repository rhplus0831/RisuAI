# Phase 2: Browser State Synchronization And Recovery

Status: Complete on 2026-08-29; Phases 0-1 satisfied.

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

## Completed Audit Record

The phase reviewed all 32 original category-B owners and all 782 cases present
when the slice opened. Strengthening added 18 counterexample or lifecycle cases,
so the same owners now collect 800 cases. Thirty-one files are retained as
distinct state/recovery evidence. `src/ts/observer.svelte.test.ts` is retained
but reclassified to category D because it protects DOM/media observation rather
than writer/observer projection state. No file or case was removed or merged.

### Contract And Disposition Map

| Test owner | Cases | Production contract | Disposition |
| --- | ---: | --- | --- |
| `server/fastify/__tests__/activeWriter.test.ts` | 8 | Persisted writer epoch and pre-side-effect Fastify fencing | Keep; strengthened by `TSA-P02-008` |
| `server/fastify/__tests__/bootstrap.test.ts` | 6 | Authenticated bootstrap metadata and observer filtering | Keep; strengthened by `TSA-P02-008` |
| `server/fastify/browser-smoke/startupCachePopulationMatrix.spec.ts` | 1 | Cold/warm small/large startup cache matrix | Keep; strengthened by `TSA-P02-006` |
| `server/fastify/browser-smoke/startupRecoveryIntegrationMatrix.spec.ts` | 7 | Direct links, replay, event gaps, takeover, and optional runtimes | Keep; strengthened by `TSA-P02-006` |
| `server/fastify/browser-smoke/visibleStateRecovery.spec.ts` | 3 | Visible picker, accepted local settlement, and lineage reload recovery | Keep; bounded by `TSA-P02-009` |
| `src/lib/ObserverShell.svelte.test.ts` | 4 | Mounted read-only shell, local navigation, retry, and focus | Keep |
| `src/ts/bootstrap.test.ts` | 177 | Browser startup, events, replay, reconnect, and reconciliation | Keep |
| `src/ts/entryStartup.test.ts` | 4 | Actual main-entry environment ordering and recoverable dynamic load | Keep; strengthened by `TSA-P02-004` |
| `src/ts/observer.svelte.test.ts` | 11 | DOM code controls and BGM observer lifecycle | Reclassify to D with G seam; strengthened by `TSA-P02-003` |
| `src/ts/observerProjectionLifecycle.test.ts` | 3 | Projection discard for replacement, lineage, and auth loss | Keep; strengthened by `TSA-P02-004` |
| `src/ts/observerRouteIntent.test.ts` | 4 | Latest-wins route intent and exact consumption | Keep |
| `src/ts/observerShellFlag.test.ts` | 4 | Build/test/smoke rollout selection and blocked storage | Keep; strengthened by `TSA-P02-004` |
| `src/ts/server/activeWriterSession.test.ts` | 11 | Client writer latch, takeover, cleanup, and reload | Keep; residual in `TSA-P02-009` |
| `src/ts/server/bootstrap.svelte-node.test.ts` | 6 | Writer/observer bootstrap headers and envelope parsing | Keep; strengthened by `TSA-P02-008` |
| `src/ts/server/characterShellHydration.test.ts` | 11 | Stable-target character shell hydration and retry | Keep |
| `src/ts/server/hydrationReads.svelte-node.test.ts` | 13 | Negotiated chat/prompt/preset/lorebook hydration transport | Keep; strengthened by `TSA-P02-002` |
| `src/ts/server/lifecycleRecovery.test.ts` | 4 | Shared visibility/pageshow/online/focus listener lifecycle | Keep; strengthened by `TSA-P02-004` |
| `src/ts/server/pendingMutationOutbox.crossTab.test.ts` | 6 | Cross-tab lock/CAS publication and cold-module ownership | Keep; residual in `TSA-P02-009` |
| `src/ts/server/pendingMutationOutbox.test.ts` | 225 | Encrypted IndexedDB staging, ownership, ordering, receipts, and projections | Keep; residual in `TSA-P02-009` |
| `src/ts/server/pendingMutationReplay.test.ts` | 10 | Serial replay, committed order, dependency blocking, and outcomes | Keep; strengthened by `TSA-P02-001` |
| `src/ts/server/resourceCache.test.ts` | 11 | Content-addressed cache integrity, budgets, pruning, and reconstruction | Keep; strengthened by `TSA-P02-005` |
| `src/ts/server/resourceInvalidation.test.ts` | 99 | Targeted/full convergence, identity, stale fences, and side effects | Keep; strengthened by `TSA-P02-002` |
| `src/ts/server/resourceManifest.test.ts` | 45 | Route/runtime resource requirement manifest | Keep; residual in `TSA-P02-009` |
| `src/ts/server/resourceRefresh.test.ts` | 10 | Targeted refresh, gap fallback, replacement, and coalescing | Keep |
| `src/ts/server/resourceState.svelte.test.ts` | 65 | Authoritative slice state and projection/resource epochs | Keep |
| `src/ts/server/routeResourceLoader.test.ts` | 12 | Route/runtime loading, supersession, retry, and localized failure | Keep |
| `src/ts/server/shellHydration.svelte-node.test.ts` | 4 | Atomic shell apply and stale/revision fencing | Keep |
| `src/ts/server/shellProtocol.test.ts` | 4 | Thin-shell validation and summary/detail separation | Keep |
| `src/ts/server/staleStateGuards.test.ts` | 14 | Latest-operation, semantic rollback, dirty draft, and destructive epochs | Keep; strengthened by `TSA-P02-007` |
| `src/ts/startupReadiness.test.ts` | 12 | Milestones, capabilities, retries, revocation, and waits | Keep; strengthened by `TSA-P02-004` |
| `src/ts/storage/database.resourceState.test.ts` | 5 | Compatibility facade over resource state and revisions | Keep |
| `src/ts/stores.runtimeEffects.svelte-node.test.ts` | 1 | Singleton runtime-effect install/dispose/reinstall | Keep |

### Defense In Depth

| Layer | Distinct failure mode retained |
| --- | --- |
| Pure guards/state machines | Latest-operation, semantic rollback, readiness, route intent, and shell protocol invariants fail without browser scheduling noise. |
| IndexedDB and lock coordination | Outbox encryption, atomic counters, dependencies, receipts, cross-tab CAS, and cache pruning fail on durable-state transitions. |
| Client coordinators | Bootstrap, replay, hydration, invalidation, refresh, lifecycle, and writer-session owners fail on ordering, cancellation, and stale-target behavior. |
| Fastify/SQLite integration | Writer fencing and bootstrap filtering fail on real route hooks, persisted epochs, and server state. |
| Mounted DOM | Observer shell and DOM/media observation fail on accessibility, local navigation, retry focus, playback, and teardown. |
| Built Chromium | Startup/cache, response-loss replay, event gaps, takeover, direct links, optional runtime isolation, and visible recovery fail across the compiled SPA, Fastify, and SQLite. |

The overlaps are intentional: each row observes a different boundary and none
has an equivalent same-layer replacement. Heavy mocks in invalidation, route
loading, and replay remain bounded coordinator evidence rather than transport,
browser storage, or merge-algorithm proof.

### Findings And Residuals

- `TSA-P02-001` fixes cross-tab replay reordering by preserving committed
  IndexedDB order instead of wall-clock sequences.
- `TSA-P02-002` fails closed when a single-character lorebook response names a
  different resident character.
- `TSA-P02-003` reclassifies the DOM observer and fixes BGM/autoplay cleanup on
  app teardown.
- `TSA-P02-004` strengthens actual entry wiring, rejected retry cleanup,
  observer projection clearing, blocked storage, and lifecycle teardown.
- `TSA-P02-005` adds per-value, manifest-population, and unreadable-row resource
  cache evidence.
- `TSA-P02-006` replaces fixed browser timing with protocol settlement and adds
  population, overfetch, receipt-response, refresh-order, denial/revocation,
  and real mutation oracles.
- `TSA-P02-007` makes attempted-value rollback insensitive to JSON object key
  insertion order.
- `TSA-P02-008` proves bootstrap ownership headers and representative stale
  writer routes have no durable effects.
- `TSA-P02-009` retains bounded Medium residuals for real-browser IndexedDB/Web
  Locks failure modes, fixed negative cross-tab timing, full cache byte/entry
  pressure, independent manifest completeness, active-writer cleanup spies, and
  authoritative reread wording in one visible settlement journey. Its concrete
  Phase 13/14 revisit gate is recorded in the findings ledger.

All High findings are fixed. The deferred residuals do not justify removing or
merging any current owner and do not weaken response-loss, offline, event-gap,
writer-transfer, stale-target, or reload protection.
