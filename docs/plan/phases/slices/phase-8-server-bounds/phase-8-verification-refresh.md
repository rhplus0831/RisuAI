# Slice: Phase 8 Verification Refresh

Phase: [8](../../phase-8-server-bounds.md). Depends on all Phase 8 runtime
slices. No runtime change.

## Scope

Run the focused and full proof set after L1, L2, L15, and L17-L31 land, then
record the Phase 8 proof state. This is a verification and documentation slice;
it should not change runtime behavior.

## Anchors

- [`../../phase-8-server-bounds.md`](../../phase-8-server-bounds.md) exit
  criteria.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md): L1,
  L2, L15, and L17-L31 rows.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Confirm every Phase 8 runtime finding is `DONE` in both the v2 gate registry
  and `active-risk-analysis.md`, with each `DONE` entry naming real regression
  tests.
- Re-run every focused suite named by the parent phase and by the Phase 8
  runtime slices.
- Re-run the v2 gate.
- Re-run the full server proof set:
  `pnpm api:test`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Re-run the broader proof set if Phase 8 touched shared client/server helpers:
  `pnpm test` and `pnpm client-thinning:audit`.
- Add a dated Phase 8 run-log entry to
  [`../../../latest-verification.md`](../../../latest-verification.md) with
  command outcomes and relevant timeout, retention, memory, import/export,
  proxy, and Vertex dedupe assertions.
- Check off the parent Phase 8 exit criteria only for commands and assertions
  that actually passed.

## Invariants

- Do not mark an ID `DONE` without a real focused test path and test name.
- Do not silently replace a failed full proof with a narrower command. Focused
  diagnostics may be recorded, but the full command failure remains visible.
- Run the client-lib TypeScript build before the strict Fastify server check.
- This slice should not modify production code.

## Done Criteria

- `latest-verification.md` contains a fresh Phase 8 proof entry.
- L1, L2, L15, and L17-L31 are registered as `DONE` with test evidence in the
  v2 gate and risk map.
- The parent Phase 8 exit criteria match the recorded proof results.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/streamJobsRoutes.test.ts \
  server/fastify/__tests__/durableGeneration.test.ts \
  server/fastify/__tests__/requestAbort.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryRepository.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts \
  server/fastify/__tests__/memoryChunkPlanner.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/risuSaveBundleExportRoute.test.ts \
  server/fastify/__tests__/legacyStorage.test.ts \
  server/fastify/__tests__/risuSaveImportRoute.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/hub.test.ts \
  server/fastify/__tests__/proxy.test.ts \
  server/fastify/__tests__/vertexAuth.test.ts \
  server/fastify/__tests__/db.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm api:test
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
