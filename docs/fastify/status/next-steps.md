# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-5b and 9-5c moved Fastify-served web startup onto
`GET /api/v1/bootstrap` and subscribed it to `GET /api/v1/events`.

Two 9-5d residual sweep passes then landed:

- Character asset helpers and legacy v1 chat JSON imports now dispatch
  existing character/chat commands in Fastify mode.
- Drag, manual, service-worker, and browser file-handler `.risum` module
  import paths now return explicit unsupported behavior in server-backed
  web mode before local asset writes.
- Lorebook local activation now dispatches the existing chat lorebook
  replacement command after the optimistic `chat.localLore` change.
- Focused regressions landed in `src/ts/compatibilityAdapters.test.ts`
  and `src/ts/process/modules.test.ts`.

9-5d-i then routed remaining settings-style residual writes through the
existing settings command bridge:

- Manual settings pages now watch residual provider/runtime/display/media/
  advanced keys such as `NAIsettings`, `ainconfig`, `localStopStrings`,
  `modelTools`, `customModels`, `banCharacterset`, `colorScheme`, and
  `showUnrecommended`.
- Dedicated resource command bridges stayed authoritative for prompt
  templates/items, personas, translator presets, plugins, modules, and
  import/storage paths.
- Focused regression coverage landed in `src/ts/server/commands.test.ts`.

9-5d-ii then audited the 9-2 resource UI tails:

- Prompt template/item, persona, translator preset, and loadout
  UI/helper writes remain optimistic local updates followed by existing
  resource commands and rollback, or are documented deferred composite
  apply behavior.
- Persona and translator preset delete commands now use explicit
  `selectPersonaId` and `selectPresetId` request payload fields instead
  of overloading the path resource id names.
- Focused browser-command and Fastify route coverage stayed green in
  `src/ts/server/commands.test.ts` and
  `server/fastify/__tests__/commands.test.ts`.

9-5d-iii then audited the 9-3 character/chat UI tails:

- Character profile/assets, chat folders, selected chat/page state,
  playground, realm/grid helpers, and legacy chat import helpers now
  remain on existing character/chat/message/generation/scriptstate
  command helpers or local UI-only state.
- Compact chat-list creation now selects the unshifted new chat locally,
  matching the default `createChatCommand` server selection, and seeds
  group first messages on the new chat object before dispatch.
- Cold-storage character hydration now returns explicit unsupported
  behavior in server-backed web mode before reading local cold-storage
  blobs or replacing the projected character object.
- Focused regression coverage landed in
  `src/ts/compatibilityAdapters.test.ts`.

9-5d-iv then audited the 9-4 extension UI/API tails:

- Lorebook, module UI/MCP helper, plugin settings, plugin database
  translation, and plugin-storage residual writes remain on existing
  lorebook, script/trigger, module, plugin, plugin-storage, or settings
  command helpers, or explicit unsupported behavior for server-backed
  module import paths.
- `moduleIntergration` is now covered by the grouped settings command
  bridge so plugin database writes and BotSettings edits no longer leave
  a server-backed local-only scalar update.
- Plugin V3 color/text theme APIs now dispatch existing settings commands
  after their optimistic local update, with rollback restoring the
  projected display state if the command fails.
- Focused browser-command, plugin bridge, MCP/module, and Fastify route
  coverage stayed green in `src/ts/server/commands.test.ts`,
  `src/ts/plugins/plugins.test.ts`, `src/ts/compatibilityAdapters.test.ts`,
  `src/ts/process/modules.test.ts`, and
  `server/fastify/__tests__/commands.test.ts`.

9-5d-v then audited process/runtime durable writes:

- Terminal server-backed generation persistence already dispatches the
  existing generation-result command; transient streaming display state
  stays browser-local for the guard integration slice.
- SendChat entry-context `lastInteraction` updates now dispatch the
  existing character patch command, missing message id backfill dispatches
  message replacement, and the local `statics.messages` counter is skipped
  in Fastify projection mode.
- Scriptstate writes in triggers, slash/STScript commands, parser chat
  vars, and server message patch replay remain on the existing chat
  scriptstate command bridge.
