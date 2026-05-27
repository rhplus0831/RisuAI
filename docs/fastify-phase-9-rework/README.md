# Phase 9 Rework Findings

Date: 2026-05-28

Status: resolved (2026-05-28). All four blockers and all five additional
findings below have been fixed with regression tests, and the full
verification ladder passes (see Verification Notes). Each item is annotated
inline with **Resolved:** describing the fix. This document records the
original audit findings and their resolution.

## Goal

Make Fastify-served web mode a true server projection:

- Bootstrap must not leak provider, media, memory, or account secrets.
- Durable browser mutations must persist through command/import routes.
- Direct projection writes must either be impossible or intentionally wrapped
  and followed by a command/import path.
- Malformed import inputs must fail as validation errors, not internal errors.

## Blockers

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

## Additional Findings

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

Historical note:

- `pnpm tauribuild` appears in Phase 9 closeout docs but is no longer an
  available package script after the Fastify-only cleanup. Do not use that
  historical command as a current closeout gate unless the script is restored.

## Suggested Rework Order

1. Fix bootstrap secret masking first; it is the most direct security issue.
2. Fix character-module link persistence and add server/client tests.
3. Fix stale-alias trusted writes with guard-enabled regression tests.
4. Decide whether plugin DB bridge support should be fully implemented or
   explicitly narrowed; update docs and tests accordingly.
5. Fix malformed RISUSAVE block errors to return 400.
6. Re-run the full current ladder:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```
