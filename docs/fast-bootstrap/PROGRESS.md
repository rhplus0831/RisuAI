# Fast Bootstrap Progress

Last updated: 2026-08-24.

This file is the initiative-level completion tracker. The detailed requirements
remain in [`PLAN.md`](PLAN.md), and each linked phase runbook owns its review
notes, verification commands, and evidence. Check a task only after its code,
tests, evidence, and applicable exit criteria are complete.

## Status summary

| Phase | Status | Remaining work |
| --- | --- | --- |
| [0: Measurement and budgets](00-measurement-and-budgets.md) | Complete | None. |
| [1: Entry and bundle boundaries](01-entry-and-bundle-boundaries.md) | Complete | None. |
| [2: Thin character summaries](02-thin-character-summaries.md) | Complete | None. The compatibility aggregate route remains a rollback seam until the planned seam-removal work. |
| [3: Startup capabilities](03-startup-capabilities.md) | Complete | None. `loadedStore` remains only as the documented background-readiness compatibility alias scheduled for removal in Phase 7. |
| [4: Deferred runtimes](04-deferred-runtimes.md) | In progress | Review slices 4B-4D. |
| [5: Route-driven hydration](05-route-driven-hydration.md) | Outstanding | All review slices. |
| [6: Observer shell](06-observer-shell.md) | Outstanding | All review slices. |
| [7: Hardening and rollout](07-hardening-and-rollout.md) | Outstanding | All review slices and the final initiative evidence package. |

## Task checklist

### Phase 0: Measurement and budgets

- [x] 0A. Stable readiness instrumentation.
- [x] 0B. Initial-preload build report and ratified budgets.
  - [x] Implement the report, deterministic tests, package command, artifacts,
    and provisional regression gates.
  - [x] Review five reproducible clean local preload builds and record variance.
  - [x] Ratify the 900/500 KiB milestone targets and promote them to hard gates.
- [x] 0C. Server and payload timing.
- [x] 0D. Cold/warm scenario matrix.

### Phase 1: Entry and bundle boundaries

- [x] 1A. Entry and conditional polyfills.
- [x] 1B. Lazy root UI and route handlers.
- [x] 1C. Store and global API dependency cleanup.
- [x] 1D. Final grouping and enforcement.
  - [x] Inspect the generated graph, document the no-manual-grouping decision,
    enforce import-boundary diagnostics, and protect the entry closure.
  - [x] Complete the Phase 0 local budget ratification and hard-gate promotion.

### Phase 2: Thin character summaries

- [x] 2A. Versioned summary contract.
- [x] 2B. Direct server projection.
- [x] 2C. Client summary application.
- [x] 2D. Selected detail hydration and guards.
- [x] Record the focused, full-suite, type-check, payload, and bundle evidence.

### Phase 3: Startup capabilities

- [x] 3A. Coordinator and diagnostics.
- [x] 3B. Writer sequence and command enforcement.
- [x] 3C. Shell and `loadedStore` migration.
- [x] 3D. Route, chat, and event readiness.

### Phase 4: Deferred runtimes

- [x] 4A. Classify and schedule work.
- [ ] 4B. Shell-independent optional work.
- [ ] 4C. Plugin readiness.
- [ ] 4D. Chat-specific readiness.

### Phase 5: Route-driven hydration

- [ ] 5A. Consumer inventory and manifest contract.
- [ ] 5B. Minimal coherent shell resource.
- [ ] 5C. Route-scoped loader.
- [ ] 5D. Invalidation, prefetch, and failure isolation.

### Phase 6: Observer shell

- [ ] 6A. Flag and observer projection.
- [ ] 6B. Read-only interaction and local intent.
- [ ] 6C. Writer recovery and safe promotion.
- [ ] 6D. Permanent observer and retry behavior.

### Phase 7: Hardening and rollout

- [ ] 7A. Integration matrix.
- [ ] 7B. Telemetry and privacy.
- [ ] 7C. Documentation and developer workflow.
- [ ] 7D. Rollout and transition-seam removal.
- [ ] Assemble the final evidence package and satisfy the initiative completion
  gate in [`README.md`](README.md#initiative-completion-gate).

## Updating this tracker

When a task changes state, update the checkbox and summary row in the same
change. Add implementation details and evidence to the phase runbook rather than
expanding this file into a second plan. Update the date above whenever the
recorded status changes.
