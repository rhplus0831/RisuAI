# UI State Contract Hardening

Date: 2026-06-11

## Goal

Prevent regressions where state, command payloads, or projections are correct
but the rendered UI seen by the user is stale, reset, or inconsistent.

End state:

- Current testing docs define a visible-state contract: if a change affects
  state the user can see, validation must assert the rendered result after the
  same transition.
- Tests use the smallest layer that proves the contract: helper Vitest for pure
  state, Svelte DOM tests for visible surfaces, and thin Playwright smoke only
  for real browser plus Fastify timing.
- Fragile DOM tests have stable selectors for critical surfaces instead of
  relying on button order, Tailwind classes, and broad text searches.
- The sidebar tab route/refreeze bug has a real mounted DOM regression test, not
  only a source-shape guard.
- Chat-scoped generation settings keep their strong lower-layer coverage and
  gain a few composed UI proofs where separate component tests currently imply
  the full workflow.
- Fastify browser smoke proves a tiny number of user-visible states in addition
  to projection/API state.

## Boundary Sources

- Current structure docs are authoritative for active behavior:
  [`../../structure/testing-and-operations.md`](../../structure/testing-and-operations.md),
  [`../../structure/frontend.md`](../../structure/frontend.md),
  [`../../structure/server-projection-and-bridges.md`](../../structure/server-projection-and-bridges.md).
- The archived UI-state pilot supplies the invariant and test-ring precedent:
  [`../../archive/ui-state-contract-tests.md`](../../archive/ui-state-contract-tests.md).
- The archived v2 plan supplies the structure pattern for phases, source
  anchors, invariants, done criteria, and validation:
  [`../../archive/audit-stability-and-performance-v2/`](../../archive/audit-stability-and-performance-v2/).
- The archived chat-scoped generation-settings plan supplies context only; it
  remains closed and is not extended here:
  [`../../archive/chat-scoped-generation-settings/`](../../archive/chat-scoped-generation-settings/).
- The codebase remains the source of truth when docs or line numbers drift.

## Current Baseline

The repo already has strong coverage in lower layers:

- Helper and command tests cover chat generation settings, send gating, import
  normalization, fork inheritance, and server validation.
- Svelte DOM contract tests already cover chat-list optimistic create, delete,
  selection, rollback, folder parity, and modal behavior.
- Fastify browser smoke starts a real Fastify app and checks bootstrap, events,
  command refresh, storage-write audit, API routes, and reroll persistence.

The remaining gap is narrower:

- Current docs do not yet make the visible-state contract an active policy.
- Several DOM tests still depend on text, CSS classes, or action-button order.
- The sidebar route/refreeze fix is protected by a source regex but not by
  visible DOM behavior.
- Generation-settings controls and pickers are well tested separately, but the
  composed sidebar-to-picker-to-ready workflow is implied rather than proven.
- Browser smoke rarely asserts the actual rendered app.
- `@vitest/coverage-v8` is installed, but there is no dedicated coverage-map
  profile for critical UI integration paths.

## Invariants

Every implementation phase must preserve these:

- Do not reopen archived workstreams or their gates.
- Do not add a new gate unless this plan grows beyond the scheduled phases and
  a maintainer explicitly approves the maintenance cost.
- State/helper tests do not count as visible proof when the bug class is "the UI
  did not update."
- Optimistic UI paths must prove both immediate visible change and visible
  rollback when failure is part of the behavior.
- Playwright remains a sparse semantic smoke layer. Do not convert component
  drift coverage into broad browser automation.
- Stable selectors should describe domain state or accessible intent, not
  implementation styling.
- Coverage is a map, not a threshold goal. Do not chase percentages.

## Phase Overview

- [0. Command Baseline](phases/phase-0-command-baseline.md): fix the
  `buildsite` vs `build:site` mismatch in current scripts and docs.
- [1. Current Doc Policy](phases/phase-1-current-doc-policy.md): promote the
  visible-state contract and test-ring rules into current docs.
- [2. Selector Hardening](phases/phase-2-selector-hardening.md): add stable
  selectors to high-value surfaces and update fragile tests.
- [3. Sidebar Route/Refreeze DOM Backfill](phases/phase-3-sidebar-route-refreeze-dom.md):
  add a mounted DOM test for the sidebar tab stability regression.
- [4. Composed Generation Settings UI](phases/phase-4-composed-generation-settings-ui.md):
  add a few composed UI workflow proofs around active-chat settings.
- [5. Browser Smoke And Coverage Map](phases/phase-5-browser-smoke-and-coverage-map.md):
  add thin visible Playwright assertions and a targeted coverage-map command.
- [6. Verification Closeout](phases/phase-6-verification-closeout.md): run the
  focused and broad proof set, record results, then archive the workstream.

## Execution Cursor

Phases 0-2 are complete. Phase 3 is the next implementation batch. The
sub-agent audit split every phase into concrete slices under `phases/slices/`.

Execution order is phase-gated for dependencies, not for unrelated files:

- Phase 1 completed before runtime UI changes, so the current policy is live.
- Phase 2 completed by selector slices with disjoint write scopes and focused
  proof after each slice.
- Phase 3 can start now that the Phase 2 sidebar-tab selector slice has landed.
- Phase 4 can reuse the Phase 2 generation-settings and composer selectors.
- Phase 5 can use the Phase 2 visible selectors for browser-smoke assertions.
- Phase 6 starts only after all required implementation and proof-refresh slices
  are complete.

## Implementation Agent Rules

- Read `STRUCTURE.md` and this plan's `status.md` before editing.
- Re-check symbols before editing; line numbers in this plan can drift.
- Keep changes scoped to the phase file.
- Update `status.md` and `latest-verification.md` after each phase lands.
- Prefer focused validation first; run broader checks only when the phase scope
  warrants it.
- Record a reason in `latest-verification.md` for any optional slice or
  feasibility-dependent assertion that is skipped.

## Not In This Plan

- No broad UI redesign.
- No rewrite of projection, routing, command, or generation settings state
  models.
- No new v1/v2/v3-style completeness gate by default.
- No blanket Playwright conversion.
- No archive edits except navigation notes that would otherwise become false.
  Phase 6 closeout is the explicit exception: moving this workstream to
  `docs/archive/` and updating active/archive navigation is part of closeout
  only after proof is green.
