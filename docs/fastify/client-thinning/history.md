# History

Date: 2026-05-28

Resolved findings, verification-ladder results, and the pointer to the archived
Phase 9 migration slices. The live work is in
[`open-findings.md`](./open-findings.md).

## Provider ownership (EC1/F1)

Closed on 2026-05-28.

- Fastify-mode completion dispatch no longer reads `useServerGeneration`; legacy
  saved `false` values are ignored.
- `useServerGeneration` was removed from the Fastify settings command maps and
  the browser settings-group map.
- `requestChatDataMain` now uses `resolveServerCompletionRoute`: server-routable
  providers call `/api/v1/generate/completion`, while unsupported provider
  formats and provider-preview bodies fail explicitly in Fastify server mode
  instead of falling through to browser provider dispatch.
- Browser Vertex refresh still exists for non-Fastify local mode, but in Fastify
  mode it no longer writes `vertexAccessToken` / `vertexAccessTokenExpires` into
  the server projection; server Vertex routing continues through
  `server/fastify/src/generation/vertexAuth.ts`.

Verification:

- `pnpm test src/ts/process/request/tests/serverCompletion.test.ts -- --run`:
  126 passed.
- `pnpm test src/ts/process/request/tests/google.fastify.test.ts -- --run`: 1
  passed.
- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: 68
  passed.
- `pnpm check`: passed, 0 errors / 0 warnings.
- `pnpm test`: 782 passed, 4 skipped.
- `pnpm api:test`: 1221 passed.
- `pnpm build`: built with pre-existing CSS `::highlight`, browser-externalized
  module, plugin-timing, chunk-size, and ineffective-dynamic-import warnings.

## Plugin durable storage + Compatibility Mode (EC2/F2)

Closed on 2026-05-28.

- Fastify-mode device-local plugin storage APIs are disabled by default:
  `SafeLocalStorage`, `SafeIdbFactory`, and
  `getLocalPluginStorage()`/`SafeLocalPluginStorage` throw an explicit
  unsupported error unless Compatibility Mode is enabled.
- `pluginCompatibilityMode` is an account-wide, command-backed Advanced setting
  and is exposed in the UI as a not-recommended compatibility switch. Its help
  text warns that the restored data is device-local, unsynced, and excluded from
  server backup/export.
- `risuai.pluginStorage` remains server-backed and independent of Compatibility
  Mode.
- Resource ownership remains enforced in both states: `pluginV2` is blocked in
  Fastify mode as an unsupported bridge key, and V2 `getDatabase` no longer
  reads server-owned names from `pluginCustomStorage` as a shadow fallback.
- V3 `getRuntimeInfo()` reports `saveMethod: "server"` in Fastify mode and adds
  `deviceLocalPluginStorage` as the capability flag.

Verification:

- `pnpm test src/ts/plugins/plugins.test.ts src/ts/server/commands.test.ts -- --run`:
  49 passed.
- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: 68 passed.

## Import current-shape normalization (EC3/F3)

Closed on 2026-05-28.

- JSON `{ database }` import now uses the same exported
  `normalizeRisuSaveImportDatabase` path as multipart `.risu` import and passes
  the returned normalized clone into persistence.
- The narrow `save.ts` route-local import normalizer was removed.
- Non-object JSON `database` payloads now return 400 before persistence.
- Bootstrap/import tests now treat JSON import as a current-shape normalization
  boundary: imported partial character/message shapes are served back normalized,
  with missing/duplicate message ids repaired by the import path.

Verification:

- `pnpm api:test server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts -- --run`:
  17 passed.

## Stable-id validation + prompt-item semantics (EC4/F4)

Closed on 2026-05-28.

- Public command paths now validate durable child ids instead of repairing them:
  prompt-item create requires a client-supplied `id`; message append, replacement,
  and generation-result persistence require `chatId`; lorebook entry replacement
  rejects missing/duplicate entry ids; and script/trigger replacement rejects
  missing/duplicate definition ids.
- Import/bootstrap repair remains separate and may still mint ids for malformed
  legacy/current-shape input. The command-side validators do not call
  `randomUUID()`.
- `promptTemplate` was removed from `/api/v1/commands/prompt-settings`; prompt
  item edits now go through `/api/v1/commands/prompt-items/*`.
- The Bot Settings prompt-template enable toggle now uses the new
  `/api/v1/commands/prompt-items/enable` command instead of patching
  `{ promptTemplate: [] }` through prompt settings.
