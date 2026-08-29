# Phase Guide

The phase files translate [`PLAN.md`](../PLAN.md) into bounded outcomes. Live
state and the active slice belong only in [`status.md`](../status.md).

## Execution Order

Phase 0 establishes authority and proves the audit method. Phase 1 makes its
evidence reproducible. Phases 2-12 then audit product domains in dependency-aware
order. A later domain may start early only when its inputs are stable and the
status router records the overlap. Phase 13 consolidates verified findings and
decisions; Phase 14 runs the final gates and archives the workstream.

## Slice Template

Every implementation slice records:

- status, owner, dependencies, and exact Fastify/reference cursors;
- inventory row IDs and source obligations;
- original and current symbols, observables, and scenario variants;
- proposed evidence layers and fixture provenance;
- findings or decisions affected;
- production/test/documentation files allowed to change;
- validation commands, rollback, residual risk, and stopping condition.

Use `phases/slices/phase-<n>-<slug>/<slice>.md`. A phase file is stable scope;
slice files are disposable execution records that may be added as the inventory
becomes concrete.

## Common Entry Gate

- Upstream and baseline authorities needed by the phase are locally readable.
- Inputs from dependency phases have no ambiguous ownership.
- Candidate inventory rows identify exact symbols, variants, and observables.
- Unsupported behavior and expected differences have decision owners.
- The active slice is linked from `status.md` before production edits begin.

## Common Exit Gate

- Every in-scope row is verified, linked to a canonical finding, or explicitly
  routed with owner and revisit trigger.
- Every raw report is mapped exactly once.
- Structural completeness coverage exists for enumerable surfaces.
- Focused and owning-lane validation is recorded in
  `latest-verification.md`.
- The phase records its final Fastify commit and does not claim coverage for
  later changes.

The stricter stopping gates in [`PLAN.md`](../PLAN.md) and
[`CONTRACT.md`](../CONTRACT.md) always take precedence.
