# Ordinary Risu Export Materialization

Status: implemented measurement; no streaming writer yet.

## Source Anchors

- `server/fastify/src/routes/save.ts`
- `server/fastify/src/risuSave/exportSnapshot.ts`
- `server/fastify/src/risuSave/blockCodec.ts`
- `server/fastify/src/risuSave/bundleExport.ts`
- `server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`

## Why This Exists

Bundle export now streams asset files and avoids redundant repository
hydration, but both ordinary export and bundle export still materialize the
`.risu` payload before sending it. The ordinary export route calls
`encodeRepositoryRisuSaveExport()`, then replies with `Buffer.from(bytes)`.
The block envelope encoder builds a full block list and concatenates all
encoded blocks into one `Uint8Array`.

This is compatible but can become expensive for large message-heavy exports.

## Candidate Scope

Measurement-only first pass:

- Capture payload size and peak materialization risk for ordinary block and
  legacy envelope exports.
- Separate hydrated snapshot cost from encoder/output-buffer cost.
- Decide whether a streaming block-envelope writer is worth the compatibility
  surface.
- Keep bundle export's streamed asset entries and shared persisted snapshot.

## Implemented Scope

The measurement is opt-in and changes no exported bytes:

- The ordinary export route now builds the export snapshot and encodes it as two
  explicit steps (`buildRepositoryRisuSaveExportSnapshot` then
  `encodeRisuSaveExportSnapshot`), which is byte-identical to the prior combined
  `encodeRepositoryRisuSaveExport` call. The opt-in `risusave_export` metric
  records `envelope`, `compression`, `snapshotLoadMs`, `encodeMs`, and
  `outputBytes`, separating hydrated-snapshot cost from encode/output-buffer
  cost.
- The bundle export route emits the same metric with `bundle: true` for the
  embedded `.risu` materialization; its streamed asset entries and shared
  persisted snapshot are unchanged.
- The dead `encodeRepositoryRisuSaveExport` route helper (and its now-unused
  imports) were removed; both routes share `encodeRisuSaveExportSnapshot`.

### Findings

- On a small fixture, snapshot hydration and encode are both sub-millisecond for
  uncompressed exports (e.g. block uncompressed: `snapshotLoadMs≈0.7`,
  `encodeMs≈0.4`, `outputBytes≈15k`; legacy-raw: `encodeMs≈1.1`).
- Compression is the dominant encode cost when enabled (block + `compression`:
  `encodeMs≈3.8` for `outputBytes≈6.7k` vs `encodeMs≈0.4` uncompressed),
  confirming gzip — not snapshot hydration or final concatenation — is the cost
  that a streaming writer would have to interleave.
- A streaming block-envelope writer is only worth its compatibility surface for
  large message-heavy exports where the materialized `Uint8Array` peak is the
  real pressure. The metric now gives the snapshot/encode/output split needed to
  prove that on a real corpus before changing the envelope path; no runtime
  narrowing is justified from the focused fixtures alone.

## Protocol Behavior

- Exported `.risu` bytes must remain import-compatible.
- `stateExported` event behavior stays unchanged.
- Legacy envelope exports must keep their existing route-ready behavior unless
  a later slice explicitly scopes legacy streaming or leaves legacy materialized.
- Bundle export must continue to include `database.risu`, streamed asset
  entries, and `manifest.json` with the current semantics.

## Rollback And Resync Behavior

Exports are read-only apart from the existing `stateExported` event emission.
A measurement pass must not change import/export payloads, active-writer
behavior, or revision state.

## Done When

- Focused measurements identify whether ordinary `.risu` materialization is
  dominated by snapshot hydration, block JSON encoding, compression, or final
  concatenation.
- A later implementation candidate, if any, names one envelope path and its
  round-trip compatibility tests.
- Bundle and ordinary export route tests preserve the current exported shapes.

## Proof Commands

- `pnpm api:test -- server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`
- `RISU_PROTOCOL_METRICS=1 RISU_EXPORT_MATERIALIZE_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveExportRoute.test.ts --reporter verbose`
