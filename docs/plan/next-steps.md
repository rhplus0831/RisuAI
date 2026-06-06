# Next Steps

Date: 2026-06-06

Phases 1-8 are implemented and proof-refreshed. Phase 9 is the remaining open closeout batch.

## Completed Batch: Phase 4 (Client Clone Narrowing Ring 2)

Client clone narrowing ring 2 is complete and proof-refreshed:
M7-M10, L32-L34, L37, and K4 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 4 proof
refresh passed focused clone/rollback suites, v2 and clone-cost gates,
`pnpm test` (1202 passed / 4 skipped), `pnpm api:test` (1792 passed / 1
skipped), `pnpm client-thinning:audit`, and both TypeScript checks. See
[`latest-verification.md`](latest-verification.md).

## Completed Batch: Phase 5 (Client Render & UI)

Client render and UI work is complete and proof-refreshed:
M13, M17, and L38-L44 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 5 proof
refresh passed focused render/UI suites, render-count/script proof, parser
companion suites, both gates, `pnpm test` (1193 passed / 4 skipped),
`pnpm client-thinning:audit`, and both TypeScript checks. The repository-wide
`pnpm check` still reports the pre-existing 14-error baseline. See
[`latest-verification.md`](latest-verification.md).

## Completed Batch: Phase 6 (Bridges, Lifecycle & Network)

Bridge, lifecycle, and network work is complete and proof-refreshed:
M11, M12, M14, L35, L36, and L45-L47 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 6 proof
refresh passed focused bridge/lifecycle/network suites, v2 and clone-cost
gates, `pnpm test` (1185 passed / 4 skipped), `pnpm api:test` (1792 passed /
1 skipped), `pnpm client-thinning:audit`, and both TypeScript checks. The
repository-wide `pnpm check` still reports the pre-existing 14-error baseline.
See [`latest-verification.md`](latest-verification.md).

## Completed Batch: Phase 7 (Opt-In Subsystems)

Opt-in subsystem stability work is complete and proof-refreshed:
M15, M16, M18-M22, L48-L59, and K3 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 7 proof
refresh passed focused translate/UI/TTS/MCP/file-import suites, parent phase
validation snippets, both gates, `pnpm test` (1212 passed / 4 skipped),
`pnpm api:test` (1792 passed / 1 skipped), `pnpm client-thinning:audit`, and
both TypeScript checks. See [`latest-verification.md`](latest-verification.md).

## Completed Batch: Phase 8 (Server Jobs, Memory & Import Bounds)

Server-bound work is complete and proof-refreshed: L1, L2, L15, and L17-L31
are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 8 proof refresh
passed focused server-bound suites (17 files / 297 tests), the v2 gate
(18 tests), `pnpm api:test` (1846 passed / 1 skipped), and both TypeScript
checks. See [`latest-verification.md`](latest-verification.md).

## Next Batch: Phase 9 (Verification Budgets)

Verification-budget closeout is defined in
[`phases/phase-9-verification-budgets.md`](phases/phase-9-verification-budgets.md):

1. Final registry sweep: prove every scheduled ID is `DONE` or explicitly
   re-gated, with no remaining `PLANNED` / `PENDING` drift.
2. Gate self-proof freeze: keep the v2 negative self-proofs alive and confirm
   the v1 gate stays frozen against its archive.
3. Closing proof: run the full closeout command set and record the final proof
   log.
4. Archive: move the closed v2 plan to the archive and repoint the live gates.

## Guardrails

- Do not mark the plan closed until both gates, `pnpm test`, `pnpm api:test`,
  `pnpm client-thinning:audit`, and both TypeScript checks are recorded.
- Keep L12 and the v1 carry-over gates explicitly gated unless owner approval
  changes their routing.
- Keep all Phase 1-8 proof paths real; the v2 gate should fail if a registered
  test file or test name drifts.

## Proof Commands

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Current Validation Caveats

Phases 4-8 are green for focused suites, gates, final merged root/API proof,
client-thinning audit, and TypeScript checks. The remaining nonzero baseline
in [`latest-verification.md`](latest-verification.md) is `pnpm check`
retaining its 14-error svelte-check baseline.
