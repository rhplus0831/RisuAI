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

9-5e-iii then closed the guard audit:

- The server-backed sendChat fixture path now enables the Fastify
  projection write guard during both `/completion` and `/chat` dispatch
  execution.
- Entry-context optimistic `lastInteraction` and message-id backfill writes
  run inside trusted scopes while dispatching existing character/message
  commands where ids exist.
- Server `/chat` message-patch replay, terminal restoration, response
  streaming/non-streaming display updates, output-trigger replay, stage-4
  generation metadata, and `lastMemory` updates no longer trip the guard.
- No new command endpoints were added; no storage/provider gating,
  server-side `.risu` import/export, asset-byte work, or surgical event
  patching was folded into the guard audit.

9-6a then added the server-backed persistence gate:

- Fastify-served startup now skips local cold-storage maintenance and the
  browser save loop after loading the server bootstrap projection.
- `saveDb()`, `getDbBackups()`, and `makeColdData()` now return before
  entering AutoStorage, OPFS, NodeStorage, or localForage in Fastify mode.
- Tauri/local startup, save, and backup maintenance paths remain
  unchanged.
- Focused bootstrap coverage proves Fastify-served startup does not
  initialize localForage or start local persistence maintenance.

9-6b then added the asset byte gate:

- Fastify-mode `loadAsset()` now reads raw server asset ids and legacy
  `assets/<sha>.<ext>` references through `/api/v1/assets/:id` instead of
  falling through to local web storage.
- `readImage()` and `loadAsset()` share the same server asset-byte reader,
  with `risu-auth` attached to server asset fetches.
- Local web and Tauri asset-byte behavior remains unchanged.
- Focused browser helper and Fastify asset route coverage stayed green in
  `src/ts/server/assets.test.ts`, `src/ts/bootstrap.test.ts`, and
  `server/fastify/__tests__/assets.test.ts`.

9-6c then added the server backup/restore projection gate:

- Fastify `/api/v1/backups/:id/restore` now emits `state.restored` through
  the existing command-event stream after bumping the repository revision.
- Browser backup helpers live in `src/ts/server/backups.ts` and attach
  `risu-auth` for create/list/restore/delete calls against `/api/v1/backups`.
- Server-backed `SaveLocalBackup()` creates a server backup; internal backup
  restore lists and restores server backups; local file restore and partial
  local backup return explicit unsupported behavior before local storage
  access.
- Focused coverage landed in `src/ts/server/backups.test.ts`,
  `src/ts/storage/backup.test.ts`, and
  `server/fastify/__tests__/backups.test.ts`.

9-6d then classified residual local cache/storage helpers:

- Fastify-mode RISUSAVE block encode/decode no longer reads or writes the
  browser `risuSaveCache` localForage cache, and remote/cache-only blocks now
  report unavailable behavior instead of falling through to local storage.
- Cold-storage helpers now return before OPFS, localForage-backed NodeStorage,
  or Tauri-local paths in server-backed web mode; cold-storage chat hydration
  is explicitly unsupported.
- Google Search MCP credential localForage storage is explicitly unsupported in
  server-backed web mode. Runtime-local caches such as MCP tool-call display
  state, translation/model caches, embedding caches, inlay assets, and plugin
  permission prompts remain browser-local because they are not authoritative
  server database state.
- Focused coverage landed in `src/ts/storage/risuSave.test.ts`,
  `src/ts/process/coldstorage.test.ts`, and
  `src/ts/process/mcp/googlesearchclient.test.ts`.

9-6e then added provider secret masking:

- Fastify bootstrap now masks provider/media/memory secret fields before
  serving the browser projection, without changing persisted `db.json`.
- Settings commands now resolve the shared masked-secret placeholder as
  "leave unchanged" while explicit new secret values replace the stored
  server secret.
- Focused coverage landed in `server/fastify/__tests__/bootstrap.test.ts`
  and `server/fastify/__tests__/commands.test.ts`.

9-7a then added the `.risu` fixture corpus and codec harness:

- `server/fastify/src/risuSave/fixtureHarness.ts` now owns pure server-safe
  fixture helpers for legacy raw/compressed/stream envelope construction,
  envelope classification, and RISUSAVE block fixture inspection.
- `server/fastify/__fixtures__/risuSave/fixtures.ts` covers legacy envelopes,
  RISUSAVE block saves, malformed inputs, explicit remote block references, and
  cache-only directory references.
- Focused coverage landed in `server/fastify/__tests__/risuSaveCodec.test.ts`
  and proves the harness avoids browser storage, Tauri, and Svelte database
  imports.

9-7b then ported the legacy envelope codec:

