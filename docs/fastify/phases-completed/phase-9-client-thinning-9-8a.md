# Phase 9-8a - Multipart `.risu` Import Route

Date: 2026-05-26

## Summary

- Registered `@fastify/multipart` in `server/fastify/src/app.ts` with the
  configured body limit and a one-file upload limit.
- Updated `POST /api/v1/import/risusave` so the existing JSON `{ database }`
  fixture path remains available, while multipart uploads now accept actual
  `.risu` bytes.
- Multipart uploads decode through
  `decodeRisuSaveImportSnapshot()` in
  `server/fastify/src/risuSave/importSnapshot.ts`, apply the normalized
  database through repository import helpers, bump revision, and run the same
  legacy Hypa V3 memory replacement path as JSON imports.
- Multipart responses return `revision`, decoded `envelope`, an
  `importReport` with unsupported remote/cache-only block references, and the
  zeroed `assetReport` placeholder reserved for 9-8c asset walking.
- Added focused route coverage in
  `server/fastify/__tests__/risuSaveImportRoute.test.ts` for JSON fallback,
  auth, legacy `.risu` upload import, RISUSAVE block upload import,
  unsupported-reference reporting, missing-file rejection, malformed-upload
  rejection, and no persistence mutation after malformed upload failures.

## Boundaries

- No repository `.risu` export route was wired; that remains 9-8b.
- No asset reference walking, asset-byte reads, ZIP bundle generation, bundle
  export route, asset recovery, or asset report population was added.
- No browser cache, localForage, Tauri remote-file, OPFS, AutoStorage, Svelte
  database, or compression-stream path was introduced.
- No compatibility migrations were added for intermediate Fastify shapes; the
  import route targets current Phase 9 import snapshots.

## Verification

- `pnpm api:test -- server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts`
  - passed; command selected the full Fastify API suite: 65 files and 1147
    tests.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed; 1 file and 20 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-8b, repository `.risu` export route.
- Use the 9-7e export adapter in
  `server/fastify/src/risuSave/exportSnapshot.ts` and keep asset ids as JSON
  references only.
- Keep asset reference walking in 9-8c and ZIP bundle export in 9-8d.
