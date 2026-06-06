# Slice: Phase 3 Verification Refresh

Phase: [3](../../phase-3-assembly-cbs-and-triggers.md). Depends on all Phase
3 runtime slices. No runtime change.

## Scope

Run the focused and full proof set after M1-M4 and L4-L11 land, then record
the Phase 3 proof state. This is a verification and documentation slice; it
should not change runtime behavior.

## Anchors

- [`../../phase-3-assembly-cbs-and-triggers.md`](../../phase-3-assembly-cbs-and-triggers.md)
  exit criteria.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md):
  M1-M4 and L4-L11 rows.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV2.test.ts` from Phase 0.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Confirm M1-M4 and L4-L11 are `DONE` in both the v2 gate registry and
  `active-risk-analysis.md`, with each `DONE` entry naming real regression
  tests.
- Re-run every focused suite named by the parent phase and by each Phase 3
  runtime slice.
- Re-run both gates: the frozen v1 gate and the v2 gate.
- Re-run the protocol metrics prompt-assembly suite with
  `RISU_PROTOCOL_METRICS=1` and record the relevant assembly/CBS cost counts.
- Re-run the full proof set:
  `pnpm test`,
  `pnpm api:test`,
  `pnpm client-thinning:audit`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Add a dated Phase 3 run-log entry to
  [`../../../latest-verification.md`](../../../latest-verification.md) with
  command outcomes and relevant clone/stringify/render/parser count summaries.
- Check off the parent Phase 3 exit criteria only for commands and assertions
  that actually passed.

## Invariants

- Do not silently replace a failed full proof with a narrower command. Focused
  diagnostics may be recorded, but the full command failure remains visible.
- Run the client-lib TypeScript build before the strict Fastify server check.
- If one runtime slice is incomplete, leave its risk-map row and parent exit
  criteria incomplete instead of papering over it in the refresh.
- This slice should not modify production code.

## Done Criteria

- `latest-verification.md` contains a fresh Phase 3 proof entry.
- M1-M4 and L4-L11 are registered as `DONE` with test evidence in the v2 gate
  and risk map.
- The parent Phase 3 exit criteria match the recorded proof results.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/scripts.test.ts \
  server/fastify/__tests__/triggers.test.ts \
  server/fastify/__tests__/templates.test.ts \
  server/fastify/__tests__/promptVariables.test.ts
RISU_PROTOCOL_METRICS=1 pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run \
  src/ts/parser/tests/cbs/eachReinjection.test.ts \
  src/ts/parser/tests
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts \
  src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
