# Bundle Export Streaming

Status: implemented.

## Source Anchors

- `server/fastify/src/routes/save.ts`
- `server/fastify/src/risuSave/`
- `server/fastify/src/repository.ts`

## Scope

Reduce bundle export peak memory by avoiding double hydration and all-assets
in-memory zip construction where practical.

## Protocol Behavior

- Preserve exported `.risu` and bundle compatibility.
- Prefer single hydration or shared loaded state for export and bundle assembly.
- Stream or chunk asset bytes when feasible.

## Done When

- Bundle export avoids redundant repository hydration by sharing the hydrated
  persisted state used for `.risu` encoding with asset-reference planning.
- Asset-heavy bundle export streams asset file entries into the zip instead of
  adding every asset byte buffer to an in-memory `Zippable`.
- Tests preserve existing export shape.

## Validation

- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts`
