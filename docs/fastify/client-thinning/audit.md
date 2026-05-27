# Open-Findings Audit

Date: 2026-05-28

This audit records documentation-direction variables found by focused
sub-agent review of each item in [`open-findings.md`](./open-findings.md). It
does not close any exit criterion by itself; it flags places where the open
finding text should be narrowed, broadened, or corrected before implementation
work is planned.

## Summary

| Finding | Audit status | Documentation-direction variable |
|---------|--------------|----------------------------------|
| F1 / EC1 | Still open, with wording corrections. | Server-side Vertex support and token exchange already exist; the failure is that masked bootstrap plus opt-in server generation still leaves browser provider fallback reachable. |
| F2 / EC2 | Partially stale, still open. | Browser-local plugin storage remains exposed, but `pluginStorage`/unknown-key command backing and some reserved-key write blocking already exist. |
| F3 / EC3 | Still open, with wording nuance. | JSON import persists a route-normalized inbound payload, not a completely untouched one; the broader `.risu` normalizer is already exported and can be shared. |
| F4 / EC4 | Partially stale, still open. | Lorebook and script/trigger replacement still repair ids, but message duplicate rejection and prompt-item CRUD/reorder already exist. |
| F5 / EC5 | Still open, missing scope. | Conflict hiding is not limited to `runServerCommand`; `patchServerBackedSettings` has its own blind retry path. |
| F6 / EC6 | Still open, missing scope. | Character create and patch share the missing audio asset validation; `ref_audio_path` is not the server asset field. |

Overall direction is unchanged: every EC1-EC6 item remains open. The docs should
avoid implying that already-landed command paths do not exist, and should make
the remaining failure modes more precise.

## F1 / EC1 - Provider Ownership

Status: still open.

The core claim remains accurate: Fastify bootstrap serves a masked projection
while client-side provider dispatch is still reachable when
`useServerGeneration` is missing or `false`.

Evidence and variables:

- `src/ts/storage/database.svelte.ts:773` still defaults
  `useServerGeneration` to `false`.
- `src/ts/process/request/serverCompletion.ts:528` is now the function entry;
  the actual opt-in null gate is around `:531`.
- `src/ts/process/request/request.ts:525` still falls through to direct browser
  provider dispatch when `getServerCompletionProvider(...)` returns `null`.
- `server/fastify/src/routes/bootstrap.ts:24` returns the masked projection.
  `server/fastify/src/providerSecrets.ts:22` and `:42` mask provider secrets
  used by browser dispatch, including Google access tokens, OpenAI keys, custom
  model keys, `vertexAccessToken`, and `vertexPrivateKey`.
- `src/ts/process/request/google.ts:553` still refreshes Vertex tokens by
  mutating the local projection through `withTrustedServerProjectionWrite`, with
  no server command/import persistence path.

Nuance to capture:

- Do not imply Vertex has no server path. Server-side Vertex routing and bearer
  exchange/cache exist in `src/ts/process/request/serverCompletion.ts` and
  `server/fastify/src/generation/vertexAuth.ts`; the remaining problem is that
  browser-side Vertex refresh remains reachable through fallback.
- The masked Vertex wording should be precise: `vertexPrivateKey` and
  `vertexAccessToken` are masked, while fields such as `vertexClientEmail`,
  `vertexRegion`, and `google.projectId` are not.
- Placeholder preservation for normal settings patches exists, so F1 is not
  about normal settings writes overwriting persisted provider secrets. It is
  about generation ownership and local token refresh writes in server-backed
  mode.

## F2 / EC2 - Plugin Durable Storage

Status: partially stale, still open.

The main storage exposure remains accurate: Fastify-mode plugin APIs still
expose browser-local durable storage outside `/api/v1/commands/plugin-storage`.

Evidence and variables:

- `src/ts/plugins/pluginSafeClass.ts:9` exposes `SafeLocalStorage`, which writes
  `localStorage` under `safe_plugin_*`.
- `src/ts/plugins/pluginSafeClass.ts:48` exposes `SafeLocalPluginStorage`,
  which writes localForage.
- `src/ts/plugins/pluginSafeClass.ts:76` exposes `SafeIdbFactory`, which opens
  and deletes prefixed IndexedDB databases.
- `src/ts/plugins/plugins.svelte.ts:961` and `:962` expose sandbox
  `localStorage` and `indexedDB`; `:985` still constructs `SafeLocalStorage`
  without a Fastify gate.
- `src/ts/plugins/apiV3/v3.svelte.ts:1238` can report
  `platform: "fastify"`, but `:1242` still reports `saveMethod: "local"` and
  `:1245` returns `SafeLocalPluginStorage`.

Nuance to capture:

