# Slice: Risu Save JSON Import Single Clone

Phase: [8](../../phase-8-server-bounds.md). Finding: L28. Runtime change.

## Scope

Remove the extra full-corpus JSON clone from non-multipart
`/import/risusave` while preserving import normalization and validation.

This slice does not own multipart bundle import, backup restore, asset import
streaming, or Realm import paths.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L28.
- `server/fastify/src/routes/save.ts`: non-multipart `/import/risusave` JSON
  body handling.
- `server/fastify/src/risuSave/importSnapshot.ts`: normalize/clone boundary.
- `server/fastify/src/repository.ts`: repository import/replace path and any
  defensive clone.
- Existing focused suites:
  `server/fastify/__tests__/risuSaveImportRoute.test.ts`,
  `server/fastify/__tests__/risuSaveBundleImportRoute.test.ts`,
  `server/fastify/__tests__/risuSaveCodec.test.ts`, and
  `server/fastify/__tests__/backups.test.ts`.

## Target Shape

- Identify the two current full-corpus clone boundaries in the JSON import
  route and normalization/repository path.
- Keep one defensive normalization/copy boundary where it is actually needed
  for type safety or mutation isolation, and remove the redundant clone.
- Avoid mutating the Fastify request body in place unless the mutation boundary
  is documented and covered by tests.
- Preserve validation errors, imported database shape, asset handling, revision
  bumps, and response body.
- Add a focused counter or spy around the clone helper if one exists; otherwise
  add a representative large-corpus route test that proves the single-clone
  path is exercised and output is unchanged.
- Register L28 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Valid non-multipart JSON imports produce the same persisted state.
- Malformed imports fail with the same status and error family.
- Multipart bundle import remains unchanged.
- Removing the clone must not let later normalization mutate caller-owned state
  in a way tests can observe.

## Done Criteria

- Non-multipart `.risu` JSON import performs one full-corpus clone or fewer.
- Import route behavior and persisted state remain unchanged on representative
  fixtures.
- The L28 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Proof

- `server/fastify/__tests__/risuSaveImportRoute.test.ts`:
  `L28: imports JSON bodies through the normalized throwaway object without repository structuredClone`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/risuSaveImportRoute.test.ts \
  server/fastify/__tests__/risuSaveBundleImportRoute.test.ts \
  server/fastify/__tests__/risuSaveCodec.test.ts \
  server/fastify/__tests__/backups.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
