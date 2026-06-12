# Slice: Legacy Storage Atomic Write

Phase: [8](../../phase-8-server-bounds.md). Finding: L26. Runtime change.
Status: done on 2026-06-06 KST.

## Scope

Make legacy storage writes crash-resistant by writing to a temp file, fsyncing,
and renaming in the same directory.

This slice covers client-managed cache files exposed through the legacy storage
route. It does not own core SQLite state, backups, `.risu` imports, or browser
local-storage migration behavior.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L26.
- `server/fastify/src/routes/legacyStorage.ts`: write route, path validation,
  and current direct write.
- Existing focused suite: `server/fastify/__tests__/legacyStorage.test.ts`.
- Adjacent suites if path/security behavior is touched:
  `server/fastify/__tests__/routeProtection.test.ts` and
  `server/fastify/__tests__/backups.test.ts`.

## Target Shape

- Write incoming bytes to a unique temp file in the same directory as the final
  target.
- Fsync the temp file before rename.
- Rename the temp file over the final path atomically.
- Fsync the containing directory after rename when the platform/runtime exposes
  the operation.
- Clean up temp files on validation failure, write failure, fsync failure, or
  rename failure.
- Preserve route auth, path traversal protections, response shape, and size
  limits.
- Add tests that stub a mid-write or rename failure and prove the old final file
  is not torn and temp files are removed.
- Register L26 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Successful writes produce exactly the requested bytes.
- Failed writes do not leave partial final-file contents.
- Path validation and auth decisions remain unchanged.
- Temp filenames must not be user-controllable in a way that escapes the
  validated directory.

## Done Criteria

- Legacy storage writes use temp-file, fsync, and same-directory rename.
- Failure-path tests prove no torn final file and no leaked temp file.
- The L26 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Proof

- Runtime:
  `server/fastify/src/routes/legacyStorage.ts` writes to a unique hidden temp
  file in `data/save`, fsyncs the temp file, renames it over the final hex key,
  and fsyncs the containing directory when supported.
- Regression proof:
  `server/fastify/__tests__/legacyStorage.test.ts` /
  `L26: preserves the old legacy storage file and removes temp bytes after a mid-write failure`
  and
  `L26: preserves the old legacy storage file and removes temp bytes after a rename failure`.
- Gate proof:
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L26 `DONE` with
  the focused proof paths;
  `.archived-docs/audit-stability-and-performance-v2/active-risk-analysis.md`
  marks L26 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/legacyStorage.test.ts \
  server/fastify/__tests__/routeProtection.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
