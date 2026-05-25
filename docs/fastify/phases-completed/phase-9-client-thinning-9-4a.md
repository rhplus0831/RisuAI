# Phase 9-4a - Lorebook Collection Commands

Date: 2026-05-25

Status: complete.

## Landed Scope

- Added Fastify lorebook commands for global lorebook create/update/delete,
  global lorebook reorder, global entry replacement, character lorebook
  replacement, chat lorebook replacement, and module lorebook replacement.
- Added stable ids for global lorebook rows and lorebook entry rows during
  current-shape normalization. Missing ids are generated directly; no
  compatibility migration was added.
- Added typed browser helpers for the new lorebook command endpoints.
- Added `src/ts/server/lorebookBridge.svelte.ts` to route bound lorebook UI
  surfaces through debounced whole-collection replacement commands with
  rollback.
- Routed global lorebook list create/delete, character/chat/global lorebook
  add/import helpers, and module lorebook UI edits through the new bridge in
  Fastify mode.
- Routed MCP character and module lorebook set/delete writes through the
  new replacement commands in Fastify mode.

## Guardrails

- Script and trigger definition commands remain deferred to 9-4b.
- Module lifecycle and enablement remain deferred to 9-4c.
- Asset reference commands remain deferred to 9-4d; MCP asset writes still
  stay unsupported in server-backed web mode.
- Plugin records, plugin storage, and plugin whole-database bridge work
  remain deferred to 9-4e/9-4f.
- Browser projection, storage gating, provider-key masking, and server
  `.risu` import/export remain deferred to later Phase 9 slices.
- The lorebook bridge uses Phase 9's current projection target:
  debounced command dispatch and rollback, not surgical event projection.

## Tests

- Added Fastify command tests for global lorebook lifecycle/reorder,
  global/character/chat/module entry replacement, malformed payloads,
  missing parents, stale revisions, emitted events, and bootstrap
  visibility.
- Added browser helper tests for all lorebook command URLs, methods, and
  payloads.
- Updated compatibility adapter coverage so MCP character lorebook writes
  dispatch Fastify commands instead of returning the 9-3f unsupported
  message.
- `pnpm check` is clean.
- `pnpm test` passes with 687 tests and 4 skipped.
- `pnpm api:test` passes with 1101 tests.
- `pnpm build` passes with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-4b script and trigger definition commands.
- Replace the remaining 9-3f MCP unsupported paths for regex/Lua script
  writes in 9-4b.
- Keep module record/enablement, asset references, plugin records, plugin
  storage, projection, storage gating, provider-key masking, and `.risu`
  import/export in their assigned later slices.
