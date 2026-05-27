# Phase 9 Rework Findings

Date: 2026-05-28

Status: reopened by follow-up audit (2026-05-28). The original four blockers
and five additional findings were fixed, but a deeper pass found remaining
server-backed-mode gaps that still violate the Phase 9 completion contract.
Do not mark Phase 9 complete until the follow-up audit findings below are
closed with regression coverage.

## Goal

Make Fastify-served web mode a true server projection:

- Bootstrap must not leak provider, media, memory, or account secrets.
- Durable browser mutations must persist through command/import routes.
- Direct projection writes must either be impossible or intentionally wrapped
  and followed by a command/import path.
- Malformed import inputs must fail as validation errors, not internal errors.

## Original Rework Blockers (Resolved)

### 1. Bootstrap leaks nested provider secrets

`/api/v1/bootstrap` masks only the paths handled by
`server/fastify/src/providerSecrets.ts`, then returns that projection from
`server/fastify/src/routes/bootstrap.ts`.

Confirmed leak:

- top-level `openAIKey` is masked.
- `botPresets[0].openAIKey` is returned in cleartext.
- `botPresets[0].proxyKey` is returned in cleartext.
- `characters[0].oaiTTSConfig.apiKey` is returned in cleartext.

Evidence:

- `server/fastify/src/routes/bootstrap.ts:24`
- `server/fastify/src/providerSecrets.ts:7`
- `server/fastify/src/commands/presets.ts:11`
- `server/fastify/src/commands/presets.ts:203`
- `src/ts/storage/database.svelte.ts:1558`

Suggested fix:

- Extend masking and placeholder resolution to nested preset snapshots and
  character-owned TTS/provider fields.
- Add Fastify bootstrap tests that import a DB with nested secrets and assert
  masked output for every supported secret-bearing location.

**Resolved:** `providerSecrets.ts` now masks `botPresets[*].openAIKey`,
`botPresets[*].proxyKey`, and `characters[*].oaiTTSConfig.apiKey` (the
existing recursion handles resolution too). `bootstrap.test.ts` asserts the
masked nested output.

### 2. Character-module add/remove cannot persist

The client toggles `character.modules` and dispatches the character-module
reorder command, but the server route only accepts a full reorder of modules
already linked to the character. Adding a module returns `400`.

Confirmed repro:

- Import a DB with `characters[0].modules = []` and `modules = [{ id: "mod-a" }]`.
- POST `/api/v1/commands/characters/char-a/modules/reorder` with
  `{ baseRevision: 1, moduleIds: ["mod-a"] }`.
- Response: `400 { "error": "Module id is not linked to character: mod-a" }`.

Evidence:

- `src/ts/moduleCommands.ts:217`
- `src/ts/moduleCommands.ts:231`
- `server/fastify/src/routes/commands.ts:3554`
- `server/fastify/src/commands/modules.ts:143`
- `server/fastify/__tests__/commands.test.ts:4188` only covers pure reorder.

Suggested fix:

- Add a command that replaces/toggles character module links, or relax the
  existing route to validate against known modules rather than existing links.
- Add server tests for add and remove, not only reorder.
- Add a client integration/helper test that exercises `toggleSelectedCharacterModule`.

**Resolved:** the character module reorder command now treats its `moduleIds`
as the full replacement set of links, validated against known modules rather
than existing links (`validateCharacterModuleLinks`), so add/remove/reorder
all work. `commands.test.ts` covers add and remove; the existing
`moduleCommands.test.ts` already exercises the add path via
`toggleSelectedCharacterModule`.

### 3. Stale read-only aliases break trusted projection writes

`withTrustedServerProjectionWrite()` swaps `DBState.db` to a mutable clone for
the callback. Aliases captured before the callback still point at the read-only
proxy and can throw before commands are queued.

Known stale-alias paths:

- Settings draft helper:
  - `src/ts/server/settingsBridge.svelte.ts:77`
  - `src/ts/server/settingsBridge.svelte.ts:81`
