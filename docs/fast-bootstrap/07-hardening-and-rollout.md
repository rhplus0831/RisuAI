# Phase 7: Hardening and Rollout

## Outcome

Ship the fast-bootstrap initiative with stable regression gates, privacy-safe
operational visibility, current architecture documentation, and a tested
rollback path. Remove transition aliases and flags only after the rollout data
supports doing so.

## Review slices

### 7A. Integration matrix

- [x] Run cold and warm Phase 0 scenarios on small and large fixtures.
- [x] Run multi-tab writer takeover, takeover denial, offline recovery, pending
  outbox replay, receipt acknowledgement, and event-gap recovery end to end.
- [x] Run empty-cache direct links for every Phase 5 route family.
- [x] Run slow/failing optional-runtime scenarios from Phase 4.
- [x] Run observer flag-off and flag-on browser journeys.
- [x] Triage every budget or readiness failure; do not loosen a threshold without
  before/after evidence and a recorded dependency.

#### 7A implementation record (2026-08-25)

`pnpm verify:fast-bootstrap:phase7` is the one-command gate for this slice. It
runs the production initial-preload build and boundary reports, rebuilds the
browser-smoke bundle, records the Phase 0 cold/warm small/large matrix, and then
runs the Phase 7 browser integration matrix. The browser matrix uses a
disposable authenticated Fastify server and imported fixture for every
ownership or failure-isolation journey; it does not share writer identity,
outbox state, or SQLite data between journeys.

The Phase 7 artifact records all of the following in both JSON and tabular text:

- observer flag-off and flag-on startup boundaries for small and large
  fixtures, including zero mutation requests before writer readiness and zero
  generation requests before chat readiness;
- 43 empty-cache direct links derived from the production route manifest,
  covering every Settings, Playground, home, grid, inlay, not-found,
  character, and character-chat resource surface;
- offline-before-send replay and response-lost-after-commit replay, both using
  the retained mutation ID, advancing the server by exactly one revision,
  emptying the encrypted outbox, and acknowledging the durable receipt;
- a real `event_replay_unavailable` response created by removing one persisted
  event before reconnect, followed by all four authoritative resource-family
  reads and restored mutation capability;
- observer denial, explicit takeover, old-writer demotion, and a successful
  mutation from only the promoted writer; and
- slow and failed background-resource reads on a selected-chat deep link, plus
  slow and failed inlay catalog reads with route-local Retry recovery.

The recorded verification run passed all seven Phase 7 browser journeys and
the Phase 0 matrix. Cold/warm background readiness was 759.70/284.90 ms for the
small fixture and 766.20/338.00 ms for the large fixture. The production
initial preload was 312.44 KiB gzip with a 277.83 KiB largest initial file,
passing both the 900/500 KiB milestone gates and the retained regression
ceilings. No budget or readiness threshold was changed. Generated reports stay
under the ignored `fast-bootstrap-results/` directory and are refreshed by the
gate rather than committed.

The final `pnpm test:all` verification also passed: formatting, Svelte and
TypeScript checks, 524 frontend files / 6,542 tests, 4 audit-gate files / 9
tests, 6 UI-map files / 203 tests with coverage thresholds, the full Fastify
server lane, and all 33 browser-smoke journeys.

### 7B. Telemetry and privacy

- [x] Emit phase duration, attempt count, and stable failure reason through the
  existing metrics/tracing facilities.
- [x] Exclude character, chat, message, prompt, plugin-storage, credential,
  account, and route-content values.
- [x] Document enablement, sampling, retention, aggregation, and the failure-code
  taxonomy before using measurements for rollout decisions.
- [x] Confirm telemetry failure cannot change a readiness capability.

#### 7B implementation record (2026-08-25)

The browser now publishes versioned, exact-key startup metadata through the
authenticated, observer-safe `POST /api/v1/telemetry/startup` route. Fastify
advertises collection only when `RISU_PROTOCOL_METRICS` is enabled. Version 1
uses full sampling within that server cohort and reports entry-relative phase
durations, attempt duration/count, observer rollout mode, and the stable failure
taxonomy. The publisher starts before the first startup attempt, backfills the
entry and shell milestones, bounds its pending queue to 64 and each request to
32 events, and drops auth/transport failures without retries or readiness
coupling. Optional background failures now use the existing push/runtime codes
instead of remaining console-only.

