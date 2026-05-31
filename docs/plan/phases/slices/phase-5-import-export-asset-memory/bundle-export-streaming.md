# Bundle Export Streaming

Status: planned.

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

- Bundle export avoids redundant repository hydration, or the unavoidable
  boundary is documented with size limits.
- Asset-heavy export peak memory is reduced or capped.
- Tests preserve existing export shape.

## Validation

- `pnpm api:test -- server/fastify/__tests__/save.test.ts`
