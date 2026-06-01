# Asset Byte Fanout Measurement

Status: candidate; analysis only, not implemented.

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
