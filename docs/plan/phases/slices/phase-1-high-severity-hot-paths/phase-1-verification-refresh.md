# Slice: Phase 1 Verification Refresh

Phase: [1](../../phase-1-high-severity-hot-paths.md). Depends on
[`chat-create-targeted-writer-kit.md`](chat-create-targeted-writer-kit.md),
[`var-only-gui-reload-narrowing.md`](var-only-gui-reload-narrowing.md), and
[`trigger-interpreter-budget-and-abort.md`](trigger-interpreter-budget-and-abort.md).
No runtime change.

## Scope

Run the focused and full proof set after H2, H3, and H1 land, then record the
Phase 1 proof state. This is a verification/documentation slice; it should not
change runtime behavior.

## Anchors

- [`../../phase-1-high-severity-hot-paths.md`](../../phase-1-high-severity-hot-paths.md)
  exit criteria.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) H1-H3
  rows.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV2.test.ts` from Phase 0.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Confirm H1, H2, and H3 are `DONE` in both the v2 gate registry and
  `active-risk-analysis.md`, with each `DONE` entry naming real regression
  tests.
- Re-run the focused H2/H3/H1 suites listed in the parent phase validation.
- Re-run both gates: the frozen v1 gate and the v2 gate.
- Re-run the full proof set:
  `pnpm test`,
  `pnpm api:test`,
  `pnpm client-thinning:audit`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Add a dated Phase 1 run-log entry to
  [`../../../latest-verification.md`](../../../latest-verification.md) with
  command outcomes and any relevant load/render/budget counts.
- Check off the parent Phase 1 exit criteria only for commands and assertions
  that actually passed.

## Invariants

- Do not silently replace a failed proof with a narrower command. Focused
  diagnostics may be recorded, but the full command failure remains visible.
- Run the client-lib TypeScript build before the strict Fastify server check.
- If one H1-H3 slice is incomplete, leave its risk-map row and parent exit
  criteria incomplete instead of papering over it in the refresh.

## Done Criteria

- `latest-verification.md` contains a fresh Phase 1 proof entry.
- H1-H3 are registered as `DONE` with test evidence in the v2 gate and risk map.
- The parent Phase 1 exit criteria match the recorded proof results.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/triggers.test.ts
pnpm exec vitest run src/ts/process/__tests__/streamResponse.test.ts src/ts/process/triggers.regexMemo.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
