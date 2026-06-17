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

Second landed slice: `pluginCommands.ts` now scopes plugin custom storage
rollback by affected key and attempted value for PUT, DELETE, and bulk
operations. Failed older writes no longer restore the whole storage map over
newer sibling keys, and deferred same-key failures unwind correctly when
overlapping command failures resolve out of order.

Third landed slice: `pluginCommands.ts` now scopes plugin `realArg`, `enabled`,
explicit delete, and provider-selection rollback by target and attempted value.
Failed plugin field/provider commands no longer restore storage or unrelated
plugin rows, explicit delete failures reinsert only a still-missing plugin row,
and deferred same-target failures unwind correctly when responses resolve out of
order.

Fourth landed slice: plugin create, full update, reorder, and plugin DB bridge
collection patch rollback now use attempted row, field, and order records.
Create/update payloads are frozen before base-revision lookup, collection patch
steps clear their rollback operations after successful server commands, and a
later failed step rolls back only the failed or unattempted tail instead of
reverting earlier server-accepted changes.

Fifth landed slice: global module create, update, delete, enable, reorder, and
plugin DB bridge module/enabledModules patch rollback now use attempted row,
field, enabled-membership, reference, and order records. Failed module commands
restore only live state that still matches the attempted optimistic write,
preserve newer sibling and same-target edits, restore character/chat/loadout
references only while they still match the attempted delete state, and unwind
overlapping same-target failures in response order.

Sixth landed slice: MCP `risu-set-module-info` now reuses the global module
attempted rollback sequencer for its module PATCH plus enable command pair. A
failed PATCH rolls back only attempted fields and unattempted enable state, while
an accepted PATCH remains in live state if a later enable command fails.

Seventh landed slice: plugin V2 database settings patch rollback now captures
settings-specific previous and attempted values before optimistic bridge writes.
Failed settings commands restore only live settings keys that still match the
attempted values, preserving newer same-key edits plus plugin rows, provider
selection, and custom storage.

Eighth landed slice: persona create, delete, and reorder rollback now scopes to
the attempted collection change. Failed create removes only an unchanged
attempted row, failed delete reinserts only a still-missing row at its previous
index, failed reorder restores previous ID order only while live order still
equals attempted order, and selected profile mirrors restore only
attempted-matching values.

Ninth landed slice: translator preset create, select, delete, and import
command dispatch no longer passes a broad full translator state rollback. The
server-backed collection operations are non-optimistic, so failed delayed
collection commands leave newer projected preset rows, selection, and mirrored
`translatorPrompt`/`translatorMaxResponse` values intact while preserving the
existing scoped field-update rollback.

Tenth landed slice: prompt-template item create, delete, and reorder rollback
now scopes to the attempted item collection change. Failed create removes only
an unchanged attempted row, failed delete reinserts only a still-missing row at a
bounded previous index, and failed reorder restores previous id order only while
live id order still matches the attempted reorder, preserving live row content.

Eleventh landed slice: split prompt/model preset array rollback now scopes
create, prompt import, delete, select, and reorder failures away from broad
legacy preset snapshots. Create/import/delete use attempted keyed-list rollback,
reorder preserves live row objects while restoring prior id order only on
attempted-order matches, and select/delete-selected rollback restores only
attempted-matching selection and scalar settings.

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
