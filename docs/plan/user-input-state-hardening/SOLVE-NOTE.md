# User Input State Hardening Solve Note

Date: 2026-06-18

## Manager Instruction

The current agent is acting as manager for this workstream. Keep this role even
if context is compressed.

Required process:

1. Read `README.md` and the phase router before choosing work.
2. Spawn an explorer agent to verify task details and determine how to solve the
   next slice.
3. After receiving the explorer result, spawn a worker agent to complete the
   implementation.
4. Once the worker finishes, spawn a verification agent to validate the work.
5. If verification succeeds, run Prettier, run the relevant validation commands,
   commit the changes, close finished agents, and move to the next task.
6. If verification fails, close the failed verification agent and spawn or reuse
   a worker agent to fix the reported issues.
7. Close every sub-agent after its work is complete.

Repository reminders:

- Use `pnpm`.
- Start by reading `STRUCTURE.md` when a new agent needs repo grounding.
- Use `pnpm dev:agent` only when browser/full-stack validation is needed, and
  stop it before finishing.
- Before committing, run Prettier.
- Server type checking requires:

```bash
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Current State

Phases 0 through 5 are complete. Phase 0 locked the contract and baseline
documentation. Phase 1 added shared stale-state helpers with focused coverage
and landed settings, character, and chat row metadata rollback adopters. Phase 2
landed dirty projection protection for character profile drafts, prompt-template
item rows, generic settings drafts, selected persona profile fields, translator
preset `name`/`prompt`/`maxResponse` fields, lorebook entry drafts, and
selected-character script/trigger draft rows while keeping clean projection
fields refreshed. Phase 3 closed the upload/import/fetch callback slice for
custom background, composer file/paste, character avatar/additional
asset/emotion/TTS, settings media, module asset, prompt icon, NanoGPT fetch,
color scheme, plugin import/update, persona icon, BotSettings bias JSON, sidebar
folder image, NovelAI vibe, and EasyPanel separate-parameters paths. The final
Phase 3 audit found no known live callback surface still pending. Phase 4 closed
the chat/message/generation slice: DefaultChatScreen composer send/continue
clear/restore, auto-translate freshness, reroll active-chat freshness, partial
edit/delete modal freshness, suggestion persistence freshness, attempt-aware
chat-scoped message rollback, durable generation finalization target-row
freshness, and dynamic rendered button trigger freshness have landed. Phase 5
closed the collection-domain rollback slice. Presets/personas/loadouts,
lorebooks/scripts/modules/plugins, sidebar chat/folder/character lists, and
import collection flows are covered by scoped/keyed/attempted-value or
accepted-sequence rollback. The closeout explorer returned PASS/CLOSEABLE and
found no remaining live broad collection rollback blocker in the Phase 5
domains. Some broad helper exports still exist, but no live Phase 5 collection
rollback caller remains; the old `ScriptDefinitionStateSnapshot` residual is
stale because no live caller of `currentScriptDefinitionStateSnapshot()` exists
outside tests. Phase 6 has landed memory job terminal/cancel ordering,
backup/local bundle full-resync latest-request fencing, and Realm import finish
refresh fencing. Memory job terminal or cancel updates now win over older
polling, SSE, cached `not-modified`, and Hypa V3 progress updates for the same
chat/job id. Full server projection resyncs now assign every
`forceServerProjectionResync()` call a latest request id, skip all older
bootstrap apply/hydration/reattach side effects once a newer request exists, and
return the final/latest request result so an older success cannot mask a newer
failure. Server-backed Realm import completion now uses
`forceServerProjectionResync('realm-import')`, always resyncs after successful
server commits, and gates completion progress, post-refresh navigation, and
completion/error alerts to the latest Realm operation. Character route
application now uses a route epoch so only the latest route can clear
`applyingRoute`/`routeApplicationPending`; character routes pass freshness
through `changeChar()`, re-resolve live character indexes by id after awaits,
and verify the selected character before selecting a routed chat. `changeChar()`
now fences delayed shell hydration with a latest selection-attempt id and writes
selection to the live id-located character index. Failed character select command
rollback now restores the previous selection only while the attempted
selection/currentChar and attempted `lastInteraction` are still live. Character
and chat import refresh/navigation now return and use stable imported `chaId`s,
re-resolve live indexes before selection, guard add-character post-import
navigation by latest import operation plus unchanged selection scope, guard
Realm local fallback navigation by returned id plus Realm operation token, and
make overlapping same-character chat imports latest-wins before mutating chats
or `chatPage`.

Next manager loop:

1. Read `README.md`, `STRUCTURE.md`, `status.md`, `latest-verification.md`, and
   `phases/phase-6-resync-memory-navigation.md`.
2. Spawn an explorer agent for the next remaining Phase 6 resync,
   restore/import, or navigation-fence slice.
3. Spawn a worker agent for the selected Phase 6 slice, then a verification
   agent after the worker completes.
4. If verification succeeds, run Prettier, run the relevant validation commands,
   commit, close finished agents, and move to the next task.
5. If verification fails, close the failed verification agent and spawn or reuse
   a worker agent to fix the reported issues.

Known path correction:

- Phase docs mention `src/ts/process/rerollNavigation.ts`; the current file is
  `src/ts/process/rerollNavigation.svelte.ts`.

## Completed Phase Proof

Phase 1 closeout validation:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/commands.test.ts src/ts/chatCommands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandSingleRowPaths.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Results: the client focused Vitest set passed 3 files and 94 tests; the Fastify
command Vitest set passed 2 files and 138 tests; both TypeScript checks passed.

Phase 2 closeout validation:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/ts/server/characterBridge.svelte.test.ts src/ts/server/promptTemplateBridge.svelte.test.ts src/ts/server/settingsBridge.svelte.test.ts src/ts/persona.test.ts src/lib/Setting/Pages/PersonaSettings.svelte.test.ts src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte.test.ts src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/scriptDefinitionBridge.svelte.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Results: closeout explorer returned PASS/CLOSEABLE on 2026-06-17. The latest
implementation proof for the final Phase 2 live local draft slice passed 3
files and 109 tests, and both TypeScript checks passed.

Phase 3 closeout validation:

```bash
pnpm exec vitest run src/ts/server/staleStateGuards.test.ts src/lib/Setting/Pages/Display/CustomBackgroundToggle.svelte.test.ts src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts src/ts/process/files/multisend.test.ts src/ts/characters.imageEmotion.test.ts src/ts/server/characterAdditionalAssetUpload.test.ts src/ts/server/moduleAssetUpload.test.ts src/ts/server/promptPresetIconUpload.test.ts src/ts/server/characterEmotionUpload.test.ts src/lib/Setting/Pages/BotSettings.svelte.test.ts
pnpm exec vitest run src/ts/server/nanoGPTDashboardFetch.test.ts src/lib/UI/NanoGPTDashboard.svelte.test.ts src/ts/server/settingsMediaAssetUpload.test.ts src/lib/Setting/Pages/OtherBotSettings.svelte.test.ts src/ts/server/characterTtsAssetUpload.test.ts src/lib/SideBars/CharConfig.svelte.test.ts src/ts/server/colorSchemeImport.test.ts src/ts/gui/colorscheme.test.ts src/ts/server/pluginImport.test.ts src/ts/plugins/plugins.test.ts src/ts/server/personaIconUpload.test.ts src/ts/persona.iconUpload.test.ts src/ts/server/biasImport.test.ts src/ts/server/characterFolderImageUpload.test.ts src/ts/server/naiVibeImport.test.ts src/ts/server/seperateParametersImport.test.ts src/lib/Others/AllSeperateParameters.svelte.test.ts src/lib/Others/ProTools/EasyPanel.svelte.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
git diff --check
```

Results: the first Vitest set passed 10 files and 67 tests; the second Vitest
set passed 18 files and 106 tests. Both TypeScript checks and `git diff --check`
passed. No known live Phase 3 upload/import/fetch callback surface remains
pending after final audit.

Explicit deferrals:

- Composer send/continue clear/restore, auto-translate, reroll active-chat
  freshness, partial edit/delete modal freshness, and suggestion persistence
  freshness have landed. Attempt-aware chat-scoped message rollback has landed
  for scoped message update/delete/truncate/replace-tail/replace-all failures.
  Durable generation finalization target-row freshness and dynamic rendered
  button trigger freshness have landed. Phase 4 is complete.
  Composer file and paste callbacks are already covered by Phase 3.
- Phase 5 is complete. Script/trigger replacement, plugin storage and
  non-storage operations, plugin collection/full-plugin changes, global modules,
  MCP module/character subdomains, plugin DB bridge settings, personas,
  translator presets, prompt-template items, split prompt/model presets, legacy
  bot presets, lorebooks, `applyModule()`, chat/folder/sidebar/character lists,
  imports, loadouts, plugin compatibility bridges, and multi-group settings
  sequences now use scoped/keyed/attempted-value or accepted-sequence rollback.
  Closeout exploration returned PASS/CLOSEABLE, and stale residual notes about
  import collection flows or sidebar collection edges should be read as closed.
- `src/ts/compatibilityAdapters.test.ts` currently has a pre-existing failure in
  `routes MCP character lorebook writes through lorebook commands in
  server-backed web mode` at line 626. It reproduced in a detached baseline
  worktree at commit `30d4ad7ab`, before the MCP module-info slice.
- Memory job terminal/cancel ordering has landed for polling, SSE, cached
  `not-modified`, and Hypa V3 progress updates. Backup restore, local bundle
  import, and Realm import completion now use latest-request fenced full
  projection resyncs where applicable. Character route and `changeChar()` shell
  selection freshness fencing has landed. Character/chat import refresh and
  post-import navigation freshness has landed. Welcome/onboarding delayed setup
  callbacks, DevTool autopilot active-chat locking/other long active-chat loops,
  and the server command-event character-selection hydration audit remain Phase
  6 work.
- Projection-absent optional clean-field deletion remains outside Phase 2 because
  the shared merge helper refreshes fields present in the projection surface.

No known code gap blocks Phase 1, Phase 2, Phase 3, Phase 4, or Phase 5
completion.

## Later Phase Order

Proceed in this order unless a verification result proves a dependency needs to
move earlier:

1. Phase 6 resync, memory, restore/import, and navigation fences.
2. Phase 7 final verification and closeout.

Each phase should end with focused tests or an explicit residual gap recorded in
`status.md` and latest proof recorded in `latest-verification.md`.