- Prompt settings drafts:
  - `src/lib/Setting/Pages/PromptSettings.svelte:329`
  - `src/lib/Setting/Pages/PromptSettings.svelte:333`
- Bot prompt-field drafts:
  - `src/lib/Setting/Pages/BotSettings.svelte:381`
  - `src/lib/Setting/Pages/BotSettings.svelte:385`
- Lorebook global add/folder/import:
  - `src/ts/process/lorebook.svelte.ts:46`
  - `src/ts/process/lorebook.svelte.ts:51`
  - `src/ts/process/lorebook.svelte.ts:108`
  - `src/ts/process/lorebook.svelte.ts:113`
  - `src/ts/process/lorebook.svelte.ts:759`
  - `src/ts/process/lorebook.svelte.ts:776`

Suggested fix:

- Re-read `DBState.db` inside every trusted callback.
- Avoid mutating arrays/objects captured from the read-only projection.
- Add guard-enabled regression tests for settings drafts, prompt drafts, and
  global lorebook add/import.

**Resolved:** the settings draft, prompt-settings draft, and bot prompt-field
draft helpers now re-read `DBState.db` inside the trusted callback. The global
lorebook add/folder/import paths build the next entry array from a mutable
snapshot and assign it (instead of pushing into the projection-owned array),
and `ensureClientLorebookEntryIds` only writes when an id is actually missing
(an unconditional assignment previously tripped the read-only set trap).
`lorebook.projectionGuard.test.ts` adds guard-enabled coverage for global
add, folder, and `sglobal` import.

### 4. Plugin database bridge does not match the command map

The Phase 9 command map says plugin `setDatabase` / `setDatabaseLite` should
diff recognized DB keys into typed commands and route only unknown keys to
`pluginCustomStorage`. Current `allowedDbKeys` omits many documented recognized
keys, so they become plugin storage instead of real resources. Some included
resource keys are trusted local writes but do not dispatch resource commands.

Examples of omitted documented keys:

- `botPresets`, `botPresetsId`
- `promptTemplate`, `promptSettings`
- `translatorPresets`, `translatorPresetId`
- `loadouts`, `lastLoadedLoadoutName`
- `loreBook`, `loreBookPage`
- `userIcon`, `personaPrompt`, `userNote`

Evidence:

- `docs/fastify/phases-completed/phase-9-command-map.md:197`
- `docs/fastify/phases-completed/phase-9-command-map.md:212`
- `src/ts/plugins/plugins.svelte.ts:548`
- `src/ts/plugins/plugins.svelte.ts:647`
- `src/ts/plugins/plugins.svelte.ts:668`
- `src/ts/pluginCommands.ts:212`

Suggested fix:

- Either implement the documented bridge for every listed resource family, or
  revise the contract and block unsupported keys explicitly in Fastify mode.
- Ensure mixed plugin DB changes execute in a deterministic command sequence or
  via a composite server command.
- Add tests for every documented plugin DB bridge key family.

**Resolved:** chose to revise the contract. In server-backed mode, recognized
resource families with no bridge command (`unsupportedServerBridgeKeys`:
characters/characterOrder, persona fields, botPresets, prompt template/
settings, translator presets, loadouts, loreBook/loreBookPage) are now blocked
with a `console.warn` instead of producing a dangling projection write or
shadowing the real resource in `pluginCustomStorage`. Local mode is unchanged;
truly unknown keys still route to plugin storage. Documented in
`phase-9-command-map.md`; tested in `plugins.test.ts` (blocked allowedDbKeys
family, blocked omitted key, local-mode passthrough).

## Original Additional Findings (Resolved)

### Welcome setup persists only part of what it mutates

`WelcomeRisu.svelte` applies a full preset to the local projection, then only
persists a smaller settings patch. Fields changed by `setPreset()` can be lost
after projection refresh/reload.

Evidence:

