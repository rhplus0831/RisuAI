# Phase 9-5c - Event Subscription And Debounced Re-Bootstrap

Date: 2026-05-26

Status: complete.

## Summary

9-5c connected Fastify-served browser startup to the command-event SSE
stream. The browser subscribes to authenticated `GET /api/v1/events`
after the initial bootstrap projection load, treats command events as
projection invalidations, and debounces a `/api/v1/bootstrap` re-fetch
that replaces the browser database projection.

## Landed

- Added `src/ts/server/events.ts` for authenticated browser reads of the
  command-event SSE stream.
- Reused the shared SSE frame iterator, ignores comments / heartbeats /
  non-command frames, validates command-event payloads, and exposes an
  abortable unsubscribe handle.
- Wired Fastify-mode `loadWebInitialDatabase()` to subscribe after the
  initial bootstrap projection is applied.
- Added debounced command-event invalidation. Bursts collapse into one
  bootstrap refresh; refreshes replace `DBState.db` through the existing
  normalization path and rely on `fetchServerBootstrapProjection()` to
  cache the refreshed command revision.
- Preserved Tauri/local web startup behavior outside Fastify mode.
- Added focused event helper and startup tests for auth headers, command
  event filtering, unsubscribe aborts, debounced re-bootstrap, and
  non-Fastify no-subscribe behavior.

## Guardrails

- No surgical per-event patching was added. Every command event still
  invalidates through a debounced bootstrap projection refresh.
- No residual direct-write sweep, read-only `DBState.db` guard,
  storage/save-loop gating, provider-key masking, server `.risu` codec,
  import/export route, asset byte upload/storage change, or plugin
  execution change was included.
- Native `EventSource` was not used because `/api/v1/events` requires the
  existing `risu-auth` header.

## Verification

- `pnpm exec vitest run src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts`
  - 11 tests passed.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 708 tests passed, 4 skipped.
- `pnpm api:test` - 1119 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-5d, the residual command replacement sweep.
- 9-5d should audit remaining server-backed web direct writes for the
  resource families already owned by 9-2 through 9-4, replace them with
  existing command helpers or explicit unsupported behavior, and keep
  Tauri/local-only paths untouched.
