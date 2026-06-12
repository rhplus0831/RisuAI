# Active Risk Analysis

Date: 2026-06-02

This file records the current code-grounded analysis for the active
server/client protocol performance risks. It is a routing document, not a
verification log. Keep [`latest-verification.md`](latest-verification.md) as the
single maintained record for actual proof-command runs.

## Summary

All original numbered-phase implementation slices are closed, and all four
remaining performance/materialization risks now have an implemented opt-in
measurement. Each measurement is the gate for a later runtime narrowing slice on
a real corpus; none was justified by the focused fixtures alone.

| Risk                                       | Current finding                                                                                                                                                                                                                                                                                                                                                           | Measurement slice                                                                                                                                       | Status                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Prompt construction whole-corpus work      | Server prompt assembly still loads a hydrated persisted database once per assembly through `loadPersistedWithMessages()`. The Phase 2 measurement splits database load, scope, submit transforms, static/plain slots, lorebook/preflight, history/bias, memory bridge, final render, and budget stages. Focused fixtures did not justify runtime narrowing by themselves. | [`generation-prompt-construction-pass-measurement.md`](phases/slices/phase-2-command-write-cost/generation-prompt-construction-pass-measurement.md)     | Measured; runtime narrowing pending |
| Sprawling-resource full bootstrap fallback | `settings`, `state`, `pluginStorage`, and unknown resources intentionally return projection `mode: "full"`. The measurement now records `mode`/`fallbackClass` (sprawling vs unknown) on `projection_response` and attributes each client full-bootstrap fallback per resource. The full-mode response is tiny (47-56 bytes); the cost is the downstream full bootstrap.  | [`sprawling-resource-full-bootstrap-measurement.md`](phases/slices/phase-3-read-projection-efficiency/sprawling-resource-full-bootstrap-measurement.md) | Measured; runtime narrowing pending |
| Asset byte fanout                          | Asset metadata lookup is indexed and asset bytes stream per request. The measurement adds an `asset_byte_read` route metric and a client `assetByteReads` aggregate (requests/uniqueIds/repeatedReads/maxReadsForSingleId). The route already sets `immutable` cache headers, so the browser cache collapses most repeated `<img src>` fetches.                           | [`asset-byte-fanout-measurement.md`](phases/slices/phase-3-read-projection-efficiency/asset-byte-fanout-measurement.md)                                 | Measured; runtime narrowing pending |
| Ordinary `.risu` export materialization    | `/api/v1/export/risusave` still builds a complete `Uint8Array`. The measurement splits the route into snapshot-build then encode (byte-identical) and records `risusave_export` snapshot/encode/output. Snapshot and encode are sub-ms for uncompressed exports; gzip compression dominates encode when enabled (~3.8ms vs ~0.4ms).                                       | [`ordinary-risu-export-materialization.md`](phases/slices/phase-5-import-export-asset-memory/ordinary-risu-export-materialization.md)                   | Measured; streaming writer pending  |

## Source Anchors

- Prompt assembly:
  `server/fastify/src/routes/generationChat.ts`,
  `server/fastify/src/prompt/assemble.ts`,
  `server/fastify/src/repository.ts`
- Projection fallback:
  `server/fastify/src/routes/projection.ts`,
  `src/ts/bootstrap.ts`,
  `src/ts/server/projection.ts`,
  `src/ts/server/projectionResync.ts`
- Asset bytes:
  `server/fastify/src/routes/assets.ts`,
  `server/fastify/src/repository.ts`,
  `server/fastify/src/routes/generationChat.ts`,
  `server/fastify/src/prompt/assetLookup.ts`
- Export materialization:
  `server/fastify/src/routes/save.ts`,
  `server/fastify/src/risuSave/exportSnapshot.ts`,
  `server/fastify/src/risuSave/blockCodec.ts`,
  `server/fastify/src/risuSave/bundleExport.ts`

## Decision

All four measurements are implemented and opt-in. The remaining work is
evidence-gated runtime narrowing, which must be driven by these measurements on
representative lorebook-heavy, asset-heavy, memory-enabled, or real user corpora
— not by the focused fixtures, which did not justify any narrowing on their own.

- Prompt construction: the 2026-06-02 focused fixture review showed ordinary
  plain/preview/durable sends around 2ms, with database load around
  0.34-0.38ms; Lua/input-transform fixtures were dominated by
  `submit_transforms` and `final_render`.
- Sprawling-resource fallback: the projection full-mode response is cheap; the
  per-resource client diagnostic is the signal that gates a targeted-resource
  field contract for one named resource family.
- Asset byte fanout: the per-id baseline exists on both the route and the
  client; a bulk-byte route is only justified if a real asset-heavy workflow
  shows high `repeatedReads` the browser cache does not already absorb.
- Ordinary export: the snapshot/encode/output split is in place; a streaming
  block-envelope writer is only worth its compatibility surface for large
  message-heavy exports where the materialized `Uint8Array` peak is the real
  pressure.

## Non-Goals

- Do not replace the current bootstrap/projection/revision/event model.
- Do not make `settings`, `state`, or `pluginStorage` targeted until the exact
  projected keys and event semantics are named.
- Do not introduce a bulk asset-byte route without measured client fanout and
  cache behavior.
- Do not change `.risu` envelope bytes without round-trip compatibility tests.
