# Recent Regression Fixes Verification

Date: 2026-06-16

Status: normal

## Scope

Verified the recent fix commits that targeted recurring user-input update
failures: character background/profile edits, translator pending edits, persona
flush before generation, custom GUI builder persistence, module lorebook/script
draft normalization, split preset loadouts, Realm/v2 export assets, unsupported
plugin write rejection, MCP module/character optimistic projection, and global
lorebook selection.

## Result

The targeted recent-fix regression suite passes on current HEAD.

## Verification

Main agent and verification agent both ran the current targeted suite:

- Frontend: 13 files, 188 tests passed.
- Backend: 2 files, 142 tests passed.

Commands:

- `pnpm exec vitest run src/ts/server/characterBridge.svelte.test.ts src/ts/plugins/apiV3/v3.svelte.test.ts src/ts/plugins/plugins.test.ts src/ts/characterCards.pngImport.test.ts src/ts/loadout.test.ts src/lib/Setting/Pages/CustomGUISettingMenu.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte.test.ts src/ts/persona.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts src/ts/process/mcp/risuaccess/tests/modules.optimisticProjection.test.ts src/ts/process/mcp/risuaccess/tests/characters.setCharacterInfo.test.ts`
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/realmImport.test.ts server/fastify/__tests__/commands.test.ts`

## Note

This normal record is limited to the fixed paths above. It does not override the
separate bad records for current unresolved surfaces such as character
create/import, chat-list same-tab updates, settings debounce loss, and plugin V3
`sendChat(message)`.