- Import normalization now avoids adding empty character/module scaffolding when
  the imported JSON has no such resource family, while still repairing existing
  malformed message ids.

Verification:

- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: 69 passed.
- `pnpm test src/ts/server/commands.test.ts -- --run`: 36 passed.
- `pnpm check`: passed, 0 errors / 0 warnings.

## Single active-writer session lock (EC5/F5)

Closed on 2026-05-28.

- Fastify tracks a per-page-load `risu-writer-session` header. Bootstrap
  registers the active writer, and the latest bootstrapped session wins.
- A centralized active-writer guard returns **423** for stale writers on
  server-owned mutating routes: `/api/v1/commands/*`, JSON/multipart import,
  asset upload, backup create/restore/delete, and legacy storage write/remove.
  Read routes remain unguarded.
- The browser sends the writer-session header from bootstrap, command mutation,
  asset upload, backup, and legacy storage mutation clients.
- The browser reacts to 423 by showing the existing reload-session message and
  reloading, which re-bootstraps and re-registers the page.
- The blind 409 conflict replays in `patchServerBackedSettings` and
  `runServerCommand` were removed; a 409 now surfaces as a typed conflict/error
  instead of replaying stale payloads with the newer revision.

Verification:

- `pnpm api:test server/fastify/__tests__/activeWriter.test.ts -- --run`: 3
  passed.
- `pnpm api:test server/fastify/__tests__/activeWriter.test.ts server/fastify/__tests__/commands.test.ts -- --run`:
  72 passed.
- `pnpm test src/ts/server/commands.test.ts src/ts/server/bootstrap.test.ts src/ts/server/backups.test.ts src/ts/storage/nodeStorage.test.ts -- --run`:
  46 passed.

Note: `pnpm api:test server/fastify/__tests__/bootstrap.test.ts -- --run` was
also checked during EC5 closeout and still fails on pre-existing EC4-era
normalization expectations (`modules: []` no longer added when absent). That is
not part of EC5, but the next agent should be aware before using that suite as a
signal.

## Character asset-reference validation (EC6/F6)

Closed on 2026-05-28.

- `validateCharacterAssetRefs` now covers the character audio asset references
  walked by `risuSave/assetReferences.ts`: the dynamic `vits.files.*` map and
  `gptSoVitsConfig.ref_audio_data.assetId`.
- The validation is shared by create and patch through `createCharacterRecord`
  and `readCharacterPatch`, reuses `validateOptionalServerAssetRef`, preserves
  optional clear values, and rejects syntactically malformed or missing persisted
  server asset ids.
- EC6 stayed scoped to character audio refs. The broader walker-vs-validator
  drift class remains EC7 audit-script work.

Verification:

- `pnpm api:test server/fastify/__tests__/commands.test.ts -- --run`: 70 passed.

## Repeatable invariant audit (EC7)

Closed on 2026-05-28.

- Added `util/client-thinning-audit.ts`, wired as
  `pnpm client-thinning:audit`.
- The audit checks the current server-projection invariant surface: active-writer
  guard wiring/classification for server-owned mutating routes; command-path
  stable child-id validators do not mint ids; prompt items are not reachable
  through generic settings; plugin device-local storage APIs are gated by Plugin
  Compatibility Mode; plugin V3 reports server save semantics; asset-reference
  walker fields are covered by command validators; and Fastify provider routing
  remains server-owned.
- Closed the walker-vs-validator drift for `characterOrder.img`: when it is a
  server asset id, character-order commands now validate that the asset exists.
  Legacy URL-style `img` values remain allowed; `imgFile` keeps strict optional
  server-asset validation.
- Updated stale import/bootstrap fixture expectations to the current EC4
  normalization contract: imports no longer synthesize absent empty resource
  families such as `modules`.
- Updated the Fastify browser smoke hook so direct mutating smoke fetches reuse
  the active-writer session header, matching normal browser command/import/asset
  clients.

Verification:

- `pnpm client-thinning:audit`: passed.
- `pnpm check`: passed, 0 errors / 0 warnings.
- `pnpm test`: 786 passed, 4 skipped.
- `pnpm api:test`: 1228 passed.
- `pnpm build`: built with pre-existing CSS `::highlight`, browser-externalized
  module, plugin-timing, chunk-size, and ineffective-dynamic-import warnings.
