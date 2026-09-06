# Frontend Test Architecture (Archived)

Closed and archived 2026-08-29. This historical workstream reduced frontend
test cost by matching each test to the smallest runtime that can prove its
behavior. Current commands and architecture live in
[`docs/structure/testing-and-operations.md`](../../../docs/structure/testing-and-operations.md)
and [`docs/tests/README.md`](../../../docs/tests/README.md).

Start with:

1. [`status.md`](status.md) for the current phase, cursor, metrics, and blockers.
2. [`plan.md`](plan.md) for scope, invariants, target architecture, and phase
   order.
3. [`phases/README.md`](phases/README.md) for phase and slice routing.
4. [`latest-verification.md`](latest-verification.md) for reproducible timing and
   correctness evidence.

All phases are complete. The current Vitest configuration and test
documentation remain authoritative when this archive and live behavior differ.
