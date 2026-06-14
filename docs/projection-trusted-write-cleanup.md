# Projection Trusted Write Cleanup

Last audited: 2026-06-14.

This document records the `withTrustedServerProjectionWrite` caller audit and
the stabilization queue for moving trusted writes to projection, hydration,
command, rollback, and bridge boundaries.

## Scope

The audit found 211 production `withTrustedServerProjectionWrite(...)` call
expressions across 53 source files, excluding tests and docs. Most are
legitimate projection or command boundaries. The cleanup target is not zero
trusted writes. The target is that trusted writes should not live in arbitrary
UI handlers, hidden normalization paths, or multi-command fanout flows without a
coherent rollback/resync story.

## Keep Categories

- Projection apply and hydration:
  `src/ts/storage/database.svelte.ts`,
  `src/ts/server/projectionWriteGuard.svelte.ts`.
- Command helper optimism and rollback:
  `src/ts/chatCommands.ts`, `src/ts/characterCommands.ts`,
  `src/ts/moduleCommands.ts`, `src/ts/pluginCommands.ts`,
  most of `src/ts/persona.ts`.
- Bridge-managed drafts and rollback:
  `src/ts/server/settingsBridge.svelte.ts`,
  `src/ts/server/characterBridge.svelte.ts`,
  `src/ts/server/promptTemplateBridge.svelte.ts`,
  selected paths in `src/ts/server/lorebookBridge.svelte.ts` and
  `src/ts/server/scriptDefinitionBridge.svelte.ts`.
- Server-backed generation live rendering and server patch application:
  `src/ts/process/serverBackedSendChat.ts`,
  `src/ts/process/postGeneration/streamResponse.ts`.
- Svelte settings draft and rollback boundaries that are already narrow:
  selected callers in `src/lib/Setting/Pages/PromptSettings.svelte`,
  `src/lib/Setting/Pages/BotSettings.svelte`, and
  `src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte`.

## Solved Findings

- `src/ts/globalApi.svelte.ts`
  - `checkCharOrder()` is now a pure compatibility check. Explicit optimistic
    character-order repair lives in `src/ts/characterCommands.ts`, where callers
    choose command-backed reorder dispatch or suppressed repair for create/delete
    command flows.
- `src/ts/storage/database.svelte.ts`
  - Preset ID reads no longer perform hidden projection repair.
    `presetIdAt()` is pure, and `ensureBotPresetHydrated()` fails closed for
    missing, blank, duplicate, or invalid-index preset IDs before fetching
    hydration.
- `src/ts/storage/database.svelte.ts`
  - Preset save/copy/select/create/import/update/delete/reorder APIs now route
    projection mutation and command dispatch through one shared optimistic
    preset boundary. Current public operations intentionally remain one server
    command each; the boundary uses `runOptimisticCommandSequence()` so future
    multi-command preset flows advance revisions under one rollback snapshot.
- `src/ts/server/lorebookBridge.svelte.ts`
  - Lorebook broad/global snapshots and watcher baseline setup no longer assign
    missing IDs or initialize absent arrays. Watcher collection snapshots require
    stable scope IDs and stable unique entry IDs, and malformed watched
    collections are skipped instead of silently normalized.
- `src/ts/server/scriptDefinitionBridge.svelte.ts`
  - Script definition broad snapshots and watcher baseline setup no longer
    assign missing script/trigger IDs or initialize absent arrays. Watcher
    collection snapshots and watcher-origin replacement flushes require stable
    unique scope and script/trigger IDs, and malformed watched collections are
    skipped instead of silently normalized.
- `src/ts/loadout.ts`
  - `applyLoadout()` now applies requested facets in a single optimistic
    projection write and routes persona, preset, module, settings, and loadout
    touch commands through `runOptimisticCommandSequence()` with one scoped
    rollback for the facets touched by the apply.
- `src/ts/characters.ts`
  - Multi-chat imports now apply imported folders/chats in one optimistic
    projection write and route create-folder/create-chat commands through
    `runOptimisticCommandSequence()` so failures roll back the whole import and
    skip later commands.
- `src/ts/plugins/plugins.svelte.ts`
  - Plugin collection replacement now routes create, update, delete, and reorder
    diffs through one serialized optimistic command sequence with a single
    collection rollback.
- `src/ts/plugins/plugins.svelte.ts` and
  `src/ts/plugins/apiV3/v3.svelte.ts`
  - Server-backed full-character plugin replacements now prepare the same
    sanitized character patch used by the command, apply only those kept fields
    to the local row, preserve excluded fields and the original character ID,
    and skip no-op excluded-only replacements.
