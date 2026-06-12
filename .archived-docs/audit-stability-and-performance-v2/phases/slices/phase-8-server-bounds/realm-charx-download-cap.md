# Slice: Realm CharX Download Cap

Phase: [8](../../phase-8-server-bounds.md). Finding: L29. Runtime change.

## Scope

Cap Realm `.charx` staging downloads near the configured expanded import limit
before the server can write a very large remote file to disk.

This slice does not own client-side CharX zip entry caps, JSON-card asset
batching, bundle import inflation caps, or general hub proxy behavior.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L29.
- `server/fastify/src/routes/realmImport.ts`: remote charx download, staging
  temp file lifecycle, expanded import cap check, and cleanup on failure.
- `server/fastify/src/app.ts`: `maxExpandedImportBytes` route option wiring.
- Existing focused suite: `server/fastify/__tests__/realmImport.test.ts`.
- Adjacent cap suites:
  `server/fastify/__tests__/payloadBudgets.test.ts` and
  `server/fastify/__tests__/risuSaveBoundedInflate.test.ts`.

## Target Shape

- Check `Content-Length` before download when the upstream supplies it. Reject
  clearly if it exceeds the allowed staging/download cap.
- Count streamed response bytes while writing the staging file. Abort upstream,
  stop writing, and delete the temp file as soon as the cap is exceeded.
- Use a cap tied to `maxExpandedImportBytes` or a smaller documented charx
  staging cap; do not keep the old 2 GB path as the first effective bound.
- Preserve the existing expanded-import validation after download/decompression
  so compressed bombs remain bounded.
- Clean up partial staging files on timeout, abort, size rejection, and parse
  failure.
- Add tests for oversized `Content-Length`, unknown length that exceeds mid
  stream, and a valid within-cap charx import.
- Register L29 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Valid Realm `.charx` imports still persist the same character and assets.
- The cap is enforced before unbounded disk growth and before expanded import
  processing.
- Partial temp files are not left behind.
- Upstream failures and malformed charx errors remain visible to the caller.

## Done Criteria

- Oversized known-length downloads are rejected before body download.
- Oversized unknown-length downloads are aborted as soon as the streaming cap is
  crossed.
- Valid within-cap imports are unchanged.
- The L29 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Proof

Status: DONE (2026-06-06).

- Implementation:
  `server/fastify/src/routes/realmImport.ts` derives the Realm `.charx`
  staging-download cap from `maxExpandedImportBytes * 3` (300 MiB fallback when
  route options omit the expanded cap). The multiplier allows zip entry/header
  overhead for many small packaged assets while keeping the first effective
  bound close to the expanded import limit instead of the old 2 GiB ceiling.
- Failure behavior:
  oversized `Content-Length` is rejected before temp-file staging; unknown-size
  streams count bytes, abort the upstream fetch, stop writing, and remove the
  partial temp directory as soon as the staging cap is crossed.
- Regression tests:
  `server/fastify/__tests__/realmImport.test.ts` covers
  `L29: rejects known-length Realm charx downloads above the staging cap before reading the body`,
  `L29: aborts unknown-length Realm charx downloads as soon as the staging cap is crossed`,
  and `L29: accepts a valid Realm charx download within the staging cap`.
- Gate/risk proof:
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L29 as `DONE`
  with the focused Realm import tests, and
  `.archived-docs/audit-stability-and-performance-v2/active-risk-analysis.md`
  marks the L29 row `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/payloadBudgets.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
