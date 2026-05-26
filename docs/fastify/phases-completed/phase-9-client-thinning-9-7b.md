# Phase 9-7b - Legacy Envelope Codec Port

Date: 2026-05-26

## Summary

- Added `server/fastify/src/risuSave/legacyEnvelopeCodec.ts` as the production
  server-safe legacy `.risu` envelope codec for raw msgpack,
  fflate-compressed msgpack, and gzip stream-compressed msgpack saves.
- Moved shared legacy envelope classification, magic headers, byte
  concatenation, and msgpack encode/decode behavior behind that production
  module.
- Updated `server/fastify/src/risuSave/fixtureHarness.ts` so legacy fixture
  envelope helpers delegate to the production codec while RISUSAVE block
  inspection remains fixture harness support for 9-7c.
- Expanded `server/fastify/__tests__/risuSaveCodec.test.ts` to cover legacy
  fixture parity, production encode/decode round-trips, non-legacy rejection,
  and browser-storage/Tauri/Svelte/compression-stream detachment.

## Boundaries

- No RISUSAVE block production decode landed; 9-7c owns the block codec.
- No import/export routes were wired.
- No repository reads or writes were added.
- No decode normalization, validation, current-schema import snapshot
  conversion, asset walking, multipart upload handling, or bundle export work
  landed.
- The codec rejects non-legacy envelopes instead of trying to decode RISUSAVE
  blocks, unknown bytes, browser cache references, or Tauri remote paths.

## Verification

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed; 1 file and 9 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-7c, the server-safe RISUSAVE block codec port.
- Keep decode normalization and validation in 9-7d.
- Keep repository-backed export in 9-7e and multipart import/export routes plus
  asset walking in 9-8.
