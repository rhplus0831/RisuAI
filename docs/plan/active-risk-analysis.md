# Active Risk Analysis

Date: 2026-06-02

This file records the current code-grounded analysis for the active
server/client protocol performance risks. It is a routing document, not a
verification log. Keep [`latest-verification.md`](latest-verification.md) as the
single maintained record for actual proof-command runs.

## Summary

All original numbered-phase implementation slices are closed. The remaining
items are performance/materialization risks that should be handled as measured
narrow slices, not broad rewrites.

| Risk                                       | Current finding                                                                                                                                                                                                                                                                                                                                                               | Candidate slice                                                                                                                                         | Suggested priority |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Prompt construction whole-corpus work      | Server prompt assembly still loads a hydrated persisted database once per assembly through `loadPersistedWithMessages()`. The Phase 2 measurement now splits database load, scope, submit transforms, static/plain slots, lorebook/preflight, history/bias, memory bridge, final render, and budget stages. Focused fixtures did not justify runtime narrowing by themselves. | [`generation-prompt-construction-pass-measurement.md`](phases/slices/phase-2-command-write-cost/generation-prompt-construction-pass-measurement.md)     | Evidence-gated     |
| Sprawling-resource full bootstrap fallback | `settings`, `state`, `pluginStorage`, and unknown resources intentionally return projection `mode: "full"`, which is correct but can be expensive when those events are foreign or replay recovery falls back.                                                                                                                                                                | [`sprawling-resource-full-bootstrap-measurement.md`](phases/slices/phase-3-read-projection-efficiency/sprawling-resource-full-bootstrap-measurement.md) | Second             |
| Asset byte fanout                          | Asset metadata lookup is indexed and asset bytes stream per request, but general byte reads remain one request per asset. The per-generation asset cache only removes repeated reads inside one prompt assembly.                                                                                                                                                              | [`asset-byte-fanout-measurement.md`](phases/slices/phase-3-read-projection-efficiency/asset-byte-fanout-measurement.md)                                 | Third              |
| Ordinary `.risu` export materialization    | `/api/v1/export/risusave` still builds a complete `Uint8Array` and replies with a `Buffer`. Bundle export streams asset files, but still materializes the embedded `.risu` bytes first.                                                                                                                                                                                       | [`ordinary-risu-export-materialization.md`](phases/slices/phase-5-import-export-asset-memory/ordinary-risu-export-materialization.md)                   | Third              |

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

The Phase 2 prompt-construction measurement is implemented. Use it on
representative lorebook-heavy, asset-heavy, memory-enabled, or real user corpora
before proposing a prompt-construction runtime narrowing. The 2026-06-02
focused fixture review showed ordinary plain/preview/durable sends around 2ms,
with database load around 0.34-0.38ms; Lua/input-transform fixtures were
dominated by `submit_transforms` and `final_render`.

Phase 3 fallback and asset-byte work should wait for diagnostics proving a
specific expensive resource family or workflow. Phase 5 ordinary export work
should wait for export-size or memory evidence and a compatibility-preserving
streaming contract.

## Non-Goals

- Do not replace the current bootstrap/projection/revision/event model.
- Do not make `settings`, `state`, or `pluginStorage` targeted until the exact
  projected keys and event semantics are named.
- Do not introduce a bulk asset-byte route without measured client fanout and
  cache behavior.
- Do not change `.risu` envelope bytes without round-trip compatibility tests.