- `src/ts/process/triggers.ts`
  - `v2SetPersonaDesc` now routes through a persona domain helper that captures
    the pre-trigger snapshot, mirrors the legacy prompt/profile fields in one
    optimistic write, and rolls back both prompt locations on command failure.

## Findings

### P0: Component-Level Trusted Writes

UI components should not expose generic trusted mutator wrappers or own
durable-domain mutation details. Move these writes into domain helpers that own
snapshot capture, optimistic projection write, command dispatch, and rollback.
The list below is the current target list for component cleanup, not a complete
list of every Svelte caller; narrow settings draft and rollback boundaries are
listed under keep categories.

- `src/lib/Setting/Pages/PersonaSettings.svelte`
  - Generic `runWithoutPersonaWatcher(mutator)` for persona select, reorder,
    create, and delete.
  - Selected persona field setters directly mutate projection and rely on a
    component-local watcher to dispatch commands.
- `src/lib/SideBars/Sidebar.svelte`
  - Character order and folder metadata mutations in UI handlers.
- `src/lib/ChatScreens/DefaultChatScreen.svelte`
  - Active chat `fmIndex` and playground message append mutations in UI
    handlers.
- `src/lib/SideBars/LoreBook/LoreBookList.svelte`
  and `src/lib/SideBars/LoreBook/LoreBookSetting.svelte`
  - Lorebook collection replacement from UI handlers.
- `src/lib/SideBars/LoreBook/LoreBookData.svelte`
  - Local activation toggles mutate active chat lore directly.
- `src/lib/Setting/Pages/Module/ModuleMenu.svelte`
  - Module lorebook edits dual-write the live module and local draft before
    dispatching replacement.
- `src/lib/Setting/lorepreset.svelte`
  - Global lorebook create, rename, and delete mutate projection in the
    component.
- `src/lib/Setting/Pages/PluginSettings.svelte`
  - Plugin arg, enable, and delete mutations live in the component.
- `src/lib/Others/LoadoutModal.svelte`
  - Loadout favorite/delete mutations live in the component.
- `src/lib/Others/ChatList.svelte`
  - Contains a command-unavailable rename fallback; in Fastify mode command
    helpers should own the path.
- `src/lib/SideBars/CharConfig.svelte`
  - Generic trusted mutator for chat `fmIndex`; script/trigger draft copy into
    character row.
- `src/lib/SideBars/DevTool.svelte`
  - Chat scriptstate patch uses a broad component-level projection write before
    dispatch.
- `src/lib/Others/WelcomeRisu.svelte`
  - Onboarding applies settings by mutating projection first and diffing after.

### P2: Retained Local Generation And Compatibility Paths

These paths may be legacy or retained compatibility behavior. They should be
classified as unreachable in Fastify mode, converted to local-only ephemeral
state, or routed through server-owned finalization/patch commands.

- `src/ts/process/sendChatPromptAssembly.ts`
  - Local prompt assembly writes run-var-expanded messages back to projection.
- `src/ts/process/postGeneration/nonStreamResponse.ts`,
  `src/ts/process/postGeneration/orchestrateResponse.ts`,
  `src/ts/process/postGeneration/outputTrigger.ts`,
  `src/ts/process/postGeneration/stage4Finalize.ts`
  - Retained local post-generation writes final text, inlay text, trigger
    output, reload state, or timing metadata without command ownership.
- `src/ts/process/promptAssembly/buildMemoryWindow.ts`
  - `lastMemory` can be written without a chat id and without persistence.
- `src/ts/process/scripts.ts`
  - `@@inject` can mutate a live message during script processing without a
    command.
- `src/ts/process/serverBackedSendChat.ts`
  - Browser inlay rendering mutates assistant text after server patch apply.
## Cleanup Order

1. Centralize persona UI mutations into persona domain helpers.
2. Move chat, character, lorebook, plugin, loadout, and onboarding UI trusted
   writes into domain or bridge helpers.
3. Move hidden ID/default normalization server-side or make it pure.
4. Replace multi-command fanout with bulk commands or serialized command
   sequences.
5. Classify and clean retained local generation and plugin compatibility paths.

## Acceptance Criteria

- No Svelte component should expose a generic trusted projection mutator.
- Durable user edits should have a command or explicit server mutation route.
- Optimistic projection writes should have scoped snapshots and rollback or a
  deliberate resync-on-conflict strategy.
- Server-originated projection application should use `withServerProjectionApply`
  when bridge watchers must refresh baselines.
- Hidden normalization should not mutate `DBState.db` outside a projection or
  command boundary.