The ingestion contract rejects unknown keys, arbitrary strings, content fields,
out-of-range values, oversized batches, and bodies over 16 KiB. It never accepts
character, chat, message, prompt, plugin-storage, credential, account, or route
values. Request tracing records only omitted-body metadata for the endpoint,
including when an unauthenticated or invalid request contains a sentinel value;
the sentinel is absent from JSONL. The canonical enablement, cohort sampling,
raw/aggregate retention ceilings, aggregation rules, failure-code meanings, and
failure-isolation behavior are documented in
[`testing-and-operations.md`](../structure/testing-and-operations.md#browser-startup-telemetry).

The focused frontend contract/readiness/bootstrap/publisher run passed 196
tests, and the focused server ingestion/request-trace run passed 15 tests. Both
type-check lanes passed. The production browser-smoke build and targeted Phase
7 startup rollout journey passed all small/large and observer flag-off/on
cohorts. Every cohort emitted all seven ordered milestones, exactly one
completed attempt, no fatal attempt failure, taxonomy-valid localized
diagnostics, and one consistent rollout-mode label. Generated telemetry evidence
stays in the ignored `fast-bootstrap-results/phase7-integration.json` artifact.

### 7C. Documentation and developer workflow

- [ ] Update `STRUCTURE.md` only for stable orientation changes.
- [ ] Update `docs/structure/server-resources-and-bridges.md` with shipped
  capability semantics, summary/detail contracts, shell manifests, and observer
  promotion ordering.
- [ ] Update `docs/structure/data-and-events.md` for any changed event cursor,
  writer, or replay behavior.
- [ ] Update the relevant `src/docs/` UI/runtime guides and `docs/tests/` maps.
- [ ] Document the one-command startup trace, preload report, fixtures, budgets,
  and how to interpret failures.
- [ ] Keep these runbooks as the active ledger during rollout; archive them under
  `.archived-docs/` after the shipped architecture guides are authoritative.

### 7D. Rollout and seam removal

- [ ] Enable observer mode only after real-environment large-database and
  multi-tab results meet the rollout criteria.
- [ ] Roll out in a bounded stage with the observer flag as the immediate
  rollback control.
- [ ] Remove the legacy full-character compatibility route after no supported
  client depends on it.
- [ ] Remove the `loadedStore` compatibility alias after all consumers use narrow
  capabilities.
- [ ] Remove temporary measurement or compatibility code that has no ongoing
  regression value.
- [ ] Remove the observer flag only after the rollout window passes and the
  rollback decision is explicit.

## Required verification by milestone

| Milestone | Required verification |
| --- | --- |
| Each review slice | Owning unit/DOM/server tests and `pnpm test:affected` |
| Bundle or startup boundary | `pnpm build` plus preload report |
| Character summary complete | Client/server contract tests and large-fixture payload test |
| Capability coordinator complete | `pnpm build:smoke` and targeted browser smoke |
| Observer mode enabled | `pnpm smoke:fastify-browser` with multi-tab/takeover cases |
| Final integration | `pnpm test:all` |

Run Prettier using the repository's normal command and do not commit local trace
data, generated measurement reports, `dist/`, or temporary fixture databases.

## Rollback matrix

| Change | Rollback seam |
| --- | --- |
| Entry/bundle slice | Revert the independent lazy boundary |
| Character summary migration | Temporarily route the client to the legacy aggregate |
| Capability migration | Use the documented `loadedStore` compatibility derivation during its migration window |
| Deferred runtime | Restore only the owning scheduler step without changing capability meanings |
| Route hydration | Restore the affected route manifest family, not the entire initial fan-out |
| Observer shell | Disable the rollout flag and return to the conservative post-replay shell |

Rollback must not reclassify queued mutations as accepted, bypass revision
checks, or weaken command/generation guards.

## Final evidence package

- Before/after preload reports and resource payload tables.
- Cold/warm readiness timings for small and large fixtures.
- Browser-smoke results for direct links, optional failures, replay, multi-tab
  takeover, and observer promotion.
- Budget exceptions, if any, with rationale and owner.
- Links to the updated canonical architecture and test guides.
- A removal record for every compatibility alias, route, and rollout flag.

## Exit gate

- All ratified startup and payload budgets pass.
- Mutation replay, writer takeover, observer promotion, and event-gap recovery
  pass end to end.
- Focused, smoke, and full verification pass.
- Operational metrics are privacy-safe and documented.
- Canonical architecture documentation describes the shipped behavior.
- Transitional aliases, routes, and flags are removed or have a named owner and
  dated removal condition.
