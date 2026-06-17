# User Input State Hardening Solve Note

Date: 2026-06-17

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

Phase 0, Phase 1, Phase 2, Phase 3, and Phase 4 are complete. Phase 0 locked the
contract and baseline documentation. Phase 1 added shared stale-state helpers
with focused coverage and landed settings, character, and chat row metadata
rollback adopters. Phase 2 landed dirty projection protection for character
profile drafts, prompt-template item rows, generic settings drafts, selected
persona profile fields, translator preset `name`/`prompt`/`maxResponse` fields,
lorebook entry drafts, and selected-character script/trigger draft rows while
keeping clean projection fields refreshed. Phase 3 closed the
upload/import/fetch callback slice for custom background, composer file/paste,
character avatar/additional asset/emotion/TTS, settings media, module asset,
prompt icon, NanoGPT fetch, color scheme, plugin import/update, persona icon,
BotSettings bias JSON, sidebar folder image, NovelAI vibe, and EasyPanel
separate-parameters paths. The final Phase 3 audit found no known live callback
surface still pending. Phase 4 closed the chat/message/generation slice:
DefaultChatScreen composer send/continue clear/restore, auto-translate
freshness, reroll active-chat freshness, partial edit/delete modal freshness,
suggestion persistence freshness, attempt-aware chat-scoped message rollback,
durable generation finalization target-row freshness, and dynamic rendered
button trigger freshness have landed. Phase 5 has started: character/module
script and trigger replacement rollback now captures attempted payloads,
preserves newer same-target edits on stale failure, keeps coalesced rollback
baselines correct, and avoids suppressing watcher dispatch after stale no-op
rollback. Plugin custom storage rollback now captures per-key attempted values
for PUT, DELETE, and bulk operations, preserves newer sibling keys, and unwinds
overlapping same-key failures correctly even when command responses arrive out
of order. Plugin non-storage rollback now captures attempted targets for
`realArg`, `enabled`, explicit delete, and provider selection, preserving newer
storage, provider, and sibling plugin edits on stale failures. Plugin create,
full update, reorder, and DB bridge collection patch rollback now use frozen
attempted payloads plus row, field, and order records, and collection sequences
keep earlier successful server-accepted steps when later steps fail. Global
module command rollback, MCP module-info rollback, plugin DB bridge settings
rollback, persona create/delete/reorder rollback, and translator preset
collection command rollback have also landed for their Phase 5 slices.
Prompt-template item create/delete/reorder rollback has landed as the next
preset-domain slice. Split prompt/model preset array rollback has landed for
create, prompt import, delete, select, and reorder commands. Legacy bot preset
rollback has landed for save, copy, select, create, update, delete, reorder, and
legacy extraction commands. Persona residual command rollback has landed for
queued profile saves, direct saves, trigger prompt saves, persona selection,
icon save, and import-created rows. Scoped lorebook entry replacement rollback
has landed for character, chat, global lorebook-entry, and module-lorebook entry
create/update/delete/reorder/full-replace failures. Top-level global lorebook
list rollback has landed for create, rename, delete, reorder, and select
failures. MCP module lorebook, regex, and Lua-trigger rollback has landed for
module-scoped MCP writes. MCP character regex and Lua-trigger rollback has
landed for character-scoped MCP writes. `applyModule()` multi-domain rollback
has landed for module-apply fan-out. Chat folder command rollback has landed for
create, update, delete, and reorder commands. Chat list command rollback has
landed for create, delete, and reorder commands. Character sidebar
`characterOrder` rollback has landed for drag reorder, folder creation/order,
and folder metadata update commands. Character list create/delete/import
rollback has landed for create, create-and-select, import-style create, and
permanent delete commands. Hypa V3 preset array rollback has landed for
append/import, rename/settings edit, and delete settings patches. Combined
sidebar chat/folder reorder rollback has landed for folder drag reorder command
sequences.

Next manager loop:

1. Read `README.md`, `STRUCTURE.md`, `status.md`, `latest-verification.md`, and
   `phases/phase-5-collection-domains.md`.
2. Spawn an explorer agent for the next Phase 5 collection-domain rollback and
   projection-hardening slice.
