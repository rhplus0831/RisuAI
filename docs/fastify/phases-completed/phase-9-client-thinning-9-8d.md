# Phase 9-8d - Bundle Export Route

Date: 2026-05-26

## Summary

- Added `server/fastify/src/risuSave/bundleExport.ts`, a pure server bundle
  builder that packages repository `.risu` bytes with walked asset files.
- Added auth-gated `GET /api/v1/export/bundle` in
  `server/fastify/src/routes/save.ts`.
- The route reuses the 9-8b `.risu` export query contract: RISUSAVE block
  export is the default, legacy envelopes are supported, and `compression`
  remains valid only for block exports.
- Bundle ZIP contents are `database.risu`, `manifest.json`, and only walked
  referenced asset files that exist in repository metadata and on disk.
- The manifest reports compact asset counts, included assets, missing
  references, metadata-present files missing from disk, and orphaned stored
  assets. Orphaned stored assets are not bundled.
- Added focused route coverage in
  `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts` for ZIP
  contents, manifest reporting, query passthrough, auth rejection, invalid
  query rejection, and missing database validation.

## Boundaries

- No browser cache lookup, localForage, Tauri remote-file access, OPFS,
  AutoStorage, or Svelte database state path was added.
- The bundle uses the current Phase 9 server asset-id fields from the 9-8c
  walker; it does not recursively scan arbitrary plugin/custom JSON strings.
- Missing repository metadata and missing asset files are reported, not
  recovered from local browser storage.
- No compatibility migrations were added for intermediate Fastify shapes.

## Verification

- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts`
  - passed; command selected the full Fastify API suite: 68 files and 1162
    tests.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed; 2 files and 23 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-9a, server-backed browser smoke harness.
- Keep 9-9a focused on Fastify-served web startup, bootstrap/events, and one
  representative command mutation.
- Leave generation/memory fixture closeout, storage-write audit, manual
  Fastify/Tauri verification, and Phase 9 docs closeout to 9-9b through 9-9e.
