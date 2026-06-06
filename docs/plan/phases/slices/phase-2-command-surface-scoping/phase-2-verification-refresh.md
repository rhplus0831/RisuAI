# Slice: Phase 2 Verification Refresh

Phase: [2](../../phase-2-command-surface-scoping.md). Depends on all Phase 2
runtime slices:
[`send-persist-chat-scoped-read.md`](send-persist-chat-scoped-read.md),
[`settings-scoped-read.md`](settings-scoped-read.md),
[`collection-scoped-reads.md`](collection-scoped-reads.md),
[`drop-validate-only-normalization.md`](drop-validate-only-normalization.md),
[`plugin-storage-skip-load.md`](plugin-storage-skip-load.md),
[`single-lorebook-hydration-scope.md`](single-lorebook-hydration-scope.md),
and [`proxy-hub-single-auth.md`](proxy-hub-single-auth.md). Proof-only slice.

## Scope

Run the Phase 2 proof set after M1, M3, L11, L12, L13, L14, and K2 land, then
record the refreshed results in
[`../../../latest-verification.md`](../../../latest-verification.md). This
slice should not introduce runtime behavior.

## Anchors

- [`../../phase-2-command-surface-scoping.md`](../../phase-2-command-surface-scoping.md)
  exit criteria and validation list.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md):
  M1, M3, L11, L12, L13, L14, and K2 rows.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`: Phase 2 `DONE`
  registrations.
- Focused server suites:
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`,
  `server/fastify/__tests__/commandMutationReadNarrowing.test.ts`,
  `server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts`,
  `server/fastify/__tests__/commandCollectionRange.test.ts`,
  `server/fastify/__tests__/commandMutationBudget.test.ts`,
  `server/fastify/__tests__/commands.test.ts`,
  `server/fastify/__tests__/projection.test.ts`,
  `server/fastify/__tests__/proxy.test.ts`,
  `server/fastify/__tests__/hub.test.ts`,
  `server/fastify/__tests__/routeProtection.test.ts`.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Add a dated Phase 2 run-log entry to `latest-verification.md`.
- Record command outcomes for the v1/v2/v3 gates, focused Phase 2 suites,
  `pnpm api:test`, and both TypeScript checks.
- Record load-count proof for:
  M1 no-var assembly transcript persistence, M3 settings routes, L11
  collection families, L13 plugin-storage PUT/DELETE, and L14 single lorebook
  hydration.
- Record L12 proof that route-local validation remains and corpus-wide
  validate-only passes no longer run.
- Record K2 proof that protected proxy/hub requests verify auth exactly once
  and unauthorized requests still stop before upstream forwarding/body parse.
- If a command fails or is skipped, keep that visible with the reason and any
  narrower diagnostic command that was run afterward.

## Invariants

- Do not change runtime code in this slice.
- Do not mark an ID complete unless its active-risk row and v3 gate entry
  already agree on `DONE` with focused test paths.
- Do not silently substitute a focused command for a failed full command.
- Run `pnpm exec tsc -p tsconfig.client-lib.json` before the strict Fastify
  server check.
- Preserve older verification entries; append a new Phase 2 entry.

## Done Criteria

- `latest-verification.md` has a fresh Phase 2 entry with all requested
  command outcomes and proof notes.
- Parent Phase 2 exit criteria can be checked directly against the recorded
  proof.
- M1, M3, L11, L12, L13, L14, and K2 are the only Phase 2 IDs flipped to
  `DONE`.
- No Phase 3+ implementation work is included in this proof slice.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/commandSettingsAndPluginStorageRange.test.ts \
  server/fastify/__tests__/commandCollectionRange.test.ts \
  server/fastify/__tests__/commandMutationBudget.test.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/projection.test.ts \
  server/fastify/__tests__/proxy.test.ts \
  server/fastify/__tests__/hub.test.ts \
  server/fastify/__tests__/routeProtection.test.ts
pnpm api:test
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
