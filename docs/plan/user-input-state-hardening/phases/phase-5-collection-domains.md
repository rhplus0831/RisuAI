# Phase 5: Collection Domains

Status: complete.

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

Twelfth landed slice: legacy bot preset rollback now scopes save, copy, select,
create, update, delete, reorder, and legacy extraction failures by attempted
row, field, order, selection, generated split row, and scalar settings state.
Failed legacy preset commands no longer restore whole preset snapshots over
newer sibling rows, same-row edits, split preset edits, or changed selection.

Thirteenth landed slice: persona residual command rollback now scopes queued
profile saves, direct saves, trigger prompt saves, persona selection, icon save,
and persona import-created rows by attempted row, profile mirror, selection, and
created-row state. Failed persona commands no longer restore full persona
snapshots over newer sibling rows, same-row edits, profile mirrors, or
selection.

Fourteenth landed slice: scoped lorebook entry replacement rollback now freezes
attempted entry collections at queue time and rolls back character, chat, global
lorebook-entry, and module-lorebook entry failures by attempted id, value, and
order. Failed scoped entry create/update/delete/reorder/full-replace commands no
longer restore broad lorebook snapshots over newer sibling entries, same-entry
edits, appended entries, or newer order changes.

Fifteenth landed slice: top-level global lorebook list rollback now scopes
create, rename, delete, reorder, and select failures by attempted row, name,
order, and selected lorebook id. Failed global lorebook commands no longer
restore full lorebook snapshots over newer sibling rows, row-name edits,
appended rows, order changes, or newer selection, and stale no-op rollback does
not suppress watcher dispatch.

Sixteenth landed slice: MCP module lorebook, regex, and Lua-trigger writes now
use scoped module lorebook/script/trigger rollback snapshots. Failed MCP module
lorebook, regex, or Lua-trigger commands no longer restore broad lorebook or
script-definition snapshots over sibling modules, characters, global lorebooks,
or unrelated module fields.

Seventeenth landed slice: MCP character regex and Lua-trigger writes now use
character-scoped script/trigger rollback records. Failed MCP character regex
set/delete or Lua-trigger commands no longer restore broad script-definition
snapshots over sibling characters, module scripts/triggers, or unrelated target
script/trigger fields.

Eighteenth landed slice: `applyModule()` now uses per-step scoped character
lorebook/script/trigger rollback records for module-apply fan-out. Failed module
apply sequences keep earlier accepted child replacements and roll back only the
failed or not-yet-run optimistic tail instead of restoring broad lorebook or
script-definition snapshots.

Nineteenth landed slice: chat folder create, update, delete, and reorder
commands now use scoped attempted-value rollback instead of full chat-state
restore. Failed chat folder commands preserve newer same-folder edits, sibling
folders, unrelated chat edits, moved affected chats, and newer folder reorders.

Twentieth landed slice: chat create, delete, and reorder commands now use scoped
attempted-value rollback instead of full chat-state restore. Failed chat list
commands preserve pre-existing same-id chats, newer same-row edits, sibling
edits/appends, stable chat-id selection, newer chat reorders, and newer folder
moves.

Twenty-first landed slice: character sidebar `characterOrder` drag reorder,
folder creation/order, and folder metadata updates now use order-only or
field-only attempted rollback instead of full character-state restore. Failed
character order commands preserve newer selected/current-character state, skip
rollback after newer order writes, keep newer folder metadata while restoring
the failed attempted order structure, and roll back only still-attempted folder
metadata fields.

Twenty-second landed slice: character create, create-and-select, import-style
create, and permanent delete command rollback now scopes to attempted rows,
order placement, and live selected character ids instead of full
character-state restore. Failed character list commands remove only unchanged
attempted creates, no-op rollback import-style creates with no optimistic row,
reinsert only still-missing deleted rows, preserve same-id replacement rows,
restore missing order placement without overwriting newer folder metadata, and
keep newer shifted selections by re-resolving selected character ids after
rollback.

Twenty-third landed slice: Hypa V3 preset array settings rollback now scopes
append/import, rename/settings edit, and delete failures by attempted preset row
or insertion index instead of restoring the whole `hypaV3Presets` array. Failed
Hypa preset commands preserve sibling edits, later appended rows, edited
attempted rows, duplicate-equivalent live rows, selection-only
`hypaV3PresetId` rollback, and newer shifted selections when a delete rollback
reinserts before the selected preset.

Twenty-fourth landed slice: combined sidebar chat/folder drag reorder now routes
folder and chat reorder commands through a focused chat-command helper instead
of broad chat-state restore. Failed combined reorders roll back attempted chat
order/folder assignments, roll back folder order only before the folder command
is accepted, preserve newer row edits, and keep accepted folder reorder results
when the later chat reorder command fails.

