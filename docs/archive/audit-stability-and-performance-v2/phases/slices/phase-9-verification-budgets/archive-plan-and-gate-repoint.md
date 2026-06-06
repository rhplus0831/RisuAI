# Slice: Archive Plan And Gate Repoint

Phase: [9](../../phase-9-verification-budgets.md). Depends on
[`closing-full-verification-run.md`](closing-full-verification-run.md). No
runtime change.

## Scope

Archive the closed v2 remediation plan and repoint the live completeness gates
so both v1 and v2 regression-test registries stay active against archived docs.

This slice is the final Phase 9 slice.

## Anchors

- [`../../phase-9-verification-budgets.md`](../../phase-9-verification-budgets.md)
  final exit criterion.
- [`../../../README.md`](../../../README.md),
  [`../../../status.md`](../../../status.md),
  [`../../../next-steps.md`](../../../next-steps.md), and
  [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGate.test.ts`.
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- Existing archive precedent:
  [`../../../../audit-stability-and-performance/README.md`](../../../../audit-stability-and-performance/README.md).

## Target Shape

- Move the closed v2 plan directory from `docs/plan/` to
  `docs/archive/audit-stability-and-performance-v2/`, unless the maintainer has
  already established a different archive name in the same style.
- Add an archive banner to the archived README with the close date, final proof
  summary, and the live v2 gate path.
- Update archived `status.md`, `next-steps.md`, `phases/README.md`, and parent
  Phase 9 checkboxes to say the plan is closed.
- Repoint `fixCompletenessGateV2.test.ts` from `docs/plan/` to
  `docs/archive/audit-stability-and-performance-v2/`.
- Keep `fixCompletenessGate.test.ts` pointed at
  `docs/archive/audit-stability-and-performance/`.
- Update any top-level navigation that previously treated `docs/plan/` as the
  open v2 plan so readers land on the archived record or on the next active
  plan if one exists.

## Invariants

- Do not drop `latest-verification.md`; it is part of the archive evidence.
- Do not weaken either gate while changing doc roots.
- Preserve relative links inside the archived plan where possible; repair only
  links that break because the directory moved.
- Do not delete the v1 archive or mix the v1 and v2 gate registries.

## Done Criteria

- The v2 plan exists under `docs/archive/audit-stability-and-performance-v2/`
  with closed status and the recorded closeout run.
- `src/ts/__tests__/fixCompletenessGateV2.test.ts` passes against the archived
  v2 docs.
- `src/ts/__tests__/fixCompletenessGate.test.ts` still passes against the v1
  archive.
- The final parent Phase 9 exit criterion is checked.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
