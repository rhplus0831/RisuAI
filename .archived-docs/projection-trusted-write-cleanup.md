# Projection Trusted Write Cleanup

Last audited: 2026-06-14.

This document records the `withTrustedServerProjectionWrite` caller audit, the
resolved stabilization work, and the regression guardrails for keeping trusted
writes at projection, hydration, command, rollback, and bridge boundaries.

## Scope

The audit found 189 production `withTrustedServerProjectionWrite(...)` call
expressions across 39 source files, excluding tests and docs. Most are
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
- `src/ts/process/promptAssembly/buildMemoryWindow.ts`
  - `lastMemory` still uses the command-backed optimistic DBState write when a
    chat id is available, but no-id server command requests now keep the value
    request-local instead of mutating projection without a durable command.
- `src/ts/process/scripts.ts`
  - `@@inject` is display-only during `editdisplay`, and server-backed
    non-display injection now requires a message id so the optimistic write can
    dispatch a scoped message patch with rollback.
- `src/ts/process/sendChatPromptAssembly.ts`
  - The browser-local prompt assembler is retained for the local/parity test
    path. Live Fastify sends route through `resolveServerPromptAssembly()` into
    `assembleServerBackedSendChat()` and `POST /api/v1/generate/chat`; supported
    sends are server-assembled, unsupported sends hard-fail, and durable run-var
    / message mutation is owned by the server assembly/generation route instead
    of this local projection write.
- `src/ts/process/postGeneration/nonStreamResponse.ts`,
  `src/ts/process/postGeneration/orchestrateResponse.ts`,
  `src/ts/process/postGeneration/outputTrigger.ts`,
  `src/ts/process/postGeneration/stage4Finalize.ts`
  - `nonStreamResponse` and `outputTrigger` are retained local-only
    post-generation behavior. On the server-dispatch path,
    `orchestrateResponse` relays the stream for display and skips local output
    trigger, inlay, TTS, and editoutput derivation while the terminal
    `done.postGeneration` patch supplies server-owned final text, scriptstate
    changes, and resend state. `stage4Finalize` only writes browser-side timing
    metadata onto an existing in-memory `generationInfo`; it does not create a
    durable generation result. Residual timing metadata is therefore
    non-durable unless durable timing persistence becomes a product
    requirement.
- `src/ts/process/serverBackedSendChat.ts`
  - Browser inlay rendering in `applyServerBackedTerminal()` runs after applying
    the server-owned final text/message patch. The durable generation result is
    still persisted by `POST /api/v1/generate/chat` through
    `persistServerGenerationResult`, not by legacy `/generation-result`; the
    inlay result is browser display text over the server-owned final message.
    Residual inlay display text is non-durable unless durable inlay rendering
    becomes a product requirement.
- `src/lib/Setting/Pages/PersonaSettings.svelte`,
  `src/lib/SideBars/Sidebar.svelte`,
  `src/lib/ChatScreens/DefaultChatScreen.svelte`,
  `src/lib/SideBars/LoreBook/LoreBookList.svelte`,
  `src/lib/SideBars/LoreBook/LoreBookSetting.svelte`,
  `src/lib/SideBars/LoreBook/LoreBookData.svelte`,
  `src/lib/Setting/Pages/Module/ModuleMenu.svelte`,
  `src/lib/Setting/lorepreset.svelte`,
  `src/lib/Setting/Pages/PluginSettings.svelte`,
  `src/lib/Others/LoadoutModal.svelte`,
  `src/lib/Others/ChatList.svelte`,
  `src/lib/SideBars/CharConfig.svelte`,
  `src/lib/SideBars/DevTool.svelte`, and
  `src/lib/Others/WelcomeRisu.svelte`
  - The final P0 component audit found no remaining component-owned
    `withTrustedServerProjectionWrite(...)` calls or generic trusted mutator
    wrappers in the named targets. Persona, sidebar, default chat, chat list,
    dev tool, plugin, loadout, and onboarding mutations now route through
    persona, character, chat, plugin, loadout, and settings helpers. Lorebook
    and module lorebook edits now route through scoped `lorebookBridge` helpers.
    Character profile and script edits now use `createServerBackedCharacterDraft`
    and `applyCharacterScriptDefinitionDraft` bridge boundaries. The only
    remaining `src/lib` production trusted writes are the already-classified
    narrow settings draft and rollback boundaries listed under Keep Categories.

## Findings

No active projection trusted-write cleanup findings remain from this audit.
Residual non-durable generation display/timing behavior is classified above.

## Cleanup Order

No cleanup queue remains for the audited projection trusted-write findings.
Future work should use the acceptance criteria below as regression guardrails.

## Acceptance Criteria

- No Svelte component should expose a generic trusted projection mutator.
- Durable user edits should have a command or explicit server mutation route.
- Optimistic projection writes should have scoped snapshots and rollback or a
  deliberate resync-on-conflict strategy.
- Server-originated projection application should use `withServerProjectionApply`
  when bridge watchers must refresh baselines.
- Hidden normalization should not mutate `DBState.db` outside a projection or
  command boundary.
