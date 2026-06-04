# Fix-Completeness Gate Scaffold

Status: not started. Phase 0. No runtime change.

## Scope

Stand up the standing fix-completeness gate (the Phase 8 deliverable in scaffold
form): a registry mapping every audit finding id to its phase, status, and
(eventually) regression test, with a self-check that fails on drift. Seed every
scheduled id as `PLANNED`.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  the full finding universe (`H1`-`H3`, `M1`-`M14`, `L1`-`L40`, `U1`-`U4`, the
  dismissed R-set).
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) - the
  finding -> phase -> status map this gate mirrors.
- `src/ts/__tests__/cloneCostGateCompleteness.test.ts` - the landed
  self-checking gate to model (scan + assert; `INTENTIONALLY_BROAD` exclusions).

## Planned Shape

- A single registry literal: `id -> { phase, status: 'PLANNED'|'DONE',
  testPath?, testName? }`.
- Explicit `INTENTIONALLY_GATED` (L4, L7, L26, U2) and `NO_ACTION` (U3 + the five
  dismissed) lists so the registry universe equals the audit universe.
- A self-check that fails if: a `DONE` id has no existing test at `testPath`; an
  audit finding id is missing from the registry; or an id is double-classified.
- Lives in the client suite (it can read both client and server test paths as
  strings) like the existing completeness test.

## Behavior / Invariants

- Test-only. In Phase 0 every scheduled id is `PLANNED`, so the gate passes
  vacuously; it starts catching drift as Phase 1+ flip ids to `DONE`.

## Done Criteria

- The gate scaffold exists, enumerates all audit finding ids, and passes with
  everything `PLANNED`.
- The gate fails in a unit test when a `DONE` entry points at a missing test (a
  deliberate negative case proves the self-check works).

## Validation

- `pnpm test -- <the gate test path>`.
- `pnpm test`, both TypeScript checks.