- `src/lib/Others/WelcomeRisu.svelte:115`
- `src/lib/Others/WelcomeRisu.svelte:200`
- `src/ts/storage/database.svelte.ts:2385`
- `src/ts/storage/database.svelte.ts:2416`
- `src/ts/storage/database.svelte.ts:2428`

**Resolved:** `WelcomeRisu.svelte` snapshots the projection before setup,
diffs it after applying preset + patch, and persists every changed key through
`applyServerBackedSettingsPatch` (which keeps only command-backed settings
keys), so preset-derived settings survive a projection refresh.

### `verbosity` is server-allowed but not client command-backed

The model parameter metadata exposes `verbosity`, and the Fastify settings
route allowlists it, but the client settings command group map omits it. As a
result, changing the UI control in server mode does not build a settings patch.

Evidence:

- `src/ts/setting/botSettingsParamsData.ts:294`
- `src/ts/setting/botSettingsParamsData.ts:297`
- `server/fastify/src/routes/commands.ts:425`
- `src/ts/server/commands.ts:237`
- `src/ts/server/commands.ts:945`
- `src/ts/setting/utils.ts:95`
- `src/ts/setting/utils.ts:106`

**Resolved:** `verbosity` is mapped to the `runtime` settings group in the
client `SERVER_SETTINGS_GROUP_BY_KEY` map (matching the server allowlist), so
the UI control now builds a settings patch in server mode. Asserted in
`commands.test.ts`.

### DevTool autopilot directly mutates message history

The DevTool is reachable when `enableDevTools` is true. Its autopilot loop
captures `DBState.db`, pushes user messages, writes the character back, then
calls `sendChat` without a command-backed pre-mutation.

Evidence:

- `src/lib/SideBars/Sidebar.svelte:989`
- `src/lib/SideBars/DevTool.svelte:241`
- `src/lib/SideBars/DevTool.svelte:244`
- `src/lib/SideBars/DevTool.svelte:254`

**Resolved:** the autopilot loop now applies the optimistic user message inside
`withTrustedServerProjectionWrite` (via `getDatabase`/`setDatabase`) and lets
`sendChat` drive command-backed persistence, matching the `/send` slash
command.

### Malformed RISUSAVE block uploads can return 500

The import route maps `ValidationError` to 400, but the RISUSAVE block decoder
throws plain `Error` for malformed block structures.

Confirmed repro:

- Multipart upload bytes equivalent to `RISUSAVE\0x`.
- Response: `500 { "message": "Malformed RISUSAVE block header at offset 9" }`.

Evidence:

- `server/fastify/src/routes/save.ts:74`
- `server/fastify/src/risuSave/blockCodec.ts:88`
- `server/fastify/src/risuSave/blockCodec.ts:97`
- `server/fastify/src/risuSave/blockCodec.ts:106`
- `server/fastify/src/risuSave/blockCodec.ts:153`
- `docs/fastify/phases-completed/phase-9-client-thinning-9-8a.md:20`

**Resolved:** `decodeRisuSaveImportSnapshot` wraps the raw envelope decoders so
any non-`ValidationError` failure (malformed header/name/data, bad gzip,
unparsable directory JSON) becomes a `ValidationError` (400). The `RISUSAVE\0x`
repro now returns `400 { "error": "Malformed RISUSAVE block header at offset
9" }`; covered in `risuSaveImportRoute.test.ts`.

### Asset upload revision/event mismatch

`POST /api/v1/assets` bumps and returns a repository revision, but the route is
not registered with the command event sink and the browser ignores the returned
revision. The next command may rely on conflict retry from a stale cached
revision.

Evidence:

- `server/fastify/src/routes/assets.ts:45`
- `server/fastify/src/routes/assets.ts:51`
- `server/fastify/src/app.ts:158`
- `src/ts/globalApi.svelte.ts:241`

