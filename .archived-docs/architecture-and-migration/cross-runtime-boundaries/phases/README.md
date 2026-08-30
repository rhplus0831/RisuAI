# Cross-Runtime Boundaries Phase Guide

The phase files translate [`PLAN.md`](../PLAN.md) into bounded outcomes.
[`status.md`](../status.md) owns the current cursor.

## Execution Order

Phase 0 freezes the import baseline before source moves. Phases 1 and 2 establish
wire and operation conventions. Phase 3 extracts neutral leaf behavior. Phases 4
and 5 migrate consumers. Phase 6 removes declaration coupling only after the
graph is independent. Phase 7 closes and archives the workstream.

## Phase Index

- [Phase 0: Boundary inventory and no-new-debt gates](phase-0-boundary-inventory-and-gates.md)
- [Phase 1: Protocol contract completion](phase-1-protocol-contract-completion.md)
- [Phase 2: Route operation and policy catalog](phase-2-route-operation-and-policy-catalog.md)
- [Phase 3: Pure shared core](phase-3-pure-shared-core.md)
- [Phase 4: Server consumer migration](phase-4-server-consumer-migration.md)
- [Phase 5: Browser adapter migration](phase-5-browser-adapter-migration.md)
- [Phase 6: Typecheck and package decoupling](phase-6-typecheck-and-package-decoupling.md)
- [Phase 7: Verification and closeout](phase-7-verification-and-closeout.md)

## Slice Template

Use `phases/slices/phase-<n>-<slug>/<slice>.md`. Each slice records status,
owner, opening cursor, dependencies, exact source/destination symbols, import
classification, allowed files, mutations/persistence/events/policy behavior,
parity tests, validation, rollback, residual risk, dependency release, and a
stopping condition.

## Common Entry Gate

- The active slice is linked from `status.md`.
- Its predecessor contract or helper exists and passes its boundary audit.
- Runtime behavior, masking, persistence, event, and security ownership are
  explicit.
- The change is independently revertible.

## Common Exit Gate

- The inventory and baseline reflect the new graph without unexplained edges.
- Focused parity tests and the smallest owning lanes pass.
- No forbidden protocol/shared dependency or route-policy drift is introduced.
- Rollback and residual risks are recorded.
- `status.md` and `latest-verification.md` identify the exact proof cursor.

See [`slices/README.md`](slices/README.md) for slice-maintenance rules.
