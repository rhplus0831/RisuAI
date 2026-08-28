# Phase 3: Svelte+Node Promotion

Status: In Progress

## Completed Slices

- [Probe-backed runtime bridges](slices/phase-3/probe-backed-runtime-bridges.md):
  promoted seven suites and 69 tests whose unchanged Svelte+Node capability
  probes already passed during Phase 2.
- [Client state and command helpers](slices/phase-3/client-state-and-command-helpers.md):
  promoted two rune-backed command suites and 34 tests to Svelte+Node, while an
  exact smaller-runtime cross-check promoted eleven statically misclassified
  suites and 123 tests to Node.

## Objective

Move tests that require Svelte compilation, runes, or stores but do not prove DOM
behavior into the Svelte+Node project.

## Candidate Shapes

- `.svelte.ts` state modules and bridge logic with explicit dependencies;
- rune/store transitions asserted without mounting a component;
- Svelte-compiled modules exporting pure or stateful helpers;
- persistence or command bridges that install their own explicit storage/network
  fakes and do not use DOM semantics;
- component-adjacent logic tests that import Svelte code but assert data only.

## Exclusions

- mounted components;
- rendered text/attributes/classes;
- focus, keyboard, pointer, drag/drop, and accessibility behavior;
- browser history/location or observer semantics;
- tests whose only path to Svelte+Node is mocking away the rendered consumer;
- source-string assertions that should be addressed as a later explicit
  architecture or behavior slice.

## Slice Requirements

- Name the Svelte feature requiring transformation.
- Prove no DOM/browser globals are read during collection, execution, or teardown.
- Install explicit fakes for storage or network-shaped dependencies.
- Retain companion DOM tests when visible behavior consumes the migrated logic.
- Record transform/import/environment deltas; environment removal is the expected
  mechanism, not a guarantee of lower import cost.

## Phase 3 Stopping Gate

Re-run the formal benchmark after all unambiguous S candidates are promoted.

- If the primary performance target is met, restrict Phase 4 to remaining
  critical-path files with clear value.
- If it is not met, rank Phase 4 candidates using the new profile rather than the
  original planning profile.
- Record whether Svelte+Node is a durable useful layer or whether further project
  simplification is warranted.

## Exit Criteria

- Every Phase 0 unambiguous S candidate is migrated or has a recorded blocker.
- Repeated project and root runs are stable and network-clean.
- D tests retain their visible-state/focus/event contracts.
- The completeness gate accounts for all file moves and renames.
- Formal re-profile and Phase 4 scope decision are recorded.
- `../status.md` contains the cumulative Phase 1-3 performance delta.

## Validation

- Focused migrated files under `frontend-svelte-node`
- Complete three-project frontend run
- Relevant DOM companion tests
- `pnpm coverage:ui-map`
- `pnpm test:affected --dry-run`
- `pnpm test:all`
- `pnpm format:check`
- `git diff --check`