- `pluginStorage` and unknown-key bridge persistence are now server-backed in
  several paths. `src/ts/plugins/plugins.svelte.ts:621-648` dispatches direct
  V2 plugin-storage put/delete/bulk operations, and `:706`/`:716` route
  unknown DB keys through plugin-storage bulk commands. Fastify routes exist
  around `server/fastify/src/routes/commands.ts:3804`, `:3838`, and `:3871`,
  with coverage around `server/fastify/__tests__/commands.test.ts:4622`.
- Reserved DB-family write shadowing through `setDatabaseLite` is partly fixed:
  `src/ts/plugins/plugins.svelte.ts:591` and `:680` block
  `unsupportedServerBridgeKeys` in server mode, with tests in
  `src/ts/plugins/plugins.test.ts:274` and `:292`.
- `pluginV2` is still a real gap. It remains in `allowedDbKeys` around
  `src/ts/plugins/plugins.svelte.ts:548`, but it has no durable settings-group
  command path. Writes can update the projection and then be dropped by the
  settings patch path.
- Read-time shadowing remains possible through the V2 `getDatabase` fallback at
  `src/ts/plugins/plugins.svelte.ts:1002` when server/plugin-storage state
  contains names that overlap omitted reserved DB-family fields.

Doc adjustment:

- Keep the browser-local API exposure, `saveMethod`, `pluginV2`, and read-time
  shadowing bullets open.
- Avoid saying that `pluginCustomStorage` has no command surface at all, or that
  all write-time reserved-key shadowing is still unfixed.

## F3 / EC3 - JSON Import Normalization

Status: still open.

The core claim remains accurate: JSON `{ database }` import does not share the
broader `.risu` current-shape normalizer, and bootstrap does not repair shape
before serving persisted state.

Evidence and variables:

- `server/fastify/src/routes/save.ts:68-70` accepts `body.database`, runs only
  the route-local JSON import normalizer, and applies that database.
- `server/fastify/src/routes/save.ts:185-215` normalizes presets, translator
  presets, loadouts, prompt templates, and script definitions only.
- `server/fastify/src/risuSave/importSnapshot.ts:83` already exports
  `normalizeRisuSaveImportDatabase`; the broader normalizer handles messages,
  personas, modules, plugins, plugin storage, global/child lorebooks, and
  scripts around `:155`.
- `server/fastify/src/repository.ts:107-117` persists any non-null/undefined
  database payload.
- `server/fastify/src/routes/bootstrap.ts:20-24` loads persisted data and masks
  provider secrets, but does not run current-shape normalization.

Nuance to capture:

- Replace "persists as-is" with "persists the route-normalized inbound payload."
  The JSON path does mutate selected collections, just not the full current
  shape covered by `.risu` import.
- Replace "bootstrap serves unchanged" with "bootstrap serves without shape
  repair"; provider secrets are still masked.
- A lower-risk implementation direction exists: call the already-exported
  `normalizeRisuSaveImportDatabase` from the JSON path before
  `applyImportedDatabase`, or restrict JSON whole-DB import to test tooling.
- The JSON route also allows broad non-object/non-current payloads unless a
  narrow route-local normalizer happens to throw.

## F4 / EC4 - Stable Ids And Prompt Semantics

Status: partially stale, still open.

Public replacement paths still repair durable child ids in several resource
families, but some parts of the original wording are now too broad.

Evidence and variables:

- Lorebook entry replacement still repairs ids. `readLorebookEntries(...)`
  delegates to `ensureLorebookEntries(...)`; missing ids are generated and
  duplicate ids replaced around `server/fastify/src/commands/lorebooks.ts:218`,
  `:226`, and `:280`. Public routes use those validators around
  `server/fastify/src/routes/commands.ts:3272`, `:3309`, `:3343`, and `:3916`.
- Script and trigger replacement still repairs ids. `readScriptDefinitions` and
  `readTriggerDefinitions` call `ensureDefinitionRecords`, which generates
  missing ids and replaces duplicates around
  `server/fastify/src/commands/scriptDefinitions.ts:97`, `:104`, and `:127`.
  Public routes use those validators around
  `server/fastify/src/routes/commands.ts:3950`, `:3984`, `:4018`, and `:4052`.
- Message `chatId` repair is narrower than written. `createMessageRecord` still
  generates missing `chatId` values around
  `server/fastify/src/commands/messages.ts:68`, and `ensureChatMessages`
  repairs existing malformed DB state around `:50`; however replacement payload
  duplicate ids are now rejected by `validateUniqueMessageIds` around `:97` and
  `:158`, with coverage around
  `server/fastify/__tests__/commands.test.ts:3134`.
- `promptTemplate` is still accepted as a raw `array|null` through the dedicated
  prompt-settings command: `server/fastify/src/commands/prompts.ts:11` and
  `:177`, applied around `server/fastify/src/routes/commands.ts:1328` and
  `:1341`, with a `prompt.settings.updated` event in
  `server/fastify/src/commands/events.ts:53`.

Nuance to capture:

