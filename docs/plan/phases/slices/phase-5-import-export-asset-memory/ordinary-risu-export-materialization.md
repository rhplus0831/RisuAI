# Ordinary Risu Export Materialization

Status: candidate; analysis only, not implemented.

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
