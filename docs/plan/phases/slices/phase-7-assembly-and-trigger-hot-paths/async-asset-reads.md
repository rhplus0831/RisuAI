# Slice: Async Asset Reads

Phase: [7](../../phase-7-assembly-and-trigger-hot-paths.md). Finding:
L1. Server prompt-assembly hot-path performance change.

## Scope

Move assembly-time stored-asset byte reads off the event loop while preserving
the existing request-scoped asset cache and byte output.

This slice owns the stored-asset resolver used by chat generation assembly,
plus the prompt-history and asset-lookup call sites that request in-context
asset bytes. It does not change asset upload, asset serving routes, stored
asset authorization/path validation, multimodal prompt shape, or provider
dispatch behavior.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L1.
- `server/fastify/src/routes/generationChat.ts`: `readStoredAsset`,
  `createRequestScopedStoredAssetResolver`, `loadDatabaseDeps`, and chat
  assembly route wiring.
- `server/fastify/src/prompt/assetLookup.ts`: `ResolveStoredAsset`,
  `buildAssetLookup`, `getAsset`, and cache-key expectations.
- `server/fastify/src/prompt/history.ts`: `processInlays` and
  `processAssetPrompts` consumers of stored asset bytes.
- `server/fastify/src/routes/assets.ts`: streaming read precedent for the
  colder serving route.
- Focused tests:
  `server/fastify/__tests__/assemble.test.ts` and
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Replace the send hot path's synchronous `fs.readFileSync` work with async
  reads. Acceptable shapes include making `ResolveStoredAsset` async and
  awaiting it through the prompt consumers, or pre-resolving every referenced
  stored asset with `fs.promises.readFile` before entering the synchronous
  assembler and seeding the existing request-scoped resolver cache.
- Preserve the request-scoped memo semantics: the cache key remains
  `purpose:id`, repeated references to the same stored asset read once, and
  distinct assets stay bounded by the assets actually referenced by that send.
- Keep path safety and not-found behavior identical. Missing or invalid asset
  references should surface the same assembly/provider-visible outcome as
  before, except for any intentionally improved async error wording.
- Keep asset byte encoding identical. Base64 payloads, MIME/type metadata, and
  text prompt substitutions must match the old sync path.
- Add a focused probe that proves an image-bearing send performs zero
  synchronous file reads in assembly. Prefer spying on `fs.readFileSync` or
  injecting a counted sync reader so the proof is not timing-based.
- Register L1 as `DONE` in the v3 gate and flip only the L1 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- No synchronous file reads may remain on the assembly asset path.
- Asset prompt output is byte-identical for cached and uncached references.
- Repeated references to one stored asset in the same send still share one
  read result.
- Distinct assets are still read independently and only when referenced.
- Asset serving routes and cache headers remain out of scope.

## Done Criteria

- An image-bearing chat send completes with zero assembly-time
  `readFileSync` calls.
- A repeated in-context asset reference reads bytes once and reuses the
  request-scoped cache.
- Missing, invalid, and valid stored asset references preserve the old visible
  behavior.
- L1 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
