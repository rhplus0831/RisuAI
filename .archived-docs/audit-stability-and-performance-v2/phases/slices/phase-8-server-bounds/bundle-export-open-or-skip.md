# Slice: Bundle Export Open Or Skip

Phase: [8](../../phase-8-server-bounds.md). Finding: L25. Runtime change.

## Scope

Make `.risu` bundle export handle assets that disappear between the initial
existence check and stream-time file read by degrading them into
`missingFiles`.

This slice does not own backup restore directory renames, import codecs, asset
GC, or streaming `.risu` export gates from the earlier workstream.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L25.
- `server/fastify/src/risuSave/bundleExport.ts`: upfront existence checks,
  asset manifest creation, and later file stream/open path.
- `server/fastify/src/routes/save.ts`: bundle export route wiring.
- Existing focused suites:
  `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`,
  `server/fastify/__tests__/risuSaveExportRoute.test.ts`, and
  `server/fastify/__tests__/risuSaveCodec.test.ts`.

## Target Shape

- Move the authoritative asset file open to the moment the asset entry is
  streamed.
- If the file is missing or cannot be opened because it disappeared, skip that
  asset entry and add it to the same `missingFiles` report surface used for
  missing assets discovered earlier.
- Avoid destroying the whole download for a TOCTOU miss caused by a concurrent
  backup restore or directory rename.
- Keep genuinely unexpected read errors visible unless they are the documented
  open-or-skip missing-file class.
- Preserve valid bundle bytes for stable assets.
- Add a test that removes or renames an asset after manifest planning but
  before stream read, then asserts the export succeeds with `missingFiles`.
- Register L25 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Existing valid bundle exports remain byte-compatible.
- Missing assets are reported once through the existing public result surface.
- The stream must not leak file handles after skipped or failed entries.
- The change must not hide codec or manifest corruption.

## Done Criteria

- A stream-time missing asset degrades to `missingFiles` instead of destroying
  the bundle download.
- Valid asset entries still stream unchanged.
- The L25 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Proof

- Regression proof:
  `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts` /
  `L25: reports an asset that disappears after bundle planning without aborting export`.
- Valid-asset proof remains in
  `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts` /
  `exports a zip with the .risu file, manifest, and only walked present assets`.
- Gate proof:
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L25 `DONE` with
  the focused proof paths;
  `.archived-docs/audit-stability-and-performance-v2/active-risk-analysis.md`
  marks L25 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/risuSaveBundleExportRoute.test.ts \
  server/fastify/__tests__/risuSaveExportRoute.test.ts \
  server/fastify/__tests__/risuSaveCodec.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