3. Spawn a worker agent for the selected Phase 5 slice, then a verification
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
- Phase 5 script/trigger replacement rollback has landed for character/module
  script and trigger replacements. Phase 5 plugin custom storage rollback has
  landed for PUT, DELETE, and bulk storage operations. Phase 5 plugin
  non-storage rollback has landed for `realArg`, `enabled`, explicit delete, and
  provider selection. Phase 5 plugin collection/full-plugin rollback has landed
  for create, full update, reorder, and DB bridge collection patch paths. Phase
  5 global module command rollback has landed for create, update, delete,
  enable, reorder, and plugin DB bridge module/enabledModules patch paths. Phase
  5 MCP module-info rollback has landed for `risu-set-module-info` PATCH plus
  enable command sequences. Phase 5 plugin DB bridge settings rollback has
  landed for Plugin V2 database settings patches. Phase 5 persona collection
  rollback has landed for create, delete, and reorder commands. Phase 5
  translator preset collection rollback has landed for create, select, delete,
  and import command-dispatch failures. Phase 5 prompt-template item collection
  rollback has landed for create, delete, and reorder commands. Phase 5 split
  prompt/model preset array rollback has landed for create, prompt import,
  delete, select, and reorder commands. Phase 5 legacy bot preset rollback has
  landed for save, copy, select, create, update, delete, reorder, and legacy
  extraction commands. Phase 5 persona residual command rollback has landed for
  queued profile saves, direct saves, trigger prompt saves, persona selection,
  icon save, and import-created rows. Phase 5 scoped lorebook entry replacement
  rollback has landed for character, chat, global lorebook-entry, and
  module-lorebook entry create/update/delete/reorder/full-replace failures.
  Phase 5 top-level global lorebook list rollback has landed for create, rename,
  delete, reorder, and select failures. Phase 5 MCP module lorebook, regex, and
  Lua-trigger rollback has landed for module-scoped MCP writes. Phase 5 MCP
  character regex and Lua-trigger rollback has landed for character-scoped MCP
  writes. Phase 5 `applyModule()` multi-domain rollback has landed for
  module-apply fan-out. Phase 5 chat folder command rollback has landed for
  create, update, delete, and reorder commands. Phase 5 chat list command
  rollback has landed for create, delete, and reorder commands. Phase 5
  character sidebar order/folder metadata rollback has landed for drag reorder,
  folder creation/order, and folder metadata update commands. Phase 5 character
  list create/delete/import rollback has landed for create, create-and-select,
  import-style create, and permanent delete commands. Phase 5 Hypa V3 preset
  array rollback has landed for append/import, rename/settings edit, and delete
  settings patches. Phase 5 combined sidebar chat/folder reorder rollback has
  landed for folder drag reorder command sequences. Phase 5 chat fork rollback
  has landed for sidebar copy and branch fork command failures. Phase 5 chat
  metadata PATCH rollback has landed for direct chat row metadata updates.
  Phase 5 chat import flow rollback and target freshness has landed for
  multi-chat import sequences and picker selection drift. Phase 5 lorebook
  import target freshness has landed for character, chat, and global lorebook
  imports. Remaining sidebar and import collection flows and plugin
  import/update side-effect reload remain Phase 5 work.
- `src/ts/compatibilityAdapters.test.ts` currently has a pre-existing failure in
  `routes MCP character lorebook writes through lorebook commands in
  server-backed web mode` at line 626. It reproduced in a detached baseline
  worktree at commit `30d4ad7ab`, before the MCP module-info slice.
- Realm/backup/local bundle restore/import resyncs, character/chat import
  refresh/navigation edges, memory job list/progress ordering, route/selection
  hydration, welcome/onboarding delayed setup, and DevTool autopilot long-loop
  chat targeting remain Phase 6 work.
- Projection-absent optional clean-field deletion remains outside Phase 2 because
  the shared merge helper refreshes fields present in the projection surface.

No known code gap blocks Phase 1, Phase 2, Phase 3, or Phase 4 completion.

## Later Phase Order

Proceed in this order unless a verification result proves a dependency needs to
move earlier:

1. Phase 5 collection-domain rollback and projection hardening.
2. Phase 6 resync, memory, restore/import, and navigation fences.
3. Phase 7 final verification and closeout.

Each phase should end with focused tests or an explicit residual gap recorded in
`status.md` and latest proof recorded in `latest-verification.md`.