- Prompt-item CRUD/reorder now exists and emits resource-specific events around
  `server/fastify/src/routes/commands.ts:1357`, `:1393`, `:1432`, and `:1466`,
  with tests around `server/fastify/__tests__/commands.test.ts:1322`.
- The prompt bypass is not the generic `/commands/settings/:group` route.
  Generic settings reject the `prompt` group; the bypass is specifically
  `/commands/prompt-settings`.
- The UI mostly uses prompt-item commands for item create/update/delete/reorder.
  The known raw `promptTemplate` client use is the enable toggle patching
  `{ promptTemplate: [] }` around
  `src/lib/Setting/Pages/BotSettings.svelte:1455`.

Doc adjustment:

- Keep F4 open for lorebook entries, script/trigger definitions, missing
  message ids, and raw prompt-template replacement.
- Narrow the message duplicate wording and acknowledge the prompt-item command
  surface already exists. Remaining work is to remove/restrict raw
  `promptTemplate` from prompt-settings, or document and validate a narrow
  enable/disable semantic.

## F5 / EC5 - Conflict Visibility

Status: still open, and the scope should be broadened.

The core claim remains accurate for high-level browser wrappers: a first 409
can be hidden by retrying the same stale payload with the newer revision.

Evidence and variables:

- `src/ts/server/commands.ts:2145` still reads a base revision,
  `:2151` sends the command, and `:2152` retries the same `input.command` with
  `result.currentRevision` after a conflict.
- The lower-level request handler does surface conflicts as
  `{ status: "conflict", currentRevision }` around
  `src/ts/server/commands.ts:2204`; direct-helper coverage exists around
  `src/ts/server/commands.test.ts:313`.
- The server side correctly rejects stale revisions before mutation around
  `server/fastify/src/commands/mutations.ts:50`, maps them to 409 around
  `server/fastify/src/routes/commands.ts:4194`, and has coverage around
  `server/fastify/__tests__/commands.test.ts:190`.
- Browser tests still encode replay behavior for several families, including
  settings around `src/ts/server/commands.test.ts:486`, presets around `:646`,
  and prompts around `:821`.

Nuance to capture:

- Broaden F5 beyond `runServerCommand`. `patchServerBackedSettings` has its own
  blind retry around `src/ts/server/commands.ts:1038`, replaying the same patch
  with `result.currentRevision`.
- The retry is one-shot. A second 409 can still be returned and may trigger
  rollback, but the first conflict is already hidden and can convert a stale
  payload into last-writer-wins.
- The issue is specifically in higher-level browser wrappers. Direct typed
  command helpers can return visible conflicts.
- Callers are widespread: settings bridge calls `patchServerBackedSettings`
  around `src/ts/server/settingsBridge.svelte.ts:114`, presets use
  `runServerPresetCommand` around `src/ts/storage/database.svelte.ts:99`, and
  plugin/module/chat wrappers delegate to `runServerCommand` around
  `src/ts/pluginCommands.ts:59`, `src/ts/moduleCommands.ts:50`, and
  `src/ts/chatCommands.ts:85`.

## F6 / EC6 - Character Audio Asset Validation

Status: still open.

The core claim remains accurate: the asset-reference walker treats character
audio fields as server asset references, but character create/patch validation
does not validate those fields.

Evidence and variables:

- `server/fastify/src/risuSave/assetReferences.ts:85` walks character asset
  references; `:93` includes `vits.files`, and `:95` includes the GPT-SoVITS
  reference-audio asset. Helper logic adds dynamic `vits.files.*` refs around
  `:122` and the GPT-SoVITS ref audio asset around `:135`.
- `server/fastify/src/commands/characters.ts:371` validates image,
  `emotionImages`, `additionalAssets`, `ccAssets`, and `prebuiltAssetExclude`,
  but not `vits` or `gptSoVitsConfig`.
- Both create and patch are affected. `server/fastify/src/routes/commands.ts:2144`
  validates create through `createCharacterRecord(... assetDataDir ...)`, and
  `:2182` validates patch through `readCharacterPatch(... assetDataDir ...)`.
- Existing command tests cover currently validated character asset fields around
  `server/fastify/__tests__/commands.test.ts:4777`, but not `vits.files` or
  `gptSoVitsConfig.ref_audio_data.assetId`.

Nuance to capture:

- `gptSoVitsConfig.ref_audio_path` is not the server asset reference. The field
  to validate is `gptSoVitsConfig.ref_audio_data.assetId`.
- UI code writes the server asset field from `saveAsset(audio.data)` around
  `src/lib/SideBars/CharConfig.svelte:1372`.
- `vits.files` is a dynamic object map. Validation should iterate values and
  report paths such as `character.vits.files.<key>` or
  `patch.vits.files.<key>`.
- Asset ids are SHA-256 hex strings per
  `server/fastify/src/repository.ts:29`; syntactically valid but missing ids
  should still be rejected by `assetById`.
- The open finding's route note should mention create as well as patch.

