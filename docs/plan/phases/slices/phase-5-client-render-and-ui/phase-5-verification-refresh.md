# Slice: Phase 5 Verification Refresh

Phase: [5](../../phase-5-client-render-and-ui.md). Depends on all Phase 5
runtime slices. No runtime change.

## Scope

Run the focused and full proof set after M13, M17, and L38-L44 land, then
record the Phase 5 proof state. This is a verification and documentation
slice; it should not change runtime behavior.

## Anchors

- [`../../phase-5-client-render-and-ui.md`](../../phase-5-client-render-and-ui.md)
  exit criteria.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md):
  M13, M17, and L38-L44 rows.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV2.test.ts` from Phase 0.
- `src/ts/__tests__/renderCostHarness.ts` and
  `src/ts/__tests__/renderCountBaseline.test.ts` from Phase 0.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Confirm all Phase 5 IDs are `DONE` in both the v2 gate registry and
  `active-risk-analysis.md`, with each `DONE` entry naming real regression
  tests.
- Re-run every focused suite named by the parent phase and every Phase 5
  runtime slice.
- Re-run the render-count proof for M17/L40 and record the before/after parse
  count shape.
- Re-run the v2 gate completeness check.
- Re-run the full proof set:
  `pnpm test`,
  `pnpm check`,
  `pnpm client-thinning:audit`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Add a dated Phase 5 run-log entry to
  [`../../../latest-verification.md`](../../../latest-verification.md) with
  command outcomes and relevant render/token/list-count summaries.
- Check off the parent Phase 5 exit criteria only for commands and assertions
  that actually passed.

## Invariants

- Do not mark an ID `DONE` without a real focused test path and test name.
- Do not silently replace a failed full proof with a narrower command.
- Run the client-lib TypeScript build before the strict Fastify server check.
- This slice should not modify production code.

## Done Criteria

- `latest-verification.md` contains a fresh Phase 5 proof entry.
- M13, M17, and L38-L44 are registered as `DONE` with test evidence in the v2
  gate and risk map.
- The parent Phase 5 exit criteria match the recorded proof results.

## Validation

```bash
pnpm exec vitest run src/ts/process/promptTokenizeMemo.test.ts \
  src/lib/Setting/Pages/PromptSettings.svelte.test.ts \
  src/lib/ChatScreens/ChatBody.parseMemo.test.ts \
  src/ts/parser/tests/renderFastPaths.test.ts \
  src/lib/ChatScreens/PartialEditController.sharedHover.test.ts \
  src/lib/Others/GridCatalog.svelte.test.ts \
  src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts \
  src/lib/SideBars/Sidebar.charList.test.ts
pnpm exec vitest run src/ts/__tests__/renderCountBaseline.test.ts \
  src/ts/process/scripts.editdisplay.test.ts \
  src/ts/process/scripts.regexCache.test.ts \
  src/ts/process/triggers.regexMemo.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm check
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
