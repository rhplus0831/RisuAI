# Phase 9-7d - Decode Normalization And Validation

Date: 2026-05-26

## Summary

- Added `server/fastify/src/risuSave/importSnapshot.ts` as the pure
  server-side `.risu` import snapshot API. It consumes the production legacy
  envelope and RISUSAVE block codecs, then returns current Phase 9 database
  resource shapes without import route wiring or repository writes.
- RISUSAVE block payloads now assemble into a database snapshot from root,
  character, preset, module, loadout, plugin, plugin-storage, config, and
  root-component blocks. Root `__directory` stays codec metadata and is not
  copied into the import snapshot.
- Decoded legacy and block snapshots now run through the existing
  command-owned normalizers for character/chat/message stable ids, presets,
  prompt items, personas, translator presets, modules, loadouts, plugins,
  plugin-storage, lorebooks, and script/trigger child rows.
- Malformed decoded JSON/rows reject with `ValidationError`, while remote and
  cache-only RISUSAVE references remain explicit unsupported-reference reports
  from the block codec.
- Expanded focused Fastify coverage in
  `server/fastify/__tests__/risuSaveCodec.test.ts` for legacy normalization,
  block assembly, root-component merge behavior, unsupported-reference
  reporting, malformed import rejection, and
  browser-storage/Tauri/Svelte/compression-stream detachment.

## Boundaries

- No import/export routes were wired.
- No repository reads or writes were added.
- No asset-byte walking, bundle generation, multipart upload handling, command
  dispatch, event emission, provider flattening, or plugin server execution was
  added.
- Unsupported remote/cache-only block references are reported only; the server
  still does not read browser `risuSaveCache`, localForage, Tauri remote files,
  OPFS, AutoStorage, Svelte database state, or repository state during decode.
- Repository-backed export snapshots remain in 9-7e. Multipart import/export
  routes plus asset walking remain in 9-8.

## Verification

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed; 1 file and 16 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-7e, repository-backed export adapter.
- Build export snapshots from persisted Fastify state with server asset ids
  preserved as references.
- Keep ZIP bundle generation, multipart import/export routes, asset reference
  walking, and route event emission deferred to 9-8.
