# Latest Verification

Date: 2026-06-02

This file records the latest maintained verification result for the
server/client protocol stability and performance workstream. Replace this
section on the next full or focused verification run; do not append historical
runs here.

## Latest Run

- Runtime/code commit under test: the three Phase 3/Phase 5 candidate
  measurement slices — sprawling-resource full-bootstrap fallback measurement,
  asset-byte fanout measurement, and ordinary `.risu` export materialization
  measurement.
- Scope: opt-in `projection_response` mode/fallbackClass fields plus per-resource
  client full-bootstrap diagnostics; opt-in `asset_byte_read` route metric plus
  client `assetByteReads` aggregate; opt-in `risusave_export` snapshot/encode
  split for ordinary and bundle export. No route, event, revision, SSE, byte, or
  persistence behavior changed; the export route split is byte-identical.
- Result: passed.

| Command                                                                                                                                                                                           | Result                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm api:test`                                                                                                                                                                                   | Passed: configured server API suite, 83 files, 1493 tests, 1 skipped.    |
| `pnpm test`                                                                                                                                                                                       | Passed: client suite, 99 files, 947 tests, 4 skipped.                    |
| `pnpm client-thinning:audit`                                                                                                                                                                      | Passed: client-thinning audit.                                           |
| `RISU_PROTOCOL_METRICS=1 RISU_PROJECTION_FULL_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/projection.test.ts --reporter verbose`             | Passed: projection suite, 1 file, 26 tests.                              |
| `RISU_PROTOCOL_METRICS=1 RISU_ASSET_BYTE_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/assets.test.ts --reporter verbose`                      | Passed: assets suite, 1 file, focused measurement summary emitted.       |
| `RISU_PROTOCOL_METRICS=1 RISU_EXPORT_MATERIALIZE_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveExportRoute.test.ts --reporter verbose` | Passed: export route suite, 1 file, focused measurement summary emitted. |

## Notes

- Sprawling-resource fallback: the `mode: 'full'` projection response is tiny
  (47-56 bytes); the real cost is the downstream full bootstrap, now attributed
  per resource (`sprawling` vs `unknown`) on the client diagnostic.
- Asset byte fanout: every single-asset byte read lands on
  `GET /api/v1/assets/:id`, so the `asset_byte_read` metric is a per-id baseline
  at the byte boundary; the route already sets `immutable` cache headers, so the
  browser cache collapses most repeated `<img src>` fetches.
- Export materialization: snapshot hydration and encode are sub-millisecond for
  uncompressed exports; gzip compression is the dominant encode cost when enabled
  (~3.8ms vs ~0.4ms uncompressed on the focused fixture).
- No runtime narrowing is justified from the focused fixtures alone; each
  measurement is the gate for a later runtime slice on a real corpus.
