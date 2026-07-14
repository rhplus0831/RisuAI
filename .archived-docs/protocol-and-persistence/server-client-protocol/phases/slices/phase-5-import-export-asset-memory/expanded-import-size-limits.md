# Expanded Import Size Limits

Status: implemented.

Completed: 2026-06-01.

## Source Anchors

- `server/fastify/src/app.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/risuSave/`
- `server/fastify/src/routes/realmImport.ts`

## Scope

Add post-inflate or expanded-size limits for import paths that currently buffer
compressed uploads and can decompress into much larger payloads.

Implemented scope:

- `server/fastify/src/app.ts` passes the configured Fastify `bodyLimit` as the
  expanded import ceiling for `.risu` and Realm charx import paths.
- `server/fastify/src/routes/save.ts` preserves the existing multipart upload
  limit, then passes the expanded-size ceiling into the `.risu` decoder before
  calling `applyImport`.
- `server/fastify/src/risuSave/importSnapshot.ts`,
  `server/fastify/src/risuSave/legacyEnvelopeCodec.ts`, and
  `server/fastify/src/risuSave/blockCodec.ts` enforce the ceiling after legacy
  compressed/stream and per-block decompression.
- `server/fastify/src/routes/realmImport.ts` enforces the same ceiling while
  reading `card.json` and staging expanded charx assets, before asset
  persistence or character creation.

## Protocol Behavior

- Preserve existing compressed upload limits.
- Reject expanded payloads with clear errors before committing partial durable
  state.
- Keep import conflict and active-writer behavior unchanged.
- JSON `.risu` imports remain bounded by Fastify's body parser limit; multipart
  `.risu` uploads are bounded first by compressed upload size and then by
  expanded decoded payload size.
- Realm charx downloads keep their upstream download limit, then reject
  oversized expanded package contents before staged assets are persisted into
  repository assets.

## Done When

- `.risu` and relevant Realm import paths enforce expanded-size limits.
- Tests cover oversized expanded payload rejection for legacy compressed
  `.risu`, RISUSAVE block `.risu`, and Realm charx packages.

## Validation

- `pnpm api:test -- server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveCodec.test.ts server/fastify/__tests__/realmImport.test.ts`
