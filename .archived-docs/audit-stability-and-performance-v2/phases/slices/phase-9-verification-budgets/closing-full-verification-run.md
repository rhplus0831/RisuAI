# Slice: Closing Full Verification Run

Phase: [9](../../phase-9-verification-budgets.md). Depends on
[`registry-universe-final-sweep.md`](registry-universe-final-sweep.md) and
[`gate-self-proof-freeze.md`](gate-self-proof-freeze.md). No runtime change.

## Scope

Run and record the final full verification set for the v2 remediation plan
after all scheduled IDs are `DONE` or explicitly re-gated.

This slice does not archive the plan; it prepares the proof record that the
archive slice will preserve.

## Anchors

- [`../../phase-9-verification-budgets.md`](../../phase-9-verification-budgets.md)
  validation block.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- [`../../../status.md`](../../../status.md) and
  [`../../../next-steps.md`](../../../next-steps.md) for open-plan state.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Run the gate pair first so registry/doc drift is caught before the slower
  full proof set.
- Run the full closeout commands:
  `pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Record a dated closeout entry in
  [`../../../latest-verification.md`](../../../latest-verification.md) with
  command outcomes, pass/skip counts where available, and any known
  pre-existing non-blocking baseline.
- Update parent Phase 9 exit criteria for the registry, no-`PLANNED`, and
  closing-run items only after the commands pass.
- Leave archive movement and gate doc-root repointing to
  [`archive-plan-and-gate-repoint.md`](archive-plan-and-gate-repoint.md).

## Invariants

- Run `pnpm exec tsc -p tsconfig.client-lib.json` before the strict Fastify
  server check.
- Do not replace a failed full command with a narrower proof. Record focused
  diagnostics separately, then keep the full command failure visible.
- Do not mark the plan closed until the archive slice lands.
- This slice should not modify production code.

## Done Criteria

- `latest-verification.md` contains the final full closeout run.
- The parent Phase 9 closing-run exit criterion is checked only if every
  required command passed.
- The archive slice can proceed without rerunning the full suite unless it
  changes executable gate code.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
