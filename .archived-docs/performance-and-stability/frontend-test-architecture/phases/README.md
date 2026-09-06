# Frontend Test Architecture Phases

Date: 2026-08-29

This closed index preserves phase scope, dependencies, invariants, exit
criteria, validation, and concrete proof slices. All phases are complete; there
is no active execution cursor.

- [Phase 0: Baseline And Classification](phase-0-baseline-and-classification.md)
- [Phase 1: Runtime Topology](phase-1-runtime-topology.md)
- [Phase 2: Pure Node Promotion](phase-2-pure-node-promotion.md)
- [Phase 3: Svelte+Node Promotion](phase-3-svelte-node-promotion.md)
- [Phase 4: Pure Logic Extraction](phase-4-pure-logic-extraction.md)
- [Phase 5: DOM Contract Consolidation](phase-5-dom-contract-consolidation.md)
- [Phase 6: Routing And CI Enforcement](phase-6-routing-and-ci-enforcement.md)
- [Phase 7: Verification And Closeout](phase-7-verification-and-closeout.md)

## Slice Rules

- One slice is one implementation or proof batch.
- A slice names its capability class or domain owner and lists every file whose
  ownership changes.
- Each slice includes scope, current and target runtime, source anchors,
  dependencies, behavior invariants, expected performance mechanism, rollback
  plan, done criteria, and validation commands.
- Measure before and after on the same host. Record the owning-project result and
  ordinary frontend result, not only isolated file duration.
- A file migration must not mock away the behavior that justified its prior
  runtime.
- A logic-extraction slice retains or adds the appropriate DOM/browser contract
  in the same batch.
- Keep slices small enough to resume directly from `../status.md` without
  re-investigating the entire workstream.
- Update `../status.md` and `../latest-verification.md` after a slice or phase
  changes state.
- Do not mark a phase complete until its exit criteria pass or an accepted gap
  with a revisit condition is recorded in `../status.md`.

## Shared Validation Floor

Every implementation slice runs:

1. its focused test files in the target project;
2. the complete projects whose discovery or setup changed;
3. `pnpm test:affected --dry-run` and the selected affected lanes;
4. `pnpm format:check` or formatting of the changed files;
5. `git diff --check`.

Runner, setup, coverage, or CI changes also require `pnpm test:all` before phase
closeout. DOM/component ownership changes require the owning UI coverage tests
and relevant browser smoke when the contract crosses into real-browser behavior.