- `server/fastify/src/risuSave/legacyEnvelopeCodec.ts` now owns the production
  server-safe legacy `.risu` envelope API for raw msgpack, fflate-compressed
  msgpack, and gzip stream-compressed msgpack saves.
- `server/fastify/src/risuSave/fixtureHarness.ts` now delegates legacy fixture
  envelope work to the production codec while keeping RISUSAVE block inspection
  fixture-only.
- Focused coverage in `server/fastify/__tests__/risuSaveCodec.test.ts` now
  proves legacy fixture parity, encode/decode round-trips, non-legacy rejection,
  and browser-storage/Tauri/Svelte/global compression-stream detachment.

## Immediate Pickup

Immediate pickup: **9-7c - RISUSAVE block codec port**.

- Turn the 9-7a RISUSAVE block fixture inspector into the real server-side
  block codec API for root, character, preset, module, loadout, plugin,
  plugin-storage, config, and root-component blocks.
- Keep the API server-safe: no `localforage`, Tauri APIs, Svelte database
  state, browser globals, import/export routes, or repository writes.
- Use the existing fixture corpus in
  `server/fastify/__fixtures__/risuSave/fixtures.ts` as the parity target.
- Reject or report remote/cache-only block references instead of falling
  through to browser local cache or Tauri paths.
- Leave decode normalization, validation, and current Phase 9 import snapshot
  conversion to 9-7d.
- Keep provider dispatch flattening, plugin server execution, asset bundle
  walking, and multipart import/export routes out of this slice.
- Treat decoded shapes as current Phase 9 schema targets; there are no actual
  Fastify users yet, so do not add compatibility migrations for intermediate
  Fastify shapes.

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
- Tauri keeps its local storage path. All Phase 9 gates should be
  server-backed web specific.
- 9-6b closed the shared asset-byte helper gap: Fastify `loadAsset()` and
  `readImage()` now resolve server asset ids through `/api/v1/assets/:id`.
- 9-6c closed the backup/restore projection gap: Fastify backup UI/helper
  paths use `/api/v1/backups`, restore emits `state.restored`, and the
  browser's existing SSE invalidation path re-fetches bootstrap.
- 9-6d closed the residual local cache/storage gate for RISUSAVE caches/
  remotes, cold-storage helpers, and Google Search MCP credential storage.
  Runtime-only local caches remain browser-local and are not server database
  authority.
- 9-6e closed provider secret masking. Use
  `MASKED_PROVIDER_SECRET` / `maskProviderSecrets()` /
  `resolveMaskedProviderSecretPlaceholders()` from
  `server/fastify/src/providerSecrets.ts` if later server routes need the same
  projection or placeholder semantics.
- 9-7a added the fixture harness and corpus. 9-7b added
  `server/fastify/src/risuSave/legacyEnvelopeCodec.ts` for the production
  legacy envelope API. 9-7c should keep that API intact and move only RISUSAVE
  block handling from fixture inspector behavior to production codec behavior.
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
  optimistic command updates, projection replacement writes, or runtime-only
  state. 9-7b should focus on the pure legacy envelope codec instead of
  reopening storage/provider masking gates.

## Later Queue

1. 9-7c - RISUSAVE block codec port.
2. 9-7d - Decode normalization and validation.
3. 9-7e - Repository-backed export adapter.
4. 9-8a - Multipart `.risu` import route.
5. 9-8b - Repository `.risu` export route.
6. 9-8c - Asset reference walker.
7. 9-8d - Bundle export route.
8. 9-9a - Server-backed browser smoke harness.
9. 9-9b - Generation and memory fixture closeout.
10. 9-9c - Server-backed storage-write audit.
11. 9-9d - Manual Fastify web and Tauri local verification.
12. 9-9e - Phase 9 docs closeout.

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
- 9-5e-ii: `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts src/ts/process/modules.test.ts`;
  `pnpm check`
  - 51 guard/command/compatibility tests passed; check clean.
- 9-5e-iii: `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChatContext.test.ts`;
  `pnpm check`
  - 49 guarded fixture/bootstrap/context tests passed; check clean.
- 9-6d: `pnpm test src/ts/storage/risuSave.test.ts src/ts/process/coldstorage.test.ts src/ts/process/mcp/googlesearchclient.test.ts`;
  `pnpm check`
  - 4 residual local cache/storage gate tests passed; check clean.
- 9-6e: `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/commands.test.ts`;
  `pnpm check`
  - 72 Fastify bootstrap/command tests passed; check clean.
- 9-7a: `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveCodec.test.ts`;
  `pnpm check`
  - 7 Fastify `.risu` fixture harness tests passed; check clean.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-7a.md`](../phases-completed/phase-9-client-thinning-9-7a.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
