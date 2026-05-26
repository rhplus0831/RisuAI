# Phase 9-7c - RISUSAVE Block Codec Port

Date: 2026-05-26

## Summary

- Added `server/fastify/src/risuSave/blockCodec.ts` as the production
  server-safe RISUSAVE block codec for block envelope encode/decode,
  compressed payloads, block type metadata, and unsupported-reference
  reporting.
- Moved RISUSAVE block fixture encoding/inspection in
  `server/fastify/src/risuSave/fixtureHarness.ts` onto the production codec,
  leaving the harness as compatibility helper surface for the fixture corpus.
- Added explicit server decode reporting for remote and cache-only block
  references so the codec never falls through to browser `risuSaveCache`,
  localForage, Tauri remote-file paths, Svelte database state, browser globals,
  import/export routes, or repository writes.
- Expanded focused Fastify coverage in
  `server/fastify/__tests__/risuSaveCodec.test.ts` for production block fixture
  parity, compressed block round-trips, root-component block coverage,
  unsupported-reference reporting, malformed block rejection, and
  browser-storage/Tauri/Svelte/compression-stream detachment.

## Boundaries

- No import/export routes were wired.
- No repository reads or writes were added.
- No decode normalization, validation, current Phase 9 import snapshot
  conversion, asset walking, multipart upload handling, or bundle export work
  landed.
- Remote and cache-only block references are reported by the codec, not loaded
  from browser cache, Tauri files, or server persistence.
- The codec returns raw decoded block payload strings and metadata; 9-7d owns
  conversion into validated current-schema import snapshots/resource shapes.

## Verification

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed; 1 file and 11 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-7d, decode normalization and validation from the production
  legacy envelope and RISUSAVE block codec outputs.
- Keep repository-backed export in 9-7e.
- Keep multipart import/export routes, asset walking, and bundle export
  deferred to 9-8.
