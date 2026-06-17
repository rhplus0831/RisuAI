# Phase 5: Collection Domains

Status: active.

Goal: finish stale-state hardening for broad collection domains where delayed
commands or projections can restore old lists over newer edits.

## Scope

- Presets, prompt presets/items/settings, personas, translator presets, and
  loadouts.
- Lorebooks, lorebook entries/folders/order, scripts, triggers, and regex
  collections.
- Modules, module lorebooks/scripts/triggers/assets, module enable/delete/import
  operations, and module picker assignments.
- Plugins, plugin import/update/delete/enable/provider selection, argument
  controls, and custom storage API.
- Sidebar chat/folder lists, character grids, folder context menus, ordering,
  create/delete/import, and generation picker rollback.

First landed slice: `scriptDefinitionBridge.svelte.ts` now scopes
character/module script and trigger replacement rollback by attempted payload.
Failed scoped replacements restore the prior collection only when live state
still equals the attempted scripts/triggers; stale same-target edits are
preserved, coalesced edits retain the first baseline and latest attempted
payload, and stale no-op rollback clears suppression synchronously.

## Anchors

- `src/lib/Setting/botpreset.svelte`
- `src/lib/UI/PromptDataItem.svelte`
- `src/lib/Setting/listedPersona.svelte`
- `src/lib/Others/LoadoutModal.svelte`
- `src/lib/Setting/lorepreset.svelte`
- `src/lib/Setting/Pages/Module/`
- `src/ts/process/modules.ts`
- `src/ts/plugins/`
- `src/lib/SideBars/SideChatList.svelte`
- `src/lib/Others/ChatList.svelte`
- `src/lib/SideBars/CharList.svelte` and related character list/grid files.

## Target Shape

- Collection commands roll back by id/key and attempted value, not by whole
  collection snapshot.
- Reorder failures do not undo later reorder operations.
- Create/import/delete failures do not restore deleted siblings or remove newer
  siblings.
- Plugin storage operations preserve newer key writes even if an older command
  fails.
- Sidebar and modal list selections do not revert newer selection state after
  older failures.

## Exit Criteria

- Focused tests exist for each converted broad rollback family.
- Preset/persona/loadout, lore/script/module/plugin, and sidebar/list domains
  each have at least one stale-failure regression covering edit-after-dispatch.
- Any remaining broad rollback path is explicitly marked as intentionally
  destructive or recorded as a residual gap.

## Validation

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/server/commands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/commandSingleRowPaths.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add focused tests next to the changed domain helpers/components.

## Risks

- Reorder operations are easy to model as whole arrays. Use stable ids and
  compare the attempted order before rollback.
- Plugin storage and module/lore replacements may need small domain-specific
  patch helpers before broad rollback can be removed cleanly.
