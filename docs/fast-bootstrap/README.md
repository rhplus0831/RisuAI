# Fast Bootstrap Execution Guide

This directory turns [`PLAN.md`](PLAN.md) into reviewable implementation phases.
`PLAN.md` remains the requirements source of truth; these files are the
execution runbooks for sequencing, code ownership, verification, and handoff.
Current completion state and remaining work are recorded in
[`PROGRESS.md`](PROGRESS.md).

## Phase index

| Phase | Runbook | Depends on | Primary result |
| --- | --- | --- | --- |
| 0 | [Measurement and budgets](00-measurement-and-budgets.md) | None | Reproducible startup and bundle baselines with regression gates |
| 1 | [Entry and bundle boundaries](01-entry-and-bundle-boundaries.md) | Phase 0 | A minimal initial JavaScript graph |
| 2 | [Thin character summaries](02-thin-character-summaries.md) | Phase 0 | A small list projection with selected-character detail hydration |
| 3 | [Startup capabilities](03-startup-capabilities.md) | Phases 1 and 2 | Explicit shell, mutation, route, plugin, and generation readiness |
| 4 | [Deferred runtimes](04-deferred-runtimes.md) | Phase 3 | Optional and chat-specific work no longer blocks the shell |
| 5 | [Route-driven hydration](05-route-driven-hydration.md) | Phase 3 | Routes load only their declared settings and collections |
| 6 | [Observer shell](06-observer-shell.md) | Phases 2, 3, and 5 | Authenticated read-only UI before writer recovery completes |
| 7 | [Hardening and rollout](07-hardening-and-rollout.md) | Phases 0-6 | Measured rollout, final documentation, and removal of transition seams |

Phase 1 and Phase 2 should run in parallel after Phase 0. Phase 4 and Phase 5
may also run in parallel after Phase 3. Phase 6 can begin once its listed
preconditions pass, but it must not be generally enabled until Phase 4's chat
and plugin readiness rules are also proven. Phase 7 closes all remaining lanes.

```text
Phase 0 Measurement
 ├── Phase 1 Entry and bundles ──────┐
 └── Phase 2 Character summaries ───┤
                                     v
                         Phase 3 Capabilities
                            ├── Phase 4 Deferred runtimes
                            └── Phase 5 Route hydration ──┐
                                                         v
                                              Phase 6 Observer shell
                                                         |
                                                         v
                                              Phase 7 Rollout
```

## Shared invariants

Every phase must preserve these conditions:

1. Queued client mutations are retained intent, not accepted server state.
2. Owner adoption, takeover, outbox preparation, receipt acknowledgement, and
   pending replay keep their current order.
3. User-originated commands are rejected below the UI until mutation capability
   is explicitly enabled. First-run initialization and internal replay retain a
   narrow, named bootstrap path.
4. Browser projections are applied only after authenticated server confirmation
   and coherent revision checks. Event gaps still cause authoritative recovery.
5. Character summary rows are never treated as hydrated character details.
6. Generation waits for the selected character, chat, prompt owner, plugins,
   and recovered generation state.
7. Moving plugin startup later does not overwrite accepted plugin projections.
8. New user-visible startup, read-only, retry, or error text is added through
   `src/lang`.

The canonical current behavior is documented in
[Server Resources and Hydration](../structure/server-resources-and-bridges.md),
[Durable Mutations and Recovery](../structure/durable-mutations-and-recovery.md),
[Data and Events](../structure/data-and-events.md), and
[Client Runtime](../../src/docs/client-runtime.md). Update those documents only
when shipped behavior changes.

## Capability vocabulary

Implementation details may vary, but the following meanings are stable:

| Capability | Meaning |
| --- | --- |
| `canRenderShell` | Authenticated shell resources are coherent enough to render |
| `canApplyRoutes` | Route application may safely change persistent state |
| `canMutate` | Ordinary user-originated commands may be dispatched |
| `pluginsReady` | Plugin-dependent rendering and transforms are available |
| `canGenerate` | All selected chat, prompt, plugin, and recovery dependencies are ready |

Phase names such as `observer-ready` and `writer-ready` are useful for metrics
and diagnostics. Product code should normally consume the narrow capability it
needs instead of comparing phase names.

## How to execute a phase

- Treat each numbered review slice in a runbook as an independently reviewable
  change with focused tests and a rollback seam.
- Before a slice, confirm its inputs and unresolved decisions. Do not combine a
  contract change, a broad consumer migration, and rollout enablement in one
  change.
- After a slice, record the commands run and attach the named bundle, payload,
  trace, or browser artifact. Numeric budget changes require before/after data
  and a written reason.
- Use `pnpm test:affected --dry-run` to inspect the relevant lanes, then run the
  owning test files directly. Use `pnpm test:affected` before handoff.
- Run `pnpm build` plus the bundle report for entry-graph or startup-boundary
  changes, `pnpm build:smoke` plus targeted browser smoke for capability changes,
  and `pnpm test:all` only at final integration.
- Keep the full character aggregate and observer rollout flag only for the
  periods named in the runbooks. Each temporary seam needs a removal condition;
  the Phase 7 ledger records the completed `loadedStore` removal separately.

The focused test maps are
[Browser State Sync and Recovery](../tests/browser-state-sync-and-recovery.md),
[App Navigation and Chat](../tests/app-navigation-and-chat.md),
[Persistence, Commands, and Events](../tests/persistence-commands-and-events.md),
and [API Security and Runtime](../tests/api-security-and-runtime.md).

## Initiative completion gate

The initiative is complete only when:

- the initial JavaScript and character-summary payload meet the ratified Phase 0
  budgets on small and large fixtures;
- shell rendering does not wait for chat bodies, plugins, push, inlays, model
  discovery, or unrelated route resources;
- mutation and generation paths have non-UI capability enforcement;
- observer promotion is revision-safe under replay, multi-tab ownership changes,
  and event gaps;
- focused, browser-smoke, and full verification pass; and
- the architecture guides describe the shipped state rather than the migration.
