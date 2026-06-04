# Fix-Completeness Gate

Status: not started (standing). Phase 8. Promotes the Phase 0 scaffold into the
maintained self-checking gate.

## Scope

Keep a single registry that maps every audit finding id to its phase, status, and
regression test, and fail on drift. As each phase lands, flip its ids from
`PLANNED` to `DONE` with a real `testPath`/`testName`. Refresh
[`../../../latest-verification.md`](../../../latest-verification.md) after each
phase.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  the finding universe.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) - the
  finding -> phase -> status map.
- `src/ts/__tests__/cloneCostGateCompleteness.test.ts` - the landed self-check to
  mirror.
- The Phase 0 scaffold:
  [`../phase-0-baseline-foundations/fix-completeness-gate-scaffold.md`](../phase-0-baseline-foundations/fix-completeness-gate-scaffold.md).

## Planned Shape

- One registry literal: `id -> { phase, status, testPath?, testName? }`, plus
  `INTENTIONALLY_GATED` (L4, L7, L26, U2) and `NO_ACTION` (U3 + the five
  dismissed R-findings).
- Self-check assertions: every audit id is classified exactly once; every `DONE`
  id resolves to an existing test; a new audit id with no registry entry fails the
  gate (universe completeness).
- Server-side load-count gates are referenced by path so the single client-side
  test can assert their existence.

## Behavior / Invariants

- Test-only; no runtime change. The gate is the standing guard against silently
  dropping a fix's proof in a later refactor.

## Done Criteria

- The gate enumerates every audit finding id and classifies it.
- The gate fails when a `DONE` finding's registered test is missing/renamed
  (proven by a negative unit case).
- The gate fails on an unclassified audit id.
- [`../../../latest-verification.md`](../../../latest-verification.md) is kept
  current after each phase.

## Validation

- `pnpm test -- <gate test path>`.
- `pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit`, both TypeScript
  checks — recorded in
  [`../../../latest-verification.md`](../../../latest-verification.md).
