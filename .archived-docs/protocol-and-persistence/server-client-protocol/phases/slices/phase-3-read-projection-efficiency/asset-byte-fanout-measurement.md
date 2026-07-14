# Asset Byte Fanout Measurement

Status: implemented measurement; no runtime narrowing yet.

## Source Anchors

- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/assetLookup.ts`
- `src/ts/server/assets.ts`

## Why This Exists

Phase 3 indexed asset metadata, and Phase 5 added a per-generation cache for
repeated prompt-assembly asset references. General asset byte reads still use
`GET /api/v1/assets/:id` one asset at a time. That keeps byte reads simple,
public, immutable, and streamable, but can create request fanout in asset-heavy
views or imports.

## Candidate Scope

Measurement-only first pass:

- Identify client workflows that fetch many asset bytes outside one generation
  request.
- Count request fanout and repeated ids for those workflows.
- Compare browser cache behavior against any proposed bulk-byte endpoint.
- Keep `GET` and `HEAD /api/v1/assets/:id` behavior unchanged.

## Implemented Scope

The measurement is opt-in and changes no route or read behavior:

- The server `GET /api/v1/assets/:id` route emits an opt-in `asset_byte_read`
  metric per request (`assetId`, `found`, and `contentType`/`size` when found).
  Every single-asset byte read lands here, including browser-native `<img src>`
  fetches, so the metric is a per-id byte-read baseline at the actual byte
  boundary. Bytes, headers, and missing-id behavior are unchanged.
- The client protocol diagnostics gained an `assetByteReads` aggregate
  (`requests`, `uniqueIds`, `repeatedReads`, `maxReadsForSingleId`), recorded
  through `recordAssetByteRead(assetId)` from `readServerAsset`. This captures
  the JS-driven byte reads (the explicit `readImage`/inlay path) and their
  in-session repeated-id fanout. The per-id counts are kept outside the
  diagnostics snapshot so the full id list is never cloned or exposed.

### Findings

- Repeated-id reads are visible on both sides: the server metric shows duplicate
  `assetId`s across requests, and the client aggregate reports `repeatedReads`
  and `maxReadsForSingleId` directly. A focused four-request fixture
  (three reads of one id, one of another) summarizes as
  `requests=4, uniqueIds=2, repeatedReads=2, maxReadsForSingleId=3`.
- The single-asset route already sets `immutable` cache headers, so the browser
  HTTP cache collapses most repeated `<img src>` fetches. No bulk-byte route is
  justified until a real asset-heavy workflow shows high `repeatedReads` that the
  browser cache does not already absorb; the per-id baseline now exists to prove
  or refute that before any route is added.

## Protocol Behavior

- Existing immutable single-asset byte routes remain the compatibility baseline.
- A later bulk route, if justified, must preserve content-addressed ids,
  content types, cache headers, missing-id behavior, auth/public-read policy,
  and route-manifest coverage.
- Asset reads do not bump revision or emit command events.

## Rollback And Resync Behavior

No rollback or resync behavior applies to read-only asset byte fetches. Upload,
bulk upload, metadata writes, revision bumps, and asset-created events stay in
the existing Phase 5 transaction protocol.

## Done When

- Diagnostics identify a concrete fanout workflow and request-count baseline.
- A later implementation candidate, if any, states whether to add a bulk byte
  route, rely on browser cache, or leave the current streamed route alone.
- Existing asset route tests still cover single-byte, head, upload, bulk upload,
  exists, and metadata-index behavior.

## Proof Commands

- `pnpm api:test -- server/fastify/__tests__/assets.test.ts server/fastify/__tests__/assetMetadataIndex.test.ts`
- `pnpm test -- src/ts/server`
- `RISU_PROTOCOL_METRICS=1 RISU_ASSET_BYTE_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/assets.test.ts --reporter verbose`