**Resolved:** the assets route is registered with the command event sink and
emits `asset.created` (with the bumped revision) when a new asset is stored
(idempotent re-uploads emit nothing). The browser advances its cached command
revision from the upload response so the next command does not race on a stale
`baseRevision`. Covered in `assets.test.ts`.

## Follow-Up Audit Findings (Unresolved)

### P1. Fastify can still fall back to browser-side provider generation after secrets are masked

Phase 9 says `/api/v1/bootstrap` should mask provider secrets only after
server-backed provider paths no longer need client-visible keys. That condition
is not actually true yet:

- `src/ts/storage/database.svelte.ts:773` defaults `useServerGeneration` to
  `false`.
- `src/ts/process/request/serverCompletion.ts:528` returns `null` unless
  `db.useServerGeneration === true`.
- `src/ts/process/request/request.ts:525` falls through to direct browser
  provider dispatch when the server provider is `null`.
- `server/fastify/src/routes/bootstrap.ts:24` returns a masked projection, and
  `server/fastify/src/providerSecrets.ts:42` masks Vertex auth fields.
- `src/ts/process/request/google.ts:553` refreshes Vertex access tokens by
  mutating the local projection inside `withTrustedServerProjectionWrite`
  without any command/import persistence path.

Impact:

- A Fastify-served client can reload with masked provider secrets, skip server
  generation because the flag is false, and then attempt direct provider calls
  from the browser with placeholder values.
- The Vertex token refresh path is a direct projection write that does not
  rebuild from bootstrap/events and does not persist through a command.

Suggested fix:

- Decide the Fastify invariant: either force/server-own generation in Fastify
  before masking provider secrets, or stop masking keys while browser direct
  generation remains reachable.
- Remove client-side durable token writes in server-backed mode, or route them
  through a server-owned auth/token path.
- Add regression coverage for a Fastify bootstrap followed by a generation
  request when `useServerGeneration` is missing/false.

### P1. Plugin APIs still expose durable browser storage in Fastify mode

The revised Phase 9 plugin bridge routes durable plugin DB/storage state through
plugin commands and plugin-storage. The sandbox still exposes browser-local
storage APIs in server-backed mode:

- `src/ts/plugins/pluginSafeClass.ts:9` exposes `SafeLocalStorage`, which writes
  directly to `localStorage`.
- `src/ts/plugins/pluginSafeClass.ts:48` exposes `SafeLocalPluginStorage`, which
  writes through localForage.
- `src/ts/plugins/pluginSafeClass.ts:76` exposes `SafeIdbFactory`, which opens
  and deletes prefixed IndexedDB databases.
- `src/ts/plugins/plugins.svelte.ts:961` and `src/ts/plugins/plugins.svelte.ts:985`
  install those APIs into the plugin sandbox.
- `src/ts/plugins/apiV3/v3.svelte.ts:1238` reports `platform: "fastify"` but
  still reports `saveMethod: "local"` and returns `SafeLocalPluginStorage`.

Impact:

- Server-backed mode can still persist plugin-visible durable state in
  browser-local storage outside `/api/v1/commands/plugin-storage`.
- Plugin code can diverge per browser/device even while the main DB projection
  is server-owned.

Suggested fix:

- In Fastify mode, either disable these browser-local plugin storage APIs with a
  clear unsupported error, or back them with the server plugin-storage command
  surface.
- Update plugin runtime info so `saveMethod` reflects the actual Fastify
  behavior.
- Add plugin API tests that assert no localStorage/localForage/IndexedDB write
  path is exposed for server-backed durable plugin storage.

### P1. JSON import can persist non-current-shape DB data that bootstrap later serves unchanged

Phase 9 requires stable ids/current schema for durable row families, and allows
server-side import/bootstrap normalization to generate missing ids. Multipart
`.risu` import does that broadly, but JSON `{ database }` import remains a
whole-database bypass:

