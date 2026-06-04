# Phase 8: Verification Budgets

Status: not started (standing). Keeps every scheduled fix's regression proof
registered and keeps the verification record current.

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
  `PLANNED` entries, and later phases replace them with test paths.

## Planned Shape

- The gate is data-first: one registry literal mapping id -> {phase, status,
  testPath, testName}. `PLANNED` ids are allowed; a `DONE` id whose test path no
  longer exists fails the gate.
- Gated/no-action/dismissed ids live in explicit lists so the gate's universe
  equals the audit's universe (no finding silently unaccounted for).
- Mirror `cloneCostGateCompleteness`, extended for server load-count gates.

## Exit Criteria

- [ ] A single completeness gate enumerates every audit finding id and classifies
      it (scheduled-with-test / planned / gated / no-action / dismissed).
- [ ] The gate fails when a `DONE` finding's registered test is missing or
      renamed.
- [ ] The gate fails if a new finding id appears in the audit without a registry
      entry (universe completeness).
- [ ] [`../latest-verification.md`](../latest-verification.md) is refreshed after
      each phase with the maintained full/focused run.

## Validation

- `pnpm test -- src/ts/__tests__/fixCompletenessGate.test.ts` (or the chosen
  path; the standing self-check).
- `pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit`, both TypeScript
  checks — recorded in [`../latest-verification.md`](../latest-verification.md).