- `pnpm smoke:fastify-browser`: 1 passed, with the same pre-existing build
  warnings as `pnpm build`.

## Archived migration slices

The original Phase 9 _client-thinning migration_ (slices 9-0 through 9-9e, plus
followups and the `9a`/`9b` projection-write passes) is closed and archived
under [`../phases-completed/`](../phases-completed/) as `phase-9-*` documents,
indexed from [`../phases-completed/README.md`](../phases-completed/README.md) and
[`../phases-completed/overview.md`](../phases-completed/overview.md). The locked
design artifact is
[`../phases-completed/phase-9-command-map.md`](../phases-completed/phase-9-command-map.md)
(command contract, identity rules, plugin DB bridge policy).

Those slices remain closed. This workstream exists because "complete against the
known direct-write list" was not the same as "complete against the
server-projection invariant."

## Resolved rework findings (2026-05-28)

### Original blockers

1. **Bootstrap leaked nested provider secrets.** `providerSecrets.ts` now masks
   `botPresets[*].openAIKey`, `botPresets[*].proxyKey`, and
   `characters[*].oaiTTSConfig.apiKey`; `bootstrap.test.ts` asserts masked nested
   output. (commit `60dfc7a1`)
2. **Character-module add/remove could not persist.** The reorder command now
   treats `moduleIds` as the full replacement set of links, validated against
   known modules (`validateCharacterModuleLinks`); add/remove/reorder all work.
   (commit `55f071ff`)
3. **Stale read-only aliases broke trusted projection writes.** Settings,
   prompt-settings, and bot prompt-field draft helpers re-read `DBState.db`
   inside the trusted callback; global lorebook add/folder/import build a mutable
   next-entry array and assign it; `ensureClientLorebookEntryIds` writes only
   when an id is missing. `lorebook.projectionGuard.test.ts` covers it.
   (commit `852d4cfd`) — see memory `phase9-guard-optimistic-write-gap`.
4. **Plugin DB bridge did not match the command map.** Contract revised: in
   server-backed mode, recognized resource families with no bridge command
   (`unsupportedServerBridgeKeys`) are blocked with a warning instead of producing
   a dangling projection write or shadowing the real resource; local mode
   unchanged; truly unknown keys still route to plugin storage. (commit `70b278c5`)

### Additional findings

- **Welcome setup persisted only part of what it mutated.** `WelcomeRisu.svelte`
  snapshots, diffs, and persists every changed key through
  `applyServerBackedSettingsPatch`. (commit `69c97d0a`)
- **`verbosity` was server-allowed but not client command-backed.** Mapped to the
  `runtime` settings group in `SERVER_SETTINGS_GROUP_BY_KEY`. (commit `2196b6e4`)
- **DevTool autopilot directly mutated message history.** The autopilot loop
  applies the optimistic user message inside `withTrustedServerProjectionWrite`
  and lets `sendChat` drive command-backed persistence. (commit `1dc75d57`)
- **Malformed RISUSAVE block uploads returned 500.**
  `decodeRisuSaveImportSnapshot` wraps raw envelope decoders so non-`ValidationError`
  failures become 400. (commit `deb61545`)
- **Asset upload revision/event mismatch.** The assets route is registered with
  the command event sink and emits `asset.created` with the bumped revision; the
  browser advances its cached command revision from the upload response.
  (commit `aa1f45d3`)

## Verification-ladder results (2026-05-28, after the resolved fixes)

- `pnpm check`: passed, 0 errors / 0 warnings.
- `pnpm test`: 779 passed, 4 skipped.
- `pnpm api:test`: 1221 passed.
- `pnpm build`: built (pre-existing chunk-size / ineffective-dynamic-import warnings only).
- `pnpm smoke:fastify-browser`: 1 passed.

Follow-up audit re-run (subset, 2026-05-28):

- `pnpm check`: passed, 0/0.
- Selected vitest projection-guard + command suites: 75 passed.
- Selected `pnpm api:test` command/bootstrap/risuSave/assets suites: 1221 passed.
- Full `pnpm test`, `pnpm build`, and `pnpm smoke:fastify-browser` were **not**
  rerun during the follow-up audit.

## Historical note

`pnpm tauribuild` appears in older Phase 9 closeout docs but is no longer an
available package script after the Fastify-only cleanup. Do not use it as a
current closeout gate unless the script is restored.