Twenty-fifth landed slice: chat fork rollback now scopes failed fork commands to
the attempted forked chat row, attempted source chat metadata patch, and
attempted branch folder creation instead of broad chat-state restore. Failed
forks remove only unchanged fork rows, restore source folder assignment only
while it still matches the attempted patch, preserve newer sibling chat/folder
edits and changed fork rows, tolerate sidebar copy paths with no optimistic
local insert, and remove created branch folders only when no live chat still
references them.

Twenty-sixth landed slice: `dispatchUpdateChat()` metadata PATCH rollback now
scopes failed chat-row updates to sanitized attempted fields instead of broad
chat-state restore. Failed metadata updates restore only fields whose live value
still matches the attempted optimistic patch, preserve newer same-row edits,
sibling chat/folder edits, and selection, freeze sanitized attempts for rollback
comparison, and treat empty patch plus select-only dispatches as metadata
rollback no-ops.

Twenty-seventh landed slice: chat import flows now use an attempted-aware import
batch dispatcher instead of broad chat-state restore. Failed multi-chat imports
keep earlier server-accepted folder/chat creates, roll back only unchanged
unaccepted imported folders/chats, preserve edited imported rows, handle
duplicate-id legacy imports as inserted rows, and re-resolve the import target
by stable character id after file-picker awaits so selection drift cannot import
into the wrong character.

Twenty-eighth landed slice: lorebook import now captures stable character,
chat, or global-lorebook targets before file-picker awaits and re-resolves them
by id before applying imported entries. Import rollback baselines are captured
immediately before the write against the resolved target, so edits made while
the picker was pending survive command rollback, and stale selection/page drift
cannot redirect the import into a different lorebook collection.

Twenty-ninth landed slice: plugin import/update runtime reload now waits for
accepted server-backed create/update command results before calling
`loadPlugins()`. Failed plugin import or remote update commands roll back the
optimistic DB write and return without loading runtime side effects from the
rejected plugin state, while successful commands still reload the runtime after
persistence acceptance.

Thirtieth landed slice: server-backed sidebar chat-folder creation now uses the
same optimistic insertion pattern as chat creation. The create-folder command
serializes the frozen attempted folder snapshot, and failed creates remove only
an unchanged unreferenced attempted folder so newer chats moved into that folder
are not orphaned.

Thirty-first landed slice: loadout create, delete, favorite, and apply command
rollback now uses attempted-value records instead of broad loadout/apply
snapshots. Failed creates remove only an unchanged attempted loadout row, failed
deletes reinsert only a still-missing row at a bounded previous index, failed
favorite commands restore only the `favorite` field while it still matches the
attempted value, and failed `applyLoadout()` sequences keep earlier
server-accepted persona, preset, and module steps while rolling back only the
failed or unattempted global-variable and touch tail effects.

Thirty-second landed slice: plugin V2/V3 compatibility character and chat
bridges now use scoped rollback helpers instead of broad state restore. Failed
plugin character writes restore only attempted target-row fields, while V3 chat
compatibility sequences preserve earlier accepted metadata, message, or
scriptstate steps and roll back only the unaccepted attempted tail.

Thirty-third landed slice: multi-group plugin DB bridge settings rollback now
splits settings patches by server settings group before dispatch. Failed later
groups preserve earlier server-accepted group effects, while failed first groups
roll back all unaccepted attempted settings keys and still preserve newer
same-key edits plus unrelated plugin, provider, storage, and module state.

Closeout note: Phase 5 is PASS/CLOSEABLE. Closeout exploration found no
remaining live broad collection rollback blocker in the Phase 5 domains.
Presets/personas/loadouts, lorebooks/scripts/modules/plugins, sidebar
chat/folder/character lists, and import collection flows are covered by
scoped/keyed/attempted-value or accepted-sequence rollback. Some broad helper
exports still exist, but no live Phase 5 collection rollback caller remains; the
old `ScriptDefinitionStateSnapshot` residual is stale because no live caller of
`currentScriptDefinitionStateSnapshot()` exists outside tests. Realm, backup,
local bundle restore/import resyncs, character/chat import refresh/navigation
edges, memory ordering, route/selection hydration, welcome/onboarding delayed
setup, and DevTool autopilot long-loop chat targeting remain Phase 6 work.

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
- Closeout exploration found no remaining live broad collection rollback blocker
  in the Phase 5 domains.

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
- Plugin storage and module/lore replacement broad rollback risks were closed by
  scoped domain-specific rollback helpers during Phase 5.
