# Phase 9-4c - Module Records And Enablement

Date: 2026-05-25

Status: complete.

## Landed Scope

- Added Fastify module record commands for create, patch, delete,
  enablement, global module reorder, and character module-link reorder.
- Added module command events:
  `module.created`, `module.updated`, `module.deleted`,
  `module.enabled`, `module.reordered`, and
  `character.modules.reordered`.
- Added typed browser helpers for the module command endpoints plus
  `src/ts/moduleCommands.ts` for optimistic dispatch and rollback.
- Routed server-backed web module settings create/edit/delete, global
  enablement, normal module imports, loadout module enablement, chat
  active-module toggles, character module-link toggles, and MCP module
  info/enablement writes through commands.
- Kept module lorebook edits on the 9-4a replacement commands and module
  regex/trigger edits on the 9-4b replacement commands.
- Rejected MCP module rows from normal module record commands and made
  MCP module import explicitly unsupported in server-backed web mode.
- Left asset bytes/references out of module record commands; module
  imports with asset references remain deferred to 9-4d.

## Guardrails

- Chat active-module toggles now use the existing chat metadata command
  with the 9-4c-owned `modules` field; character-scoped module links use
  the new character module reorder command.
- Module delete removes references from `enabledModules`, character
  module links, chat active-module links, and loadout module lists in the
  same command mutation.
- Module patch excludes `id`, `mcp`, lorebooks, scripts, triggers, and
  asset references. Child definition edits stay on their owning commands.
- Projection enforcement, plugin records/storage, provider-key masking,
  storage gating, and server `.risu` import/export remain deferred.

## Tests

- Added Fastify command tests for module lifecycle, enablement, reorder,
  character module-link reorder, deletion reference cleanup, malformed
  payloads, MCP-row rejection, stale revisions, emitted events, and
  bootstrap visibility.
- Added browser helper tests for module command URLs, methods, and
  payloads.
- Updated compatibility adapter coverage so MCP module info and enablement
  writes dispatch module commands in Fastify mode.
- Focused verification run during the slice:
  `pnpm api:test -- commands.test.ts` passed with 1107 tests.
- Focused browser verification run during the slice:
  `pnpm test -- src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts`
  passed with 692 tests and 4 skipped.
- `pnpm check` is clean.
- `pnpm test` passes with 692 tests and 4 skipped.
- `pnpm api:test` passes with 1107 tests.
- `pnpm build` passes with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-4d asset reference commands.
- Keep plugin records/storage, projection, storage gating,
  provider-key masking, and `.risu` import/export in their assigned later
  slices.
