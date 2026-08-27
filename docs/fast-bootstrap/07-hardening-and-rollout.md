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
[`development-and-observability.md`](../structure/development-and-observability.md#browser-startup-telemetry).

The focused frontend contract/readiness/bootstrap/publisher run passed 196
tests, and the focused server ingestion/request-trace run passed 15 tests. Both
type-check lanes passed. The production browser-smoke build and targeted Phase
7 startup rollout journey passed all small/large and observer flag-off/on
cohorts. Every cohort emitted all seven ordered milestones, exactly one
completed attempt, no fatal attempt failure, taxonomy-valid localized
diagnostics, and one consistent rollout-mode label. Generated telemetry evidence
stays in the ignored `fast-bootstrap-results/phase7-integration.json` artifact.
The dependency-aware `pnpm test:affected --base d59267075` verification also
passed 337 frontend files / 5,134 tests and 59 server files / 1,528 tests with
one existing skip. The final `pnpm verify:fast-bootstrap:phase7` gate passed the
Phase 0 matrix and all seven Phase 7 journeys; initial preload remained within
budget at 312.98 KiB gzip with a 277.83 KiB largest initial file.

### 7C. Documentation and developer workflow

- [x] Update `STRUCTURE.md` only for stable orientation changes.
- [x] Update `docs/structure/server-resources-and-bridges.md` with shipped
  capability semantics, summary/detail contracts, shell manifests, and observer
  promotion ordering.
- [x] Update `docs/structure/data-and-events.md` for any changed event cursor,
  writer, or replay behavior.
- [x] Update the relevant `src/docs/` UI/runtime guides and `docs/tests/` maps.
- [x] Document the one-command startup trace, preload report, fixtures, budgets,
  and how to interpret failures.
- [x] Keep these runbooks as the active ledger during rollout; archive them under
  `.archived-docs/` after the shipped architecture guides are authoritative.

#### 7C implementation record (2026-08-25)

The canonical architecture guides now describe the shipped shell-only startup,
route manifest and loader, narrow readiness capabilities, observer promotion,
writer loss, replay, and the distinction between applied and command cursors.
The client runtime and Svelte UI guides identify the concrete owners and render
states, while the test maps connect those boundaries to their unit, DOM,
server, and browser coverage.

The operations guide now owns the complete developer workflow: the one-command
Phase 7 gate, its Node and Chromium prerequisites, isolated small/large and
cold/warm fixtures, generated JSON/text artifacts, the 900/500 KiB hard gates,
retained regression ceilings, UID trace correlation, CI artifact handling, and
failure interpretation. These phase runbooks remain the active rollout and
seam-removal ledger; archival waits until 7D and the initiative exit gate are
complete.

Verification passed with `pnpm test:affected`, `pnpm format:check`, and
`pnpm verify:fast-bootstrap:phase7`. The affected-test selector found no tests
for the documentation-only paths. The full gate rebuilt both production
variants, passed the Phase 0 startup matrix and all seven Phase 7 browser
journeys, and recorded a 312.98 KiB initial gzip preload with a 277.83 KiB
largest initial file. No generated artifacts were committed.

### 7D. Rollout and seam removal

- [ ] Enable observer mode only after real-environment large-database and
  multi-tab results meet the rollout criteria.
- [ ] Roll out in a bounded stage with the observer flag as the immediate
  rollback control.
- [ ] Remove the legacy full-character compatibility route after no supported
  client depends on it.
- [x] Remove the `loadedStore` compatibility alias after all consumers use narrow
  capabilities.
- [x] Remove temporary measurement or compatibility code that has no ongoing
  regression value.
- [ ] Remove the observer flag only after the rollout window passes and the
  rollback decision is explicit.

#### 7D rollout decision record (prepared 2026-08-25)

**Current decision: HOLD.** Keep the production default flag off. The repository
contains quality workflows but no deployment or cohort-routing configuration,
and `VITE_FAST_BOOTSTRAP_OBSERVER` is compiled into the client build. A bounded
stage therefore requires an externally managed flag-on build/deployment cohort;
this repository cannot safely turn on a percentage of existing clients at
runtime.

The rollout is blocked on fields that cannot be inferred or assigned locally:

| Required decision input | Current state | Promotion requirement |
| --- | --- | --- |
| Rollout owner and rollback executor | Unassigned | Name both people/teams and record their acknowledgement. |
| Canary and control deployment IDs | Missing | Use the same commit and configuration except for the observer build flag. |
| Metrics sink owner and deletion policy | Missing | Enable `RISU_PROTOCOL_METRICS` for both cohorts; cap raw retention at 14 days and aggregates at 90 days. |
| Real large-database control evidence | Missing | Exercise a non-committed real save at least as large as the Phase 0 large fixture and retain only content-free corpus/timing aggregates. |
| Real multi-tab acceptance evidence | Missing | Complete the safety checklist below on the control and canary deployments. |
| Rollout and rollback dates | Missing | Record the canary start, review, expansion, full-rollout, and flag-removal dates before enabling the canary. |

Use this bounded sequence. The sample/window defaults are part of the decision;
changing them requires the rollout owner and rationale in this record.

1. Keep all normal production builds flag-off. Establish a flag-off control for
   at least 24 continuous hours and 100 `attempt-completed` events, whichever is
   later. Run one real large-database/two-tab acceptance pass during that window.
2. Deploy the same commit with `VITE_FAST_BOOTSTRAP_OBSERVER=TRUE` to one named
   canary cohort capped at 5% of instances or traffic. Keep an otherwise
   identical flag-off control and a ready-to-deploy flag-off build.
3. After at least 24 hours and 100 completed canary startups, expand to at most
   25% only if every safety and telemetry threshold below passes. Repeat the
   acceptance pass after expansion.
4. Move to full rollout only after another passing 24-hour/100-startup window.
   Keep the flag and control build available for seven full days after that
   decision. Remove the flag only after the named owner records a final keep or
   rollback decision and a dated removal change.

The real-environment safety checklist has zero tolerance: observer navigation
must issue no mutation or generation; takeover denial must retain a useful
read-only shell; promotion must apply the post-replay projection before writes;
the old writer must be unable to mutate; one accepted mutation must advance one
revision even after response loss; offline outbox replay and receipt
acknowledgement must settle once; event-gap recovery must refresh authoritatively;
and auth loss or database replacement must not retain an authenticated stale
projection. Any violation rolls the canary back immediately.

Aggregate telemetry only by schema version, milestone, observer mode, and the
deployment-owned cohort label. Do not introduce a browser/user identifier or
join to domain data. Promotion also requires all of these thresholds:

- no new `attempt-failed` code and no increase greater than 0.5 percentage
  points in fatal-attempt rate versus the concurrent flag-off control;
- no increase greater than 1 percentage point in completed attempts with
  `attemptCount > 1` or in any localized diagnostic-failure code;
- no more than a 10% regression in p95 `writer-ready` or `background-ready`
  duration versus control; and
- flag-on p50 `observer-ready` at least 20% earlier than flag-on p50
  `writer-ready`, proving the rollout exposes a materially earlier shell.

A safety violation triggers immediate rollback. A telemetry threshold blocks
promotion or triggers rollback after two consecutive hourly windows once the
minimum sample is present. Missing or malformed telemetry blocks the decision;
it is never interpreted as success. Rollback means deploying the same commit
with the observer flag unset, then rerunning the flag-off multi-tab acceptance
pass. It does not alter summaries, route hydration, capability guards, replay,
or resource protocols.

The legacy `/api/v1/characters/aggregate` route is a separate external-client
decision. Repository inventory finds no production first-party browser call;
the exact path remains only in the Fastify route/manifest and test or diagnostic
code. Removal still requires path-only access counts covering the entire
supported-client window, with zero supported-client requests for at least 30
consecutive days. If that condition passes, remove both GET/POST routes,
manifest entries, compatibility tests, and replace the payload comparison's
legacy HTTP dependency with a direct repository benchmark. If it does not pass,
record the supported client, owner, and dated migration/removal condition here.

The measurement commands, budgets, fixture builders, telemetry protocol, and
Phase 0/7 browser matrices all retain ongoing regression or rollout value and
must stay. The smoke-only observer override stays until the build flag is
removed. The completed `loadedStore` cleanup was the only currently identified
compatibility code with no remaining consumer; no additional temporary code was
deleted under this checklist item.

#### 7D seam-removal record: `loadedStore` (2026-08-25)

The final compatibility consumers were bootstrap completion, projected push
notification reconciliation, observer promotion retry selection, and the
browser-smoke `isLoaded()`/`waitForLoaded()` helpers. They now use the
coordinator-owned `backgroundReady()` semantic selector or wait directly for
`background-ready`. The selector intentionally reads the observed semantic
signal rather than the ordered telemetry phase: an earlier localized optional
failure may keep the public phase behind while background work has still
settled. Visible rendering, routes, mutations, plugins, and generation remain
on their existing narrow capabilities.

The core-store declaration and compatibility re-export were removed, as were
the obsolete test setup and import-safety assertion. Focused readiness,
bootstrap, route DOM, and store import-safety verification passed 201 tests.
Both type-check lanes passed, and `pnpm test:affected` passed 345 frontend files
and 5,195 tests with no affected server test files. The final
`pnpm verify:fast-bootstrap:phase7` run passed the Phase 0 matrix and all seven
Phase 7 browser journeys; initial preload remained within budget at 312.98 KiB
gzip with a 277.83 KiB largest initial file.

The remaining 7D items are independent rollout or supported-client decisions;
this removal does not enable observer mode or remove a server route or flag.

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
| Capability migration | Revert the seam-removal change; any temporary alias must derive from coordinator-owned `backgroundReady()` |
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
