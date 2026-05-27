# Phase 9-5a - Events Endpoint

Date: 2026-05-26

Status: complete.

## Summary

9-5a added the persistent command-event stream needed for browser
projection invalidation. Existing command mutations continue to emit their
locked command events; the new route fans those committed events out over
SSE without introducing surgical client-side patch semantics.

## Landed

- Extended the command event sink with `subscribe(listener)` support while
  preserving `emit`, `list`, and `clear` for existing command tests.
- Added auth-gated `GET /api/v1/events`.
- The stream sends an initial connected comment, heartbeat comments, and
  `event: command` frames whose JSON payloads keep the locked
  `{ type, revision, resource, id?, parentId? }` command-event shape.
- Registered the events route against the same command event sink used by
  `/api/v1/commands/*`.
- Added focused route tests for auth rejection, stream setup, command
  event delivery from a real command mutation, and listener cleanup on
  disconnect.

## Guardrails

- No browser bootstrap projection loader was added; 9-5b owns startup
  loading from `/api/v1/bootstrap`.
- No browser event subscription or debounced re-bootstrap wiring was
  added; 9-5c owns that.
- No direct-write sweep, read-only `DBState.db` guard, storage gating,
  provider-key masking, server `.risu` codec, import/export route, asset
  byte flow, or plugin execution changes were included.

## Verification

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts`
  - 4 tests passed.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 697 tests passed, 4 skipped.
- `pnpm api:test` - 1119 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-5b bootstrap projection loading.
- 9-5b should keep legacy local mode startup paths unchanged while Fastify web
  startup reads `/api/v1/bootstrap`, applies the returned database
  projection, and caches the returned revision for command helpers.
