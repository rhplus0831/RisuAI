# Phase 9-4b - Script And Trigger Definition Commands

Date: 2026-05-25

Status: complete.

## Landed Scope

- Added Fastify whole-child replacement commands for character regex
  scripts, character trigger definitions, module regex scripts, and module
  trigger definitions.
- Added stable ids for script and trigger definition rows in the current
  schema. Import normalization only touches existing definition arrays and
  does not create unrelated character/module scaffolding.
- Added typed browser helpers for the new script/trigger command endpoints.
- Added `src/ts/server/scriptDefinitionBridge.svelte.ts` to route bound
  character/module script surfaces through debounced replacement commands
  with rollback.
- Wired character script settings and module script settings to the bridge
  in Fastify mode.
- Routed MCP character and module regex/Lua script writes through the new
  replacement commands in Fastify mode.

## Guardrails

- Runtime trigger side effects remain owned by the 9-3e chat
  `scriptstate` command.
- Module lifecycle and enablement remain deferred to 9-4c.
- Asset references remain deferred to 9-4d; MCP asset writes still stay
  unsupported in server-backed web mode.
- Plugin records, plugin storage, and plugin whole-database bridge work
  remain deferred to 9-4e/9-4f.
- Browser projection, storage gating, provider-key masking, and server
  `.risu` import/export remain deferred to later Phase 9 slices.

## Tests

- Added Fastify command tests for character/module script and trigger
  replacement, malformed payloads, missing parents, stale revisions,
  emitted events, and bootstrap visibility.
- Added browser helper tests for script/trigger command URLs, methods, and
  payloads.
- Updated compatibility adapter coverage so MCP character/module regex and
  Lua writes dispatch Fastify commands in server-backed web mode.
- Focused verification run during the slice:
  `pnpm api:test -- commands.test.ts` passed with 1104 tests.
- Focused browser verification run during the slice:
  `pnpm test -- src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts`
  passed with 690 tests and 4 skipped.
- `pnpm check` is clean.
- `pnpm test` passes with 690 tests and 4 skipped.
- `pnpm api:test` passes with 1104 tests.
- `pnpm build` passes with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-4c module records and enablement.
- Keep asset references, plugin records/storage, projection, storage
  gating, provider-key masking, and `.risu` import/export in their assigned
  later slices.
