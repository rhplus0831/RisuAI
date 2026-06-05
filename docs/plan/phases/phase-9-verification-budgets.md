# Phase 9: Verification Budgets

Status: pending. Runs continuously from Phase 0's scaffold; closes the plan.

Goal: the v2 fix-completeness gate stays complete and self-checking — every
scheduled finding ID is registered, every `DONE` ID keeps a real regression
test, and the registry mirrors
[`../active-risk-analysis.md`](../active-risk-analysis.md) exactly. At close,
a full closing verification run is recorded.

Findings: none (verification budget over H1-H3, M1-M22, the scheduled L set,
and K1-K4).

## Standing Contract

- The v2 gate (`src/ts/__tests__/fixCompletenessGateV2.test.ts`, authored in
  Phase 0) is the single budget surface:
  - `SCHEDULED_FIXES` registers every scheduled ID with phase + status;
    `PLANNED` entries claim no test; `DONE` entries name an existing
    `testPath` (+ `testName` the file must contain), with `extraTests` for
    multi-proof fixes.
  - `INTENTIONALLY_GATED` (L12 + the v1 carry-over references) and
    `NO_ACTION` (I1-I18, R1-R13) keep the registry universe equal to the
    audit universe.
  - Self-checks parse both v2 docs; a new audit ID, a phase/status mismatch,
    a double classification, or a `DONE` ID with a missing/renamed test all
    fail the suite. A negative self-proof keeps the checker honest.
- Flip contract: a fix flips the registry entry and the
  [`../active-risk-analysis.md`](../active-risk-analysis.md) row to `DONE`
  in the same commit, then refreshes
  [`../latest-verification.md`](../latest-verification.md).
- The v1 gate (`fixCompletenessGate.test.ts`) stays frozen against
  `docs/archive/audit-stability-and-performance/` and must remain green; it
  guards the v1 regression tests from deletion/rename.

## Exit Criteria

- [ ] Every scheduled ID is `DONE` in both the registry and the risk map (or
      explicitly re-gated with an owner-approved reason).
- [ ] No `PLANNED` entries remain; the negative self-proof still passes.
- [ ] Closing full run recorded in
      [`../latest-verification.md`](../latest-verification.md): `pnpm test`,
      `pnpm api:test`, `pnpm client-thinning:audit`, both TypeScript checks.
- [ ] The plan directory is archived per the established convention once
      closed, with both gates re-pointed accordingly.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
