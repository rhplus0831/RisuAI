# Fix-Completeness Gate

Status: standing — the Phase 0 scaffold is live at
`src/ts/__tests__/fixCompletenessGate.test.ts` with every id `PLANNED`. This
slice is the maintenance contract for it: flip ids to `DONE` as fixes land.
Flipping requires updating the registry AND
[`../../../active-risk-analysis.md`](../../../active-risk-analysis.md)
together — the lockstep self-check fails if only one moves.

## Scope

Keep one registry mapping every audit finding id to phase, status, and
regression test. Fail on drift. As phases land, flip ids from `PLANNED` to
`DONE` with a real `testPath`/`testName`. Refresh
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
- Self-checks: every audit id is classified once; every `DONE` id resolves to an
  existing test; unregistered audit ids fail the gate.
- Server-side load-count gates are referenced by path so the single client-side
  test can assert their existence.

## Behavior / Invariants

- Test-only; no runtime change. The gate prevents silently dropping fix proofs.

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
