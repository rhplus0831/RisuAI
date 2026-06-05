# Slice: Phase 6 Verification Refresh

Phase: [6](../../phase-6-bridges-lifecycle-network.md). Depends on all Phase 6
runtime slices. No runtime change.

## Scope

Run the focused and full proof set after M11, M12, M14, L35, L36, and L45-L47
land, then record the Phase 6 proof state. This is a verification and
documentation slice; it should not change runtime behavior.

## Anchors

- [`../../phase-6-bridges-lifecycle-network.md`](../../phase-6-bridges-lifecycle-network.md)
  exit criteria.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md):
  M11, M12, M14, L35, L36, L45, L46, L47 rows.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Confirm every Phase 6 runtime finding is `DONE` in both the v2 gate registry
  and `active-risk-analysis.md`, with each `DONE` entry naming real regression
  tests.
- Re-run every focused suite named by the parent phase and by the Phase 6
  runtime slices.
- Re-run the v2 gate.
- Re-run the full proof set:
  `pnpm test`,
  `pnpm client-thinning:audit`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Add a dated Phase 6 run-log entry to
  [`../../../latest-verification.md`](../../../latest-verification.md) with
  command outcomes and any relevant listener-count, reconnect-delay, and
  bounded-map summaries.
- Check off the parent Phase 6 exit criteria only for commands and assertions
  that actually passed.

## Invariants

- Do not mark an ID `DONE` without a real focused test path and test name.
- Do not silently replace a failed full proof with a narrower command.
- Run the client-lib TypeScript build before the strict Fastify server check.
- This slice should not modify production code.

## Done Criteria

- `latest-verification.md` contains a fresh Phase 6 proof entry.
- M11, M12, M14, L35, L36, L45, L46, and L47 are registered as `DONE` with
  test evidence in the v2 gate and risk map.
- The parent Phase 6 exit criteria match the recorded proof results.

## Validation

```bash
pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/lorebookBridge.test.ts src/ts/server/characterBridge.svelte.test.ts
pnpm exec vitest run src/ts/observer.svelte.test.ts
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/bootstrap.test.ts src/ts/server/events.test.ts
pnpm exec vitest run src/ts/process/prereroll.test.ts src/ts/process/rerollNavigation.test.ts src/ts/process/rerollNavigation.guard.test.ts src/ts/process/rerollNavigation.rollback.test.ts
pnpm exec vitest run src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/mcplib.test.ts src/ts/globalApi.fetchNative.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
