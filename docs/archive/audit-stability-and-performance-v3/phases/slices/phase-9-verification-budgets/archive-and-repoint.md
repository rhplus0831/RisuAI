# Slice: Archive And Repoint

Phase: [9](../../phase-9-verification-budgets.md). Depends on
[`closing-proof.md`](closing-proof.md). No runtime change.

## Scope

Archive the closed v3 remediation plan and repoint the v3 completeness gate so
all three regression-test registries stay active against archived docs.

This slice is the final Phase 9 slice.

## Anchors

- [`../../phase-9-verification-budgets.md`](../../phase-9-verification-budgets.md)
  final exit criterion.
- [`../../../README.md`](../../../README.md),
  [`../../../status.md`](../../../status.md),
  [`../../../next-steps.md`](../../../next-steps.md), and
  [`../../../latest-verification.md`](../../../latest-verification.md).
- [`../../../../README.md`](../../../../README.md).
- `STRUCTURE.md`.
- `src/ts/__tests__/fixCompletenessGate.test.ts`.
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`.
- Existing archive precedent:
  [`../../../../audit-stability-and-performance-v2/README.md`](../../../../audit-stability-and-performance-v2/README.md).

## Target Shape

- Move the closed v3 plan directory from `docs/plan/` to
  `docs/archive/audit-stability-and-performance-v3/`, unless the maintainer
  has already established a different archive name in the same style.
- Add an archive banner to the archived README with the close date, final proof
  summary, and the live v3 gate path.
- Update archived `status.md`, `next-steps.md`, `phases/README.md`, and parent
  Phase 9 checkboxes to say the plan is closed.
- Repoint `fixCompletenessGateV3.test.ts` from `docs/plan/` to
  `docs/archive/audit-stability-and-performance-v3/`.
- Keep `fixCompletenessGate.test.ts` pointed at
  `docs/archive/audit-stability-and-performance/`.
- Keep `fixCompletenessGateV2.test.ts` pointed at
  `docs/archive/audit-stability-and-performance-v2/`.
- Update `STRUCTURE.md`, `docs/archive/README.md`, and any top-level plan
  navigation that previously treated `docs/plan/` as the open v3 plan so
  readers land on the archived record or on the next active plan if one
  exists.

## Invariants

- Do not drop `latest-verification.md`; it is part of the archive evidence.
- Do not weaken any gate while changing doc roots.
- Preserve relative links inside the archived plan where possible; repair only
  links that break because the directory moved.
- Do not delete the v1/v2 archives or mix v1, v2, and v3 gate registries.
- Keep the final archive move docs-only except for gate doc-root constants and
  navigation references.

## Done Criteria

- The v3 plan exists under
  `docs/archive/audit-stability-and-performance-v3/` with closed status and
  the recorded closeout run.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` passes against the archived
  v3 docs.
- `src/ts/__tests__/fixCompletenessGate.test.ts` and
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` still pass against the v1
  and v2 archives.
- `STRUCTURE.md` and `docs/archive/README.md` route readers to the closed v3
  archive.
- The final parent Phase 9 exit criterion is checked.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
