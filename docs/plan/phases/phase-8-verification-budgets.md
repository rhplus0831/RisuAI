# Phase 8: Verification Budgets

Status: not started (standing). The fix-completeness gate that keeps every
scheduled fix's regression proof registered and self-checking, plus the
maintained verification record.

Goal: prevent silent regression. Every fix in Phases 1-7 registers its regression
test by finding id in a single completeness map; the gate fails if a registered
gate is missing, renamed, or deleted, or if a scheduled finding lands runtime
code without a registered proof. Refresh
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
  the standing completeness gate: a map from each scheduled finding id to its
  regression test (file + name), an `INTENTIONALLY_GATED` list for L4/L7/L26/U2
  and a `NO_ACTION` list for U3 + the five dismissed candidates, and a self-check
  that fails on drift. Phase 0 seeds it with `PLANNED` entries; each phase flips
  its ids to a registered test path as it lands.

## Planned Shape

- The gate is data-first: one registry literal mapping id -> {phase, status,
  testPath, testName}. `PLANNED` ids are allowed; a `DONE` id whose test path no
  longer exists fails the gate.
- Gated/no-action/dismissed ids live in explicit lists so the gate's universe
  equals the audit's universe (no finding silently unaccounted for).
- Mirrors the client `cloneCostGateCompleteness` self-check (scan + assert),
  extended to cover server-side load-count gates.

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
