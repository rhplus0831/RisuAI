# Phase 9-7e - Repository-Backed Export Adapter

Date: 2026-05-26

## Summary

- Added `server/fastify/src/risuSave/exportSnapshot.ts` as the pure
  server-side repository export adapter. It reads persisted `db.json` through
  repository helpers and returns route-ready `.risu` export bytes without
  wiring HTTP routes or command/import side effects.
- Repository export snapshots are normalized against the current Phase 9
  import snapshot shape before encoding, so malformed persisted rows fail with
  the same command-owned validation used by import decode.
- Added legacy envelope export and RISUSAVE block export helpers. Block export
  writes root, preset, module, loadout, plugin, plugin-storage, per-character,
  and config blocks, with root `__directory` metadata rebuilt from emitted
  blocks.
- Server asset ids remain plain JSON references inside the exported database
  and blocks. No asset-byte reads, reference walking, ZIP generation, browser
  cache lookup, localForage, Tauri remote-file access, OPFS, AutoStorage, or
  Svelte database imports were added.
- Fixed a legacy envelope encoder parity bug exposed by repository export:
  64-byte server asset ids caused the `msgpackr` encoder path to throw in the
  current runtime. The server legacy encoder now writes standard MessagePack
  for JSON-shaped save data while keeping existing `msgpackr` decode support.
- Expanded focused Fastify coverage in
  `server/fastify/__tests__/risuSaveCodec.test.ts` for repository legacy/block
  export round trips, directory shape, compression, server asset-id
  preservation, missing database rejection, block input validation, and
  browser-storage/Tauri/Svelte/compression-stream detachment.

## Boundaries

- No import/export routes were wired.
- No multipart upload handling, repository import application, command
  dispatch, revision bumping, event emission, asset reference walking,
  asset-byte inclusion, ZIP bundle generation, provider flattening, or plugin
  server execution was added.
- No compatibility migrations were added for intermediate Fastify shapes; the
  adapter targets current Phase 9 persisted database shapes.
- Route wiring for `/api/v1/import/risusave` and `/api/v1/export/risusave`
  remains in 9-8a and 9-8b. Asset reference walking and bundle export remain
  in 9-8c and 9-8d.

## Verification

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed; 1 file and 20 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-8a, multipart `.risu` import route.
- Decode uploaded `.risu` files through the 9-7 import snapshot API, apply
  normalized repository imports, and return revision plus real asset/missing
  reports.
- Keep repository `.risu` export route wiring in 9-8b and asset walking /
  bundle export in 9-8c and 9-8d.
