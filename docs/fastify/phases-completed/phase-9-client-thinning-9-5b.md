# Phase 9-5b - Bootstrap Projection Loader

Date: 2026-05-26

Status: complete.

## Summary

9-5b moved Fastify-served browser startup onto the server bootstrap
projection. The browser now reads `/api/v1/bootstrap` through an
authenticated helper, applies the returned database as the current
projection, and seeds the command revision cache from the returned
revision.

## Landed

- Added `src/ts/server/bootstrap.ts` for authenticated bootstrap
  projection reads.
- The helper validates the response envelope, preserves optional
  `schemaVersion` and `assetBaseUrl`, and caches the revision with
  `setCachedServerCommandRevision`.
- Added `loadWebInitialDatabase()` in `src/ts/bootstrap.ts` and routed
  Fastify web startup through the server projection path.
- Preserved the existing legacy local mode localForage / `.risu` decode
  startup behavior outside Fastify mode.
- Added focused helper and startup tests proving Fastify mode reads the
  server projection, applies the returned database, caches the revision,
  and does not enter localForage during initial load.

## Guardrails

- No browser event subscription or debounced re-bootstrap was added; 9-5c
  owns that.
- No read-only `DBState.db` guard, residual direct-write sweep,
  storage/save-loop gating, provider-key masking, server `.risu` codec,
  import/export route, or plugin execution changes were included.
- Fastify startup still runs the existing post-load normalization and app
  initialization flow. Storage/provider-key gating remains a later slice.

## Verification

- `pnpm exec vitest run src/ts/server/bootstrap.test.ts src/ts/bootstrap.test.ts`
  - 5 tests passed.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 702 tests passed, 4 skipped.
- `pnpm api:test` - 1119 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-5c event subscription and debounced re-bootstrap.
- 9-5c should subscribe to `/api/v1/events` only in Fastify mode, debounce
  command-event invalidations, re-fetch `/api/v1/bootstrap`, replace the
  browser projection, and cache the refreshed revision.
