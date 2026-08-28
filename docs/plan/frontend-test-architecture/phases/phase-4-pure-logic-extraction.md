# Phase 4: Pure Logic Extraction

Status: In Progress

## Progress

- [Chat import request planning](slices/phase-4/chat-import-request-planning.md)
  extracts full-create and tail-chunk planning into a plain TypeScript leaf,
  moves the planning matrix to Node, and retains the real durable-command and
  production payload-boundary contracts in Happy-DOM.
- Next: settings projection and reconciliation.

## Objective

Reduce expensive import and DOM execution graphs by extracting measured pure
logic seams from components or broad runtime entry modules while preserving
focused DOM/browser contracts.

This phase is conditional. Its breadth is decided by the Phase 3 re-profile.

## Selection Criteria

A candidate slice must have:

- current profiler evidence showing material import, transform, environment, or
  sequential test-body cost;
- a cohesive algorithm, planner, reducer, normalizer, reconciliation rule, or
  state transition that can be expressed without DOM behavior;
- a clear production call site and dependency boundary;
- retained D or B proof for visible behavior;
- a plausible project-level or lane-level performance mechanism.

Code aesthetics alone are not sufficient.

## Initial Candidate Families

- Chat import/chunk planning and payload-boundary tests.
- Router construction/reset and route-to-state application.
- Settings projection, reconciliation, identity, and pending-write sequencing.
- ChatScreens/sidebar derived state currently exercised through repeated mounts.
- Fixture parsing/planning and reusable server-backed harness setup.

Re-rank these after Phase 3; add or remove candidates based on current evidence.

## Phase 3 Approved Ranking

The Phase 3 stopping gate did not meet the 57.84s primary target. Its three warm
runs provide this current per-file median elapsed ranking:

1. Chat command boundaries: `src/ts/chatCommands.test.ts` at 5.00s. Prepare the
   first slice around cohesive import/chunk planning and retain durable command
   and browser integration contracts.
2. Settings projection and reconciliation:
   `TranslatorPresetSettings.svelte.test.ts` at 2.73s,
   `chatGenerationSettingsControls.test.ts` at 2.21s, and
   `pickerGenerationSettings.test.ts` at 1.73s. Select one cohesive projection
   or pending-write seam per slice and retain mounted contracts.
3. Server-backed fixture planning:
   `sendChat.fixtures.serverBacked.test.ts` at 2.70s and
   `sendChat.fixtures.test.ts` at 1.72s. Separate deterministic fixture planning
   from the browser-shaped import graph while retaining the integration owner.
4. Router construction/reset: `src/ts/router.test.ts` at 1.44s. Extract only
   route-to-state planning; keep history/location behavior in D.

`src/ts/bootstrap.test.ts` (2.41s) and `src/ts/plugins/plugins.test.ts` (2.36s)
are measured but not yet approved: both currently prove broad lifecycle or
browser-owned behavior without a demonstrated pure seam. Revisit after the
ranked slices or when fresher profiler evidence changes the order.

## Slice Shape

1. Pin current behavior with focused tests.
2. Extract a plain TypeScript leaf with explicit inputs and outputs.
3. Move the combinatorial matrix to N or S.
4. Keep a small D/B integration contract proving wiring, painted state, focus,
   rollback, or browser behavior as applicable.
5. Measure the focused file, owning projects, and ordinary frontend lane.
6. Record whether the expected import/environment reduction materialized.

## Invariants

- No user-visible behavior, mutation ordering, persistence, rollback, error, or
  race-ownership semantics change.
- Production exports are not widened solely for tests when a stable leaf module
  can own the logic.
- Large-boundary tests may use injectable limits only when a separate assertion
  pins the production constant and retained integration proof covers the real
  boundary mechanism.
- Component contracts remain behavior-oriented rather than source-string-only.

## Exit Criteria

- Every approved Phase 4 slice is implemented, measured, and documented.
- Rejected candidates have a concise reason and revisit condition.
- DOM/browser companions prove the extracted logic remains wired correctly.
- Cumulative performance improves beyond noise; non-improving extractions are
  justified by maintainability/correctness or reverted.
- No production behavior drift or coverage loss remains.
- `../status.md` records whether further extraction is stopped or deferred.

## Validation

- Slice-specific Node/Svelte+Node tests
- Retained DOM companion tests
- Relevant UI coverage and browser smoke
- Complete frontend projects
- `pnpm test:affected --dry-run`
- `pnpm test:all` at phase closeout
- `pnpm check`
- `pnpm check:server` when shared/client declarations are affected
- `pnpm format:check`
- `git diff --check`
