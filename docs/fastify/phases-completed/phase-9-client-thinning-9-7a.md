# Phase 9-7a - `.risu` Fixture Corpus And Codec Harness

Date: 2026-05-26

## Summary

- Added a pure server-side `.risu` fixture harness in
  `server/fastify/src/risuSave/fixtureHarness.ts` with shared magic headers,
  envelope classification, fixture-only legacy envelope encode/decode helpers,
  and RISUSAVE block fixture inspection.
- Added a typed server fixture corpus in
  `server/fastify/__fixtures__/risuSave/fixtures.ts` covering legacy raw,
  compressed, gzip stream, RISUSAVE block, malformed, remote-reference, and
  cache-only-reference cases.
- Added focused Fastify coverage in
  `server/fastify/__tests__/risuSaveCodec.test.ts` proving the corpus loads as
  bytes, envelope kinds classify correctly, expected fixture target shapes are
  pinned, unsupported references are represented, and the harness does not
  import browser storage, legacy local mode, or Svelte database modules.

## Boundaries

- No import/export routes were wired.
- No repository reads or writes were added.
- No asset bundle walking, multipart upload handling, or normalized import
  application landed.
- The legacy envelope helpers are fixture harness support only; 9-7b should
  turn the server-safe legacy raw/compressed/stream behavior into the real
  codec API.
- The RISUSAVE block inspector is a fixture harness, not the 9-7c production
  block decoder. Remote and cache-only references are represented so 9-7c can
  reject them without touching browser localForage or legacy local mode paths.

## Verification

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed; 7 tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-7b, the server-safe legacy envelope codec port.
- Keep RISUSAVE block production decoding in 9-7c and repository-backed export
  adapter work in 9-7e.
- Keep multipart import/export routes and asset walking deferred to 9-8.