- `server/fastify/src/routes/save.ts:68` accepts a JSON body with `database`.
- `server/fastify/src/routes/save.ts:185` normalizes only presets,
  translator presets, loadouts, prompt templates, and script definitions.
- `server/fastify/src/risuSave/importSnapshot.ts:155` shows the broader
  normalization used by multipart `.risu` import, including messages,
  personas, modules, plugins, plugin storage, and lorebooks.
- `server/fastify/src/repository.ts:107` writes any non-null database payload.
- `server/fastify/src/routes/bootstrap.ts:19` later serves persisted data
  without current-shape normalization.

Impact:

- A JSON import can persist malformed characters/chats/messages/personas/
  modules/plugins/lorebooks that public commands cannot safely address by
  stable id.
- The next bootstrap can expose that malformed state to the projection guard,
  making later command behavior depend on bad historical shape.

Suggested fix:

- Route JSON import through the same current-shape normalizer as multipart
  `.risu` import, or remove/restrict the JSON whole-db import to test-only
  tooling.
- Add tests that import missing/duplicate ids through the JSON path and assert
  current-shape bootstrap output.

### P1/P2. Public command paths still bypass stable-id/resource semantics

The command map says child replacement `PUT` requests must include stable child
ids for every retained row, and prompt items should be edited through prompt
item commands/events. Several public routes still repair or bypass that
contract:

- `server/fastify/src/commands/lorebooks.ts:223` generates a new lorebook entry
  id on duplicate input instead of rejecting the malformed replacement.
- `server/fastify/src/commands/scriptDefinitions.ts:127` generates missing or
  duplicate script/trigger definition ids instead of rejecting public command
  input.
- `server/fastify/src/commands/messages.ts:68` generates missing message
  `chatId` values.
- `server/fastify/src/commands/prompts.ts:11` includes `promptTemplate` in
  prompt settings keys.
- `server/fastify/src/commands/prompts.ts:177` accepts `promptTemplate` as a
  raw array/null in settings validation.
- `server/fastify/src/routes/commands.ts:1328` applies that as a
  `prompt.settings.updated` mutation instead of prompt item CRUD/reorder.

Impact:

- Public commands can silently change row identity, which makes client-held ids,
  event semantics, and conflict resolution unreliable.
- Prompt item replacement can bypass prompt item validation and event naming.

Suggested fix:

- Keep id generation in import/bootstrap normalization only.
- Make public replacement commands reject missing/duplicate child ids with 400.
- Remove `promptTemplate` from generic prompt settings patching, or restrict it
  to an explicitly validated prompt-template replacement command with matching
  events.

### P2. The browser command helper hides 409 conflicts by replaying stale payloads

The server contract says stale commands return a 409 revision-conflict response
with `currentRevision`. The browser helper currently turns that into a blind
replay:

- `src/ts/server/commands.ts:2145` reads a base revision.
- `src/ts/server/commands.ts:2151` sends the command.
- `src/ts/server/commands.ts:2152` retries the exact same payload with
  `result.currentRevision` after any conflict.
- `src/ts/server/commands.test.ts` includes tests that now encode the retry
  behavior for several command families.

Impact:

- Replacement and reorder commands can apply stale client intent on top of a
  newer server state without first rebuilding from bootstrap/events.
- A green command test suite can hide lost-update behavior because the helper
  converts conflicts into last-writer-wins retries.

Suggested fix:

- Return conflicts to callers so they can rollback/rebootstrap, or retry only
  commands whose payloads are explicitly commutative/idempotent against the
  current revision.
- Add a regression test with concurrent reorder/replacement edits proving stale
  payloads do not overwrite newer state.

### P2. Asset reference validation is incomplete for character audio refs

Phase 9 says durable asset references are patched through owning resource
commands and those commands validate server asset ids. Character validation does
not cover all references that bundle walking later treats as asset references:

- `server/fastify/src/risuSave/assetReferences.ts:85` walks character asset
  references.
