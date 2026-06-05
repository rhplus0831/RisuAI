# Slice: Inlay Image And Blob Cache Bounds

Phase: [7](../../phase-7-opt-in-subsystems.md). Findings: L49, L50, K3.
Runtime change.

## Scope

Make inlay image writes settle on broken or already-loaded images, bound and
revoke parser blob URLs, and check the blob URL cache before fetching inlay
asset bytes.

This slice owns only the cheap cache-ordering residual for K3. It does not
re-open the broader leftover gate for bulk per-asset byte fanout.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L49 and L50; K3 under Known-Overlap Residuals.
- `src/ts/process/files/inlays.ts`: `writeInlayImage`, image load handling,
  `getInlayAssetBlob`.
- `src/ts/parser/parser.svelte.ts`: `blobUrlCache`, `parseInlayAssets`.
- Existing focused suite: `src/ts/process/files/tests/inlays.test.ts`.
- New focused test home: `src/ts/parser/tests/inlayBlobCache.test.ts`.

## Target Shape

- Update `writeInlayImage` to handle images that are already complete before
  the handler is attached. Prefer `decode()` when available, with a
  `complete`/dimension fallback for test/browser compatibility.
- Add `onerror` and decode rejection handling so broken images reject or return
  through the existing failure style instead of leaving the promise pending.
- Keep canvas sizing, max-pixel downscale, `toBlob`, upload, and inlay metadata
  behavior unchanged on successful images.
- Replace the unbounded `blobUrlCache` string map with a small LRU that stores
  enough data to render cached inlays without fetching bytes again, such as
  `{ url, type }`.
- On eviction or explicit replacement, call `URL.revokeObjectURL` for the old
  URL. The cap should be explicit and local to the parser module.
- In `parseInlayAssets`, check the blob cache before calling
  `getInlayAssetBlob`. Fetch asset bytes only on a cache miss.
- Preserve hide-all-images behavior, inlay vs inlayed wrapping, and replacement
  output for image/audio/video/file asset types.
- Add tests for already-complete image writes, broken-image settle behavior,
  blob cache hit without `getInlayAssetBlob`, LRU eviction with revoke, and
  unchanged rendered output for cached and uncached inlays.
- Register L49, L50, and K3 as `DONE` in the v2 gate with focused tests, and
  flip all three rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Successful inlay image uploads produce the same asset records and metadata.
- Cached object URLs must not be revoked while still retained in the cache.
- K3 is an ordering fix only; do not add a broad server asset-byte cache unless
  the leftover gate is reopened separately.
- Parser output for inlay markers remains byte-for-byte equivalent on success.

## Done Criteria

- `writeInlayImage` cannot hang forever on broken or already-loaded images.
- `blobUrlCache` is bounded and revokes evicted URLs.
- Re-rendering an already cached inlay does not fetch asset bytes again.
- L49, L50, and K3 v2 gate entries point at real focused tests and the
  risk-map rows are `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/process/files/tests/inlays.test.ts src/ts/parser/tests/inlayBlobCache.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
