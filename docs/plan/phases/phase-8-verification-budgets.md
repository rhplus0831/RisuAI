# Phase 8: Verification Budgets

Status: COMPLETE (2026-06-05) — the gate stays live as the standing
maintenance check. The Phase 0 scaffold is live at
`src/ts/__tests__/fixCompletenessGate.test.ts`. It seeded scheduled ids as
`PLANNED`; landed fixes flip to `DONE` with a test path. EVERY scheduled id is
now `DONE` (Phases 1-7 all complete; the Phase 7 batch `M2`, `L3`, `L8`, `L9`,
`L37`-`L40` was the last), and the Phase 8 closing verification run is
recorded in [`../latest-verification.md`](../latest-verification.md). The gate
keeps every scheduled fix's regression proof registered; a future-scheduled
gated item (L4, L7, L26, U2) would enter the registry the same way, and any
later change to a narrowed/bounded path re-runs the proof set and refreshes
the verification log.

Goal: prevent silent regression. Every fix in Phases 1-7 registers its test by
finding id. The gate fails if a registered proof is missing or if runtime code
lands without a proof. Refresh
[`../latest-verification.md`](../latest-verification.md) after each phase.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  the full finding set the gate enumerates.
- `src/ts/__tests__/cloneCostGateCompleteness.test.ts` - the landed self-checking
  gate map this phase mirrors (its `INTENTIONALLY_BROAD` pattern is the template
  for recording gated/non-goal exclusions).
- [`../active-risk-analysis.md`](../active-risk-analysis.md) - the finding ->
  phase -> status map the gate is checked against.

## Slices

- [`fix-completeness-gate.md`](slices/phase-8-verification-budgets/fix-completeness-gate.md) -
  map each scheduled id to its regression test; keep explicit
  `INTENTIONALLY_GATED` and `NO_ACTION` lists; fail on drift. Phase 0 seeds
  `PLANNED` entries, and landed phases replace them with test paths.

## Planned Shape

- The gate is data-first: one registry literal mapping id -> {phase, status,
  testPath, testName}. `PLANNED` ids are allowed; a `DONE` id whose test path no
  longer exists fails the gate.
- Gated/no-action/dismissed ids live in explicit lists so the gate's universe
  equals the audit's universe (no finding silently unaccounted for).
- Mirror `cloneCostGateCompleteness`, extended for server load-count gates.

## Exit Criteria

- [x] A single completeness gate enumerates every audit finding id and classifies
      it (scheduled-with-test / planned / gated / no-action / dismissed).
- [x] The gate fails when a `DONE` finding's registered test is missing or
      renamed.
- [x] The gate fails if a new finding id appears in the audit without a registry
      entry (universe completeness).
- [x] [`../latest-verification.md`](../latest-verification.md) is refreshed after
      each phase with the maintained full/focused run (every Phase 1-7 batch has
      its run-log row, plus the Phase 8 closing full run).

## Validation

- `pnpm test -- src/ts/__tests__/fixCompletenessGate.test.ts` (or the chosen
  path; the standing self-check).
- `pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit`, both TypeScript
  checks — recorded in [`../latest-verification.md`](../latest-verification.md).
