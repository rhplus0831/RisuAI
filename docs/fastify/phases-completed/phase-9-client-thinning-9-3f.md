# Phase 9-3f - Compatibility Setters And Access Adapters

Date: 2026-05-25

Status: complete.

## Landed Scope

- Added shared compatibility diff dispatchers for whole-character and
  whole-chat legacy writes.
- Routed `setCurrentCharacter`, `setCharacterByIndex`, and
  `setCurrentChat` through existing character, chat, message, and
  scriptstate commands in Fastify mode while preserving local optimistic
  state.
- Routed slash compatibility message-history writes (`/send`, `/sendas`,
  `/comment`, `/cut`, and `/del`) through existing message/chat commands
  in Fastify mode.
- Routed plugin V3 character/chat index setters through the same
  compatibility dispatchers.
- Routed MCP `risu-set-character-info` scalar writes through existing
  character profile commands.
- Made MCP lorebook, regex script, Lua trigger, and additional-asset
  writes explicitly unsupported in server-backed web mode until their 9-4
  command slices land.

## Guardrails

- No new Fastify endpoint family was added for 9-3f.
- Character scalar patches still exclude child collections and asset
  references owned by later slices.
- Chat metadata patches still exclude messages, scriptstate, generation
  metadata, local lore, runtime fields, and child collections.
- Generic message history remains on the 9-3c commands.
- Generation result persistence remains on the 9-3d command.
- Chat scriptstate persistence remains on the 9-3e command.
- Plugin whole-database bridge and plugin storage remain deferred to
  9-4f.

## Tests

- Added compatibility adapter tests for character scalar command dispatch,
  chat metadata/message/scriptstate command dispatch, no command dispatch
  outside Fastify mode, and explicit unsupported MCP child writes.
- `pnpm check` is clean.
- `pnpm test` passes with 686 tests and 4 skipped.
- `pnpm api:test` passes with 1097 tests.
- `pnpm build` passes with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Follow-Up

- Continue with 9-4a lorebook collection commands.
- Replace the 9-3f MCP lorebook unsupported path once lorebook commands
  exist.
- Keep script/trigger definitions, module records, asset references,
  plugin records, plugin storage, projection, storage gating, provider-key
  masking, and `.risu` import/export in their assigned later slices.
