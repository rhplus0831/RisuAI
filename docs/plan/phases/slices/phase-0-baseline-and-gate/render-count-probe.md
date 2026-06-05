# Slice: Render-Count Probe + Baseline Refresh

Phase: [0](../../phase-0-baseline-and-gate.md). No runtime change.

## Scope

Add a countable proof signal for the client render findings (H3, M17, L40):
a test helper that counts full-parse invocations (`ParseMarkdown` /
`risuChatParser` / `processScriptFull('editdisplay')`) across a simulated
`ReloadGUIPointer` bump with N mounted messages. Then re-run the full proof
set and record the v2 baseline in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Anchors

- `src/ts/stores.svelte.ts` (`ReloadGUIPointer.subscribe` — the bump +
  `resetScriptCache()` pair under test).
- `src/ts/process/scripts.ts` (`processScriptCache`, `compiledRegexCache`,
  `resetScriptCache`).
- Harness precedents: `src/ts/__tests__/cloneCostHarness.ts` (counting
  wrappers), `src/ts/process/__tests__/streamResponse.test.ts` (the v1 H3
  bounded-parse proof), the counting-RegExp-subclass technique from the v1
  Phase 7 regex-memo tests.

## Target Shape

- A helper (e.g. `src/ts/__tests__/renderCostHarness.ts`) that wraps the
  parse entry points with counters, mounts/simulates N message renders,
  fires a var-only `ReloadGUIPointer` bump, and reports
  `{ parsesBeforeBump, parsesAfterBump, cacheWiped }`.
- A baseline test recording today's behavior (bump => N cold re-parses,
  caches wiped) marked as the pre-fix contract — Phase 1 H3 flips its
  assertions and registers the gate entry.
- No production-code changes; test-only counters.

## Done Criteria

- The probe runs in the client suite and its baseline numbers are recorded
  in `latest-verification.md`.
- Full proof set re-run and logged: `pnpm test`, `pnpm api:test`,
  `pnpm client-thinning:audit`, both TypeScript checks.

## Validation

```bash
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