- `server/fastify/src/risuSave/assetReferences.ts:93` includes `vits.files`.
- `server/fastify/src/risuSave/assetReferences.ts:95` includes
  `gptSoVitsConfig` audio references.
- `server/fastify/src/commands/characters.ts:371` validates image,
  emotionImages, additionalAssets, ccAssets, and prebuiltAssetExclude only.
- `server/fastify/src/routes/commands.ts:2175` uses that validator for
  character patches.

Impact:

- A character command can persist missing or malformed audio asset ids that the
  export/bundle path only reports later.

Suggested fix:

- Extend character command validation to every server asset field known to the
  asset-reference walker.
- Add patch/create tests for valid and missing `vits` and `gptSoVitsConfig`
  asset ids.

### Audit notes and exclusions

- Runtime-local caches such as MCP display cache, translation/model caches,
  embedding caches, inlay assets, and plugin permission prompts are explicitly
  allowed by `docs/fastify/phases-completed/phase-9-client-thinning-9-6d.md`.
  They should not be counted as completion failures unless they become
  authoritative DB state.
- The remaining `bind:chara={DBState.db.characters[...]}` sites were checked.
  The inspected chat/toggle mutations are routed through command helpers in
  Fastify mode, so those bindings are not listed as blockers here.

## Verification Notes

Audit commands/results from 2026-05-28:

- `pnpm check`: passed with 0 errors and 0 warnings.
- `pnpm exec vitest run src/ts/process/coldstorage.test.ts src/ts/process/mcp/googlesearchclient.test.ts src/ts/storage/risuSave.test.ts`: passed.
- `pnpm exec vitest run src/ts/plugins/plugins.test.ts src/ts/server/commands.test.ts`: passed.
- `pnpm exec vitest run src/ts/compatibilityAdapters.test.ts src/ts/process/files/tests/inlays.test.ts`: passed.
- Injected Fastify checks confirmed:
  - nested bootstrap secret leak,
  - malformed RISUSAVE block upload returns 500,
  - character-module add returns 400.

Rework ladder results (2026-05-28, after the fixes):

- `pnpm check`: passed with 0 errors and 0 warnings.
- `pnpm test`: 779 passed, 4 skipped.
- `pnpm api:test`: 1221 passed.
- `pnpm build`: built (pre-existing chunk-size / ineffective-dynamic-import
  warnings only).
- `pnpm smoke:fastify-browser`: 1 passed.

Follow-up audit commands/results from 2026-05-28:

- `pnpm check`: passed with 0 errors and 0 warnings.
- `pnpm exec vitest run src/ts/server/commands.test.ts src/ts/plugins/plugins.test.ts src/ts/moduleCommands.test.ts src/ts/compatibilityAdapters.test.ts src/ts/process/__tests__/lorebook.projectionGuard.test.ts src/ts/process/__tests__/command.projectionGuard.test.ts src/ts/process/__tests__/triggers.projectionGuard.test.ts`: 75 tests passed.
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/assets.test.ts`: 1221 tests passed.
- Full `pnpm test`, `pnpm build`, and `pnpm smoke:fastify-browser` were not
  rerun during the follow-up audit.

Historical note:

- `pnpm tauribuild` appears in Phase 9 closeout docs but is no longer an
  available package script after the Fastify-only cleanup. Do not use that
  historical command as a current closeout gate unless the script is restored.

## Suggested Rework Order

1. Close the Fastify provider-generation invariant. Either force/server-own
   generation before masking secrets, or stop masking secrets while browser
   direct generation is still reachable.
2. Disable or server-back plugin-local durable storage APIs in Fastify mode.
3. Normalize or restrict JSON whole-database import so bootstrap always serves
   current-shape data.
4. Tighten public command validation for stable child ids and prompt template
   replacement semantics.
5. Remove blind conflict retries, or constrain them to explicitly safe command
   types.
6. Extend character asset-reference validation to every asset field known to
   the bundle walker.
7. Re-run the full current ladder:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```