- Legacy Hypa V3 `hypaV3Data` writeback no longer mutates DB state in
  server-backed web mode; Phase 8 server memory remains authoritative.
- MCP OAuth refresh token writes now dispatch grouped providers settings
  commands after optimistic local updates, with rollback coverage.
- Focused process/runtime and compatibility coverage stayed green in
  `src/ts/process/__tests__/sendChatContext.test.ts`,
  `src/ts/process/__tests__/buildMemoryWindow.test.ts`,
  `src/ts/process/mcp/mcp.test.ts`,
  `src/ts/compatibilityAdapters.test.ts`, and
  `src/ts/server/commands.test.ts`.

9-5e-i then added the projection write gate foundation:

- `src/ts/storage/database.svelte.ts` now exposes an opt-in Fastify
  projection write guard and `applyServerProjectionDatabase()` trusted
  replacement helper.
- Initial server bootstrap and event-triggered re-bootstrap writes now use
  the trusted projection helper instead of calling `setDatabase` directly.
- Focused bootstrap coverage proves trusted projection replacement still
  works, direct guarded Fastify projection writes fail loudly when enabled,
  and local web writes remain unguarded.
- Command optimistic/rollback integration was left to 9-5e-ii.

9-5e-ii then integrated command bridges with the projection guard:

- The guard primitive now lives in
  `src/ts/server/projectionWriteGuard.svelte.ts`, with
  `storage/database.svelte.ts` re-exporting the existing bootstrap/test
  helper surface.
- Command-owned rollback restorers for character, chat, module, plugin,
  loadout, persona, settings, lorebook, script-definition, plugin V3
  settings/theme, and MCP refresh-token paths now run inside trusted
  projection write scopes.
- Preset helper optimistic writes, selected character/chat compatibility
  setters, and command-side id normalization helpers now run inside trusted
  projection write scopes.
- Focused guard coverage proves trusted writes can update a guarded Fastify
  projection and the projection is read-only again after the trusted scope
  exits.

## Immediate Pickup

Immediate pickup: **9-5e-iii - Guard audit closeout**.

- Enable the guard across the server-backed fixture path and classify
  failures as missed 9-5d residuals, intentional local/runtime-only state,
  or follow-up residual slices.
- Keep Tauri/local mode untouched.
- Do not add new command endpoints.
- Do not broaden this slice into storage/provider
  gating, server-side `.risu` import/export, asset byte changes,
  server-side plugin execution, per-event surgical browser patches, or
  residual-write implementation.
- If the fixture-path audit reveals missed durable writes, split them into
  follow-up residual slices instead of folding them into 9-5e-iii.

Implementation notes:

- Command code lives in `server/fastify/src/commands/`,
  `server/fastify/src/routes/commands.ts`, and
  `src/ts/server/commands.ts`. The command map is the source of truth for
  names, payload behavior, events, and plugin bridge policy.
- The browser-side trusted write helper lives in
  `src/ts/server/projectionWriteGuard.svelte.ts`; keep it as the narrow
  escape hatch for command-owned optimistic writes, rollbacks, and
  bootstrap projection replacement.
- Browser projection now loads through `src/ts/server/bootstrap.ts` and
  refreshes from `src/ts/server/events.ts`; debounced re-bootstrap is the
  Phase 9 target, while per-event patches are future work.
- Tauri keeps its local storage path. All 9-5d gates should be
  server-backed web specific.
- Character scalar patches reject child collections, while 9-4d owns
  character asset-reference fields and Fastify-mode `saveAsset` returns
  raw server asset ids.
- Chat metadata patches reject `message`, `localLore`, `scriptstate`,
  generation/runtime fields, and child collections except the 9-4c
  `modules` field. Use message, generation, scriptstate, lorebook, or
  module commands for those fields.
- Message commands reject `generationInfo`; durable generation metadata
  belongs on the 9-3d generation persistence command. Message rows keep
  `message.chatId` as the public message id after 9-3c normalization.
