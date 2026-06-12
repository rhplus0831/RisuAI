# Slice: Per-Assembly Invariants

Phase: [7](../../phase-7-assembly-and-trigger-hot-paths.md). Findings:
L6 and L7. Server prompt/lorebook allocation change.

## Scope

Hoist per-message and per-query invariant allocations out of the prompt
assembly loops: the char+module asset table used by asset prompts and asset
lookup, and the lorebook depth-slice plus recursive-entry array used by
keyword search.

This slice owns the asset table shared by `history.ts` and `assetLookup.ts`,
and the entry-list inputs used by `searchMatch`. It does not change asset
priority, lorebook activation semantics, recursion depth limits, keyword
matching, prompt row order, or token budgeting.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L6 and L7.
- `server/fastify/src/prompt/history.ts`: `processAssetPrompts`,
  `processInlays`, and the per-message asset concat loop.
- `server/fastify/src/prompt/assetLookup.ts`: `buildAssetLookup` and the
  duplicate char+module asset table construction.
- `server/fastify/src/prompt/assemble.ts`: per-assembly construction point
  for shared prompt helpers.
- `server/fastify/src/prompt/lorebook.ts`: `searchMatch`,
  `baseSearchEntriesForDepth`, `recursiveEntries`, and the activation loop.
- Focused tests:
  `server/fastify/__tests__/assemble.test.ts`,
  `server/fastify/__tests__/lorebook.test.ts`, and
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Build the char+module asset table once per assembly and pass it to both
  `buildAssetLookup` and `processAssetPrompts`.
- Keep the table order and lookup behavior identical to the old two build
  sites. If duplicate asset names or references exist, the winning entry must
  remain the same.
- Stop rebuilding that table once per history message. The per-message loop
  should reuse the precomputed table and only do message-specific work.
- Precompute lorebook search entry arrays that combine the depth slice and
  recursive entries without allocating on every `searchMatch` call. Acceptable
  shapes include memoizing one combined array per search depth, or passing a
  preselected entry iterable into `searchMatch`.
- Preserve recursive activation behavior. A recursive pass must still see the
  same recursive entries and produce the same activation report.
- Add allocation/count probes for the two hoists: one showing the asset table
  is built once per assembly, and one showing search-depth plus recursive
  arrays are not concatenated per query.
- Register L6 and L7 as `DONE` in the v3 gate and flip only those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Prompt rows, multimodal asset payloads, and `getAsset(name)` output remain
  byte-identical.
- Lorebook activation results, depth prompt placement, and recursive entries
  remain identical.
- Hoisted tables are scoped to one assembly and do not persist across sends.
- No lorebook or asset collection mutation may leak through shared arrays.
- Request-scoped stored-asset cache behavior remains unchanged.

## Done Criteria

- The char+module asset table is built once per assembly and shared by
  `buildAssetLookup` and `processAssetPrompts`.
- An N-message history no longer performs N identical asset-table concats.
- Lorebook search no longer allocates a combined depth+recursive array per
  query.
- Focused fixtures prove asset prompt output and lorebook activation reports
  are unchanged.
- L6 and L7 are registered as `DONE` in the v3 gate and active-risk table,
  with no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
