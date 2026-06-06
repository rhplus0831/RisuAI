# Phase 9: Verification Budgets

Status: pending.

Goal: prove the plan is complete, freeze the proofs, and close. Mirrors the
v2 Phase 9 (whose closeout shape is the template:
[`../../archive/audit-stability-and-performance-v2/phases/phase-9-verification-budgets.md`](../../archive/audit-stability-and-performance-v2/phases/phase-9-verification-budgets.md)).

Findings: none (closure for all scheduled IDs).

## Planned Slices

Author under `slices/phase-9-verification-budgets/` when starting.

- registry-sweep — prove every scheduled ID (`H1`, `M1-M9`, `L1-L56`,
  `K1-K4`) is `DONE` or explicitly re-gated with owner sign-off; no
  `PLANNED`/`PENDING` drift between the gate registry,
  [`../active-risk-analysis.md`](../active-risk-analysis.md), and the audit
  doc.
- gate-self-proof-freeze — keep the v3 negative self-proofs alive and
  confirm the v1/v2 gates stay frozen against their archives.
- closing-proof — run the full closeout command set and record the final
  proof log in [`../latest-verification.md`](../latest-verification.md).
- archive-and-repoint — move the closed v3 plan to
  `docs/archive/audit-stability-and-performance-v3/`, repoint the v3 gate at
  the archive (the v2 Phase 9 precedent), and update `STRUCTURE.md` +
  `docs/archive/README.md`.

## Exit Criteria

- [ ] Registry sweep clean: every scheduled row `DONE` (or re-gated with a
      recorded owner decision); gate/risk-map/audit-index alignment proven.
- [ ] All three gates green; v3 negative self-proofs in place.
- [ ] Closing run recorded: both prior gates + the v3 gate, `pnpm test`,
      `pnpm api:test`, `pnpm client-thinning:audit`, both TypeScript checks.
- [ ] Plan archived; v3 gate repointed; navigation docs updated.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