- 9-4a/9-4b whole-collection bridges cover bound lorebook and
  script/trigger UI surfaces. 9-4c covers module records and
  active-module toggles. 9-4e/9-4f cover plugin records, provider
  selection, plugin storage, and unknown plugin DB keys. 9-5d-iv added
  `moduleIntergration` settings coverage and plugin V3 theme-command
  dispatch.
- MCP module import, MCP asset import, and server-backed `.risum` module
  import remain explicitly unsupported until later slices define
  dedicated server-owned paths.
- Several direct-write search hits are expected rollback helpers,
  optimistic command updates, projection replacement writes, or
  runtime-only state. 9-5e-iii should distinguish those classes instead of
  mechanically deleting every local assignment.

## Later Queue

1. 9-5e-iii - Guard audit closeout.
2. 9-6a - Server-backed persistence gate.
3. 9-6b - Asset byte gate.
4. 9-6c - Server backup/restore projection.
5. 9-6d - Residual local cache classification.
6. 9-6e - Provider secret masking.
7. 9-7a - `.risu` fixture corpus and codec harness.
8. 9-7b - Legacy envelope codec port.
9. 9-7c - RISUSAVE block codec port.
10. 9-7d - Decode normalization and validation.
11. 9-7e - Repository-backed export adapter.
12. 9-8a - Multipart `.risu` import route.
13. 9-8b - Repository `.risu` export route.
14. 9-8c - Asset reference walker.
15. 9-8d - Bundle export route.
16. 9-9a - Server-backed browser smoke harness.
17. 9-9b - Generation and memory fixture closeout.
18. 9-9c - Server-backed storage-write audit.
19. 9-9d - Manual Fastify web and Tauri local verification.
20. 9-9e - Phase 9 docs closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused residual-sweep tests while building each 9-5d sub-slice. Run
the full matrix before closing the parent 9-5d sweep:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after the 9-5d first pass:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 709 tests passed, 4 skipped.
- `pnpm api:test` - 1119 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

Focused 9-5 runs:

- 9-5a: `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts`
  - 4 tests passed.
- 9-5b: `pnpm exec vitest run src/ts/server/bootstrap.test.ts src/ts/bootstrap.test.ts`
  - 5 tests passed.
- 9-5c: `pnpm exec vitest run src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts`
  - 11 tests passed.
- 9-5d first pass: `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts`; `pnpm check`
  - 8 tests passed; check clean.
- 9-5d second pass: `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts src/ts/process/modules.test.ts`; `pnpm check`
  - 9 tests passed; check clean.
- 9-5d-i: `pnpm exec vitest run src/ts/server/commands.test.ts`; `pnpm check`
  - 35 tests passed; check clean.
- 9-5d-ii: `pnpm exec vitest run src/ts/server/commands.test.ts`;
  `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts`;
  `pnpm check`
  - 35 tests passed; 65 Fastify command tests passed; check clean.
- 9-5d-iii: `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts`;
  `pnpm check`
  - 9 tests passed; check clean.
- 9-5d-iv: `pnpm exec vitest run src/ts/plugins/plugins.test.ts src/ts/server/commands.test.ts`;
  `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts`;
  `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts src/ts/process/modules.test.ts`;
  `pnpm check`
  - 39 browser command/plugin tests passed; 65 Fastify command tests
    passed; 10 compatibility/module tests passed; check clean.
- 9-5d-v: `pnpm exec vitest run src/ts/process/__tests__/sendChatContext.test.ts src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/mcp/mcp.test.ts`;
  `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts src/ts/server/commands.test.ts`;
  `pnpm check`
  - 30 process/runtime tests passed; 44 compatibility/command tests
    passed; check clean.
- 9-5e-i: `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts`;
  `pnpm check`
  - 9 bootstrap/projection tests passed; check clean.
- 9-5e sub-slices: run the nearest focused guard/projection tests touched
  by the sub-slice, then `pnpm check` before marking that sub-slice done.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-5e-i.md`](../phases-completed/phase-9-client-thinning-9-5e-i.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
