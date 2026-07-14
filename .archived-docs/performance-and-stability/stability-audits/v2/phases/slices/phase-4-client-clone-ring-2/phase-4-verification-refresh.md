# Slice: Phase 4 Verification Refresh

Phase: [4](../../phase-4-client-clone-ring-2.md). Depends on all Phase 4
runtime slices. No runtime change.

Status: complete; proof refreshed on 2026-06-06.

## Scope

Run the focused and full proof set after M7-M10, L32-L34, L37, and K4 land,
then record the Phase 4 proof state. This is a verification and documentation
slice; it should not change runtime behavior.

## Anchors

- [`../../phase-4-client-clone-ring-2.md`](../../phase-4-client-clone-ring-2.md)
  exit criteria.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md):
  M7-M10, L32-L34, L37, K4 rows.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV2.test.ts` from Phase 0.
- `src/ts/__tests__/cloneCostGateCompleteness.test.ts` for clone-cost gate
  registry coverage.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Confirm all Phase 4 IDs are `DONE` in both the v2 gate registry and
  `active-risk-analysis.md`, with each `DONE` entry naming real regression
  tests.
- Re-run every focused suite named by the parent phase and every Phase 4
  runtime slice.
- Re-run the v2 gate and clone-cost gate completeness checks.
- Re-run the full proof set:
  `pnpm test`,
  `pnpm api:test`,
  `pnpm client-thinning:audit`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Add a dated Phase 4 run-log entry to
  [`../../../latest-verification.md`](../../../latest-verification.md) with
  command outcomes and relevant clone-count summaries.
- Check off the parent Phase 4 exit criteria only for commands and assertions
  that actually passed.

## Invariants

- Do not mark an ID `DONE` without a real focused test path and test name.
- Do not silently replace a failed full proof with a narrower command.
- Run the client-lib TypeScript build before the strict Fastify server check.
- This slice should not modify production code.

## Done Criteria

- `latest-verification.md` contains a fresh Phase 4 proof entry.
- M7-M10, L32-L34, L37, and K4 are registered as `DONE` with test evidence in
  the v2 gate and risk map.
- The parent Phase 4 exit criteria match the recorded proof results.

## Result

- Confirmed M7, M8, M9, M10, L32, L33, L34, L37, and K4 are `DONE` in
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` with concrete regression
  tests and in [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
- `pnpm exec vitest run src/ts/process/request/tests/serverMessagePatch.test.ts src/ts/plugins/plugins.test.ts src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/moduleCommands.test.ts src/ts/server/lorebookBridge.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/process/__tests__/command.projectionGuard.test.ts src/lang/index.test.ts`:
  passed, 9 files / 131 tests.
- `pnpm exec vitest run src/ts/process/modules.test.ts src/ts/process/mcp/risuaccess/tests/modules.test.ts src/ts/compatibilityAdapters.test.ts`:
  passed, 3 files / 29 tests.
- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/cloneCostGateCompleteness.test.ts`:
  passed, 2 files / 27 tests.
- `pnpm test`: passed, 126 files; 1202 passed / 4 skipped. The run printed the
  pre-existing local-service `ECONNREFUSED 127.0.0.1:3000` probe noise but
  exited 0.
- `pnpm api:test`: passed, 99 files; 1792 passed / 1 skipped.
- `pnpm client-thinning:audit`: passed (`Client-thinning audit passed.`).
- `pnpm exec tsc -p tsconfig.client-lib.json`: passed with zero diagnostics.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: passed with zero
  diagnostics after the client-lib build.

## Validation

```bash
pnpm exec vitest run src/ts/process/request/tests/serverMessagePatch.test.ts \
  src/ts/plugins/plugins.test.ts \
  src/ts/chatCommands.test.ts \
  src/ts/characterCommands.test.ts \
  src/ts/moduleCommands.test.ts \
  src/ts/server/lorebookBridge.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/process/__tests__/command.projectionGuard.test.ts \
  src/lang/index.test.ts
pnpm exec vitest run src/ts/process/modules.test.ts \
  src/ts/process/mcp/risuaccess/tests/modules.test.ts \
  src/ts/compatibilityAdapters.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts \
  src/ts/__tests__/cloneCostGateCompleteness.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
