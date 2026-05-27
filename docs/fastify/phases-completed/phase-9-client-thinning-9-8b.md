# Phase 9-8b - Repository `.risu` Export Route

Date: 2026-05-26

## Summary

- Added auth-gated `GET /api/v1/export/risusave` in
  `server/fastify/src/routes/save.ts`.
- The route returns downloadable `database.risu` bytes with
  `application/octet-stream` and an attachment filename.
- Export uses the repository-backed adapter in
  `server/fastify/src/risuSave/exportSnapshot.ts`. RISUSAVE block export is
  the default, with explicit query support for `legacy-raw`,
  `legacy-compressed`, `legacy-stream`, and `risusave-blocks`. The
  `compression` flag is accepted only for block exports.
- Missing or malformed persisted databases now surface as `400` validation
  responses from the route.
- Added focused route coverage in
  `server/fastify/__tests__/risuSaveExportRoute.test.ts` for default block
  downloads, compressed block exports, legacy exports, auth, invalid query
  rejection, missing database rejection, malformed database rejection, and
  server asset-id reference preservation.

## Boundaries

- Server asset ids remain JSON references in exported snapshots.
- No asset reference walking, asset-byte reads, ZIP bundle generation, bundle
  export route, browser cache lookup, localForage, legacy local-mode remote-file access,
  OPFS, AutoStorage, or Svelte database imports were added.
- No compatibility migrations were added for intermediate Fastify shapes; the
  route targets current Phase 9 persisted database shapes.

## Verification

- `pnpm api:test -- server/fastify/__tests__/risuSaveExportRoute.test.ts`
  - passed; command selected the full Fastify API suite: 66 files and 1153
    tests.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed; 1 file and 20 tests.
- `pnpm api:test -- server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts`
  - passed; command selected the full Fastify API suite: 66 files and 1153
    tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-8c, asset reference walker.
- Add a pure server helper that scans persisted database state for Fastify
  server asset ids and reports referenced, missing, and orphaned assets without
  over-including stored assets.
- Keep ZIP bundle export route wiring and asset-byte inclusion in 9-8d.
