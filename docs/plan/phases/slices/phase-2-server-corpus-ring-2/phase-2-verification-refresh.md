# Slice: Phase 2 Verification Refresh

Phase: [2](../../phase-2-server-corpus-ring-2.md). Depends on all Phase 2
runtime slices. No runtime change.

## Scope

Run the focused and full proof set after M5, M6, L3, L13, L14, L16, K1, and
K2 land, then record the Phase 2 proof state. This is a verification and
documentation slice; it should not change runtime behavior.

## Anchors

- [`../../phase-2-server-corpus-ring-2.md`](../../phase-2-server-corpus-ring-2.md)
  exit criteria.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md):
  M5, M6, L3, L13, L14, L16, K1, K2 rows.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Confirm every Phase 2 runtime finding is `DONE` in both the v2 gate registry
  and `active-risk-analysis.md`, with each `DONE` entry naming real regression
  tests.
- Re-run the focused suites named by the parent phase and by each slice.
- Re-run both gates: the frozen v1 gate and the v2 gate.
- Re-run the full proof set:
  `pnpm test`,
  `pnpm api:test`,
  `pnpm client-thinning:audit`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Add a dated Phase 2 run-log entry to
  [`../../../latest-verification.md`](../../../latest-verification.md) with
  command outcomes and relevant load-count/metric summaries.
- Check off the parent Phase 2 exit criteria only for commands and assertions
  that actually passed.

## Invariants

- Do not silently replace a failed full proof with a narrower command. Focused
  diagnostics may be recorded, but the full command failure remains visible.
- Run the client-lib TypeScript build before the strict Fastify server check.
- If one runtime slice is incomplete, leave its risk-map row and parent exit
  criteria incomplete instead of papering over it in the refresh.
- This slice should not modify production code.

## Done Criteria

- `latest-verification.md` contains a fresh Phase 2 proof entry.
- M5, M6, L3, L13, L14, L16, K1, and K2 are registered as `DONE` with test
  evidence in the v2 gate and risk map.
- The parent Phase 2 exit criteria match the recorded proof results.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/projection.test.ts \
  server/fastify/__tests__/assetGc.test.ts
RISU_COMMAND_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commandMetrics.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/generation.completion.test.ts \
  server/fastify/__tests__/messageStore.test.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/auth.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts \
  src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
