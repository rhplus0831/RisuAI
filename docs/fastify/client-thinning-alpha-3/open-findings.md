# Open Findings

Date: 2026-05-28

Status: **closed 2026-05-28.** These findings were discovered after the
[`../client-thinning-alpha-2/`](../client-thinning-alpha-2/) closeout. The
Alpha 3 closeout fixed A3F1 through A3F13 with repeatable audit gates or
focused regression tests. No Alpha 3 findings remain open.

## Summary

| Finding                                                                    | Severity | Criterion     | Audit gate                     | Status | Suggested bucket |
| -------------------------------------------------------------------------- | -------- | ------------- | ------------------------------ | ------ | ---------------- |
| A3F1 - Passive bootstrap refresh steals active-writer ownership            | High     | A3EC1 / A3EC6 | R1                             | Closed | 1                |
| A3F2 - Generic settings blindly replay 409 conflicts                       | High     | A3EC1 / A3EC6 | R2                             | Closed | 1                |
| A3F3 - Preset copy/import still mint command-path ids                      | High     | A3EC2 / A3EC6 | R3                             | Closed | 2                |
| A3F4 - Empty-lorebook delete fallback mints a command-path id              | High     | A3EC2 / A3EC6 | R3                             | Closed | 2                |
| A3F5 - Global chat/message addressing can hit the wrong duplicate id       | High     | A3EC3 / A3EC6 | R4                             | Closed | 3                |
| A3F6 - Preset import bypasses preset image asset validation                | Medium   | A3EC4 / A3EC6 | R3 overlap plus focused tests  | Closed | 2                |
| A3F7 - Asset reads can fetch arbitrary URLs with `risu-auth`               | High     | A3EC4 / A3EC6 | R7                             | Closed | 4                |
| A3F8 - Server backups do not preserve asset bytes                          | Medium   | A3EC4         | Focused tests/contract         | Closed | 4                |
| A3F9 - Bundle asset walker ignores supported legacy asset-path refs        | Medium   | A3EC4 / A3EC6 | R5                             | Closed | 4                |
| A3F10 - Fastify asset uploads can lose MIME/extension metadata             | Low      | A3EC4         | Focused tests/contract         | Closed | 4                |
| A3F11 - Masked array secrets restore by index                              | Medium   | A3EC5 / A3EC6 | R6                             | Closed | 5                |
| A3F12 - Compatibility adapters can fan out conflicting concurrent commands | Medium   | A3EC1         | Focused tests/contract         | Closed | 1                |
| A3F13 - Command event sink keeps unbounded event history                   | Low      | A3EC6         | Focused tests/retention policy | Closed | 6                |

The latest Codex and Claude audits are merged in [`audit.md`](./audit.md).
Closeout was rule-first: R1-R7 fail on the old source patterns and pass after
their corresponding fixes; A3F8, A3F10, A3F12, and A3F13 are covered by focused
tests and documented contract decisions.

## A3F1 - Passive Bootstrap Refresh Steals Active-Writer Ownership

Severity: **High**

`startServerProjectionEvents` subscribes to command events and schedules a
projection refresh. That refresh calls `fetchServerBootstrapProjection`, which
always sends `risu-writer-session`. The Fastify bootstrap route registers any
bootstrap request carrying a writer session as the active writer. A stale tab can
therefore become active again merely by receiving another tab's command event.

Evidence:

- Event refresh path:
  `src/ts/bootstrap.ts:140`, `src/ts/bootstrap.ts:158`,
  `src/ts/bootstrap.ts:178`.
- Bootstrap client always sends the active-writer header:
  `src/ts/server/bootstrap.ts:33`.
- Server bootstrap registers the supplied writer session:
  `server/fastify/src/routes/bootstrap.ts:22`,
  `server/fastify/src/activeWriter.ts:13`.

Impact: A2EC2/A2EC5-style stale-writer protection can be bypassed by passive
read refresh. This undermines the "latest bootstrapped session wins" model
because refreshes are not only page-load/user-intent bootstrap calls.

Required closeout:

- Closed in Bucket 1. Passive projection refresh now calls a read-only bootstrap
  helper that does not attach `risu-writer-session`; page-load bootstrap remains
  the writer-registration path.
- Regression proof:
  `src/ts/server/bootstrap.test.ts`,
  `src/ts/bootstrap.test.ts`, and
  `server/fastify/__tests__/activeWriter.test.ts`.
- Audit gate: R1, passive projection refresh cannot call a writer-registering
  bootstrap helper.
- Split bootstrap into a writer-registration mode and a projection-refresh mode,
  or add a separate read-only projection endpoint/header.
- Add a two-session regression test where session A bootstraps, session B
  bootstraps, session B mutates, session A passively refreshes, and session A
  still receives 423 on mutation.
- Extend `pnpm client-thinning:audit` so passive refresh cannot call a
  writer-registering bootstrap helper without explicit classification.

## A3F2 - Generic Settings Blindly Replay 409 Conflicts

Severity: **High**

EC5 says blind 409 replay is removed, but the generic settings path retries the
same patch against `currentRevision` after a conflict. This is reachable from
setting wrappers.

Evidence:

- Retry path:
  `src/ts/setting/utils.ts:132`, `src/ts/setting/utils.ts:138`.
- Wrapper entrypoint:
  `src/lib/Setting/Wrappers/SettingCheck.svelte:27`.
- Central command wrapper does not replay conflicts:
  `src/ts/server/commands.ts:2155`.

Impact: A stale tab can overwrite newer state for settings that use
`patchServerBackedSetting`, even though other command helpers correctly surface
the conflict.

Required closeout:

- Closed in Bucket 1. `patchServerBackedSetting` now treats conflict like any
  non-ok command result and rolls back the optimistic setting instead of
  resending the same patch with `currentRevision`.
- Regression proof: `src/ts/setting/utils.test.ts`.
- Audit gate: R2, conflict retry blocks that resend the same patch are forbidden
  outside the central command wrapper.
- Remove the retry and roll back/surface conflict like `runServerCommand`.
- Add a focused browser-side settings test proving a 409 does not cause a second
  PATCH with `currentRevision`.
- Add an audit check for `result.status === 'conflict'` retry patterns in
  server-backed settings helpers.

## A3F3 - Preset Copy/Import Still Mint Command-Path Ids

Severity: **High**

The client creates an optimistic id before copying a preset, but the
`copyPresetCommand` payload sends only `name` and `saveCurrent`. The server then
calls `repairPresetRecord` with `id: undefined`, minting a new id. The preset
import route also uses `repairPresetRecord`, so an omitted import id is silently
minted.

Evidence:

- Client optimistic copy id is created but not sent:
  `src/ts/storage/database.svelte.ts:2215`,
  `src/ts/server/commands.ts:1106`.
- Server copy/import repair path:
  `server/fastify/src/routes/commands.ts:1189`,
  `server/fastify/src/routes/commands.ts:1260`,
  `server/fastify/src/commands/presets.ts:191`.
- Alpha 2 stable-id decision requires command writes to use client-owned ids:
  `docs/fastify/client-thinning-alpha-2/decisions.md:10`.

Impact: The browser projection can optimistically add one preset id while the
server persists a different id. It also leaves a command-path id-minting
exception that the current audit does not catch.

Required closeout:

- Closed in Bucket 2. `copyPresetCommand` now sends the optimistic
  client-generated id as `newPresetId`, and the Fastify copy route requires that
  id and rejects duplicates. Preset import now uses `createPresetRecord` instead
  of the id-minting repair helper.
- Regression proof:
  `src/ts/server/commands.test.ts` and
  `server/fastify/__tests__/commands.test.ts`.
- Audit gate: R3, public command routes cannot call imported repair helpers that
  can mint ids unless the command is an explicit audited server-generated-id
  exception.

## A3F4 - Empty-Lorebook Delete Fallback Mints A Command-Path Id

Severity: **High**

Deleting the last global lorebook through the public command route inserts a
default `My First LoreBook` by calling `repairGlobalLorebookRecord`, which mints
an id server-side. The UI currently avoids deleting the last lorebook, but the
route itself is public and command-path id minting is still reachable.

Evidence:

- Route fallback:
  `server/fastify/src/routes/commands.ts:3224`,
  `server/fastify/src/routes/commands.ts:3227`.
- UI local guard is not a route contract:
  `src/lib/Setting/lorepreset.svelte:86`.

Impact: Public commands can still create durable ids behind the client's back.
This is the same invariant class as A2F1, but through an imported repair helper
rather than a route-local `randomUUID()`.

Required closeout:

- Closed in Bucket 2. Deleting the last global lorebook now returns 400 instead
  of inserting a fallback record, so the route no longer mints durable ids.
- Regression proof: `server/fastify/__tests__/commands.test.ts`.
- Audit gate: R3, public command routes cannot call imported repair helpers that
  can mint ids unless the command is an explicit audited server-generated-id
  exception.

## A3F5 - Global Chat/Message Addressing Can Hit The Wrong Duplicate Id

Severity: **High**

Patch/delete/fork message and chat routes address rows globally by `chatId` or
`messageId`; the resolver returns the first matching id across all characters.
However, create/import normalization only dedupes chats inside each character and
messages inside each chat. Cross-parent duplicates can therefore make later
commands mutate the wrong row.

Scope note: chat folders are not part of this finding. Folder global uniqueness
is already enforced by `normalizeGlobalChatFolderIds` and audit rule AEC4
(`util/client-thinning-audit.ts:1071-1105`).

Evidence:

- Per-character chat dedupe:
  `server/fastify/src/commands/chats.ts:59`.
- Global chat resolver:
  `server/fastify/src/commands/chats.ts:291`.
- Chat create duplicate check only inspects the target character:
  `server/fastify/src/routes/commands.ts:2394`.
- Per-chat message dedupe:
  `server/fastify/src/commands/messages.ts:61`.
- Global message resolver:
  `server/fastify/src/commands/messages.ts:141`.
- Message append duplicate check only inspects the target chat:
  `server/fastify/src/routes/commands.ts:2908`.

Impact: If two characters contain `chat-a`, `PATCH /commands/chats/chat-a` can
update the first one regardless of which character the client intended. The same
applies to message patch/delete.

Required closeout:

- Closed in Bucket 3. The existing public route contract remains globally
  addressed, and the server now enforces global uniqueness instead of converting
  routes to parent-scoped URLs.
- Chat ids are repaired to global uniqueness during import/bootstrap
  normalization, and command-created/forked chats reject ids already used under
  another character.
- Message ids are repaired to global uniqueness during import/bootstrap
  normalization, local bookmark references are updated when a duplicate message
  id is repaired, and append/replace/generation/chat-create/chat-fork command
  paths reject message ids already used under another chat.
- Regression proof: `server/fastify/__tests__/commands.test.ts` covers
  cross-character duplicate chat-id repair/rejection and cross-chat duplicate
  message-id repair/rejection.
- Audit gate: R4 no longer appears in `pnpm client-thinning:audit`; the audit
  remains intentionally red only on later buckets.

## A3F6 - Preset Import Bypasses Preset Image Asset Validation

Severity: **Medium**

Preset create and patch validate `preset.image` using
`validateOptionalServerAssetRef`, but `/api/v1/commands/presets/import` uses
`repairPresetRecord`, which validates `name` only.

Evidence:

- Validated create/patch helpers:
  `server/fastify/src/commands/presets.ts:175`,
  `server/fastify/src/commands/presets.ts:185`,
  `server/fastify/src/commands/presets.ts:267`.
- Import route uses repair helper:
  `server/fastify/src/routes/commands.ts:1260`,
  `server/fastify/src/commands/presets.ts:189`.

Impact: Import commands can persist malformed or missing asset ids that bundle
walking later treats as server asset references.

Required closeout:

- Closed in Bucket 2. Preset import now uses `createPresetRecord` with the
  Fastify asset data directory, matching create/patch validation for
  `preset.image`.
- Regression proof: `server/fastify/__tests__/commands.test.ts` covers
  malformed and missing `image` refs for `/commands/presets/import`.
- Audit gate: R3 overlap, because preset import was rewritten away from
  `repairPresetRecord`. The unused `repairPresetRecord` export survived
  Alpha 3 and was finally deleted in Alpha 4 / B10.

## A3F7 - Asset Reads Can Fetch Arbitrary URLs With `risu-auth`

Severity: **High**

In Fastify mode, `readImage` and `loadAsset` delegate to
`readServerAssetBytes`. If the value is neither a raw server asset id nor a
legacy `assets/<sha>.<ext>` path, `readServerAssetBytes` fetches the string
unchanged while still attaching `risu-auth`.

Evidence:

- Fastify image/asset read delegates:
  `src/ts/globalApi.svelte.ts:187`, `src/ts/globalApi.svelte.ts:266`.
- Arbitrary fallback URL plus auth header:
  `src/ts/server/assets.ts:24`, `src/ts/server/assets.ts:28`.

Impact: A database value or plugin path can trigger authenticated fetches to
non-Fastify URLs. This breaks the documented asset gate through `/api/v1/assets`
and risks leaking short-lived auth to a CORS-allowing external origin.

Required closeout:

- Closed in Bucket 4. `readServerAssetBytes` now throws for unknown references
  before resolving auth, so only raw server asset ids and supported legacy
  `assets/<sha>.<ext>` paths reach `/api/v1/assets/:id`.
- Regression proof: `src/ts/server/assets.test.ts`.
- Audit gate: R7 no longer appears in `pnpm client-thinning:audit`.

## A3F8 - Server Backups Do Not Preserve Asset Bytes

Severity: **Medium**

Fastify assets live under `data/assets`. Server backup creation writes only
`db.json` and `manifest.json`; restore copies only `db.json`. The backup
manifest records `assetCount`, but asset files are not copied into the backup or
restored.

Evidence:

- Asset storage path:
  `server/fastify/src/repository.ts:121`.
- Backup writes metadata only:
  `server/fastify/src/repository.ts:215`.
- Restore copies only `db.json`:
  `server/fastify/src/repository.ts:255`.

Impact: Restoring a backup can recreate metadata and database references that
point to missing asset files.

Required closeout:

- Closed in Bucket 4. Server backups copy `data/assets` into the backup
  snapshot and restore that asset directory alongside `db.json`.
- Regression proof: `server/fastify/__tests__/backups.test.ts` uploads an asset,
  creates a backup, removes live asset files, restores, and reads the bytes.
- Contract decision: server backups preserve asset bytes, not metadata only.

## A3F9 - Bundle Asset Walker Ignores Supported Legacy Asset-Path Refs

Severity: **Medium**

The client accepts both raw 64-character server asset ids and legacy
`assets/<sha>.<ext>` paths, but the server RisuSave walker only records raw ids.
The current test explicitly expects `assets/<sha>.png` to be ignored.

Evidence:

- Client normalization accepts legacy paths:
  `src/ts/server/assets.ts:1`.
- Server walker only accepts raw ids:
  `server/fastify/src/risuSave/assetReferences.ts:146`.
- Test locks the ignore behavior:
  `server/fastify/__tests__/risuSaveAssetReferences.test.ts:121`.

Impact: Bundle export can omit bytes for references the Fastify web client can
read, especially imported/current-shape data that still uses legacy asset paths.

Required closeout:

- Closed in Bucket 4. Fastify current-shape data may contain supported legacy
  `assets/<sha>.<ext>` references, and the server walker now collects them as
  the underlying server asset id.
- Regression proof:
  `server/fastify/__tests__/risuSaveAssetReferences.test.ts` and
  `server/fastify/__tests__/risuSaveBundleExportRoute.test.ts`.
- Audit gate: R5 no longer appears in `pnpm client-thinning:audit`.

## A3F10 - Fastify Asset Uploads Can Lose MIME/Extension Metadata

Severity: **Low**

`saveAsset` defaults to `png` when no filename is supplied. Some non-image asset
callers pass bytes without a filename, which causes the server to persist
`image/png` metadata and a `.png` extension even for model/ONNX-like assets.
Bundle export later uses that stored extension.

Evidence:

- Default extension:
  `src/ts/globalApi.svelte.ts:213`.
- Non-image caller without filename:
  `src/ts/process/transformers.ts:203`.
- Server stores content type/extension and bundle export uses it:
  `server/fastify/src/repository.ts:146`,
  `server/fastify/src/risuSave/bundleExport.ts:67`.

Impact: Exported bundles can contain misleading filenames/content metadata for
non-image assets. This is lower severity unless those assets are expected to be
round-trippable through bundle export.

Required closeout:

- Closed in Bucket 4. Transformer ONNX imports pass the `.onnx` filename to
  `saveAsset`, and Fastify asset upload metadata now supports
  `application/x-onnx` / `.onnx`.
- Regression proof: `server/fastify/__tests__/assets.test.ts`.
- Contract decision: image callers may keep the existing PNG default; supported
  non-image callers must pass a filename/content type path instead of relying on
  the image default.

## A3F11 - Masked Array Secrets Restore By Index

Severity: **Medium**

Secret masking uses wildcard paths for arrays such as `botPresets`,
`customModels`, and `authRefreshes`. Placeholder resolution restores values by
array index. If a client submits a reordered or shortened array containing
masked placeholders, a secret can be copied from the old row at the same index
to a different row.

Evidence:

- Secret wildcard paths:
  `server/fastify/src/providerSecrets.ts:9`,
  `server/fastify/src/providerSecrets.ts:11`,
  `server/fastify/src/providerSecrets.ts:16`.
- Index-based restore:
  `server/fastify/src/providerSecrets.ts:115`,
  `server/fastify/src/providerSecrets.ts:123`.
- Settings command applies placeholder resolution before write:
  `server/fastify/src/routes/commands.ts:4228`.

Impact: Reorder/delete patches can transplant provider secrets across records.
Existing tests cover one-element arrays but not row identity changes.

Required closeout:

- Closed in Bucket 5. Masked array placeholders now restore by stable row
  identity instead of position for `authRefreshes`, `botPresets`, `characters`,
  and `customModels`.
- Provider settings commands reject masked placeholders when row identity is
  missing, duplicated, or unknown, preventing reorder/delete transplants.
- Regression proof:
  `server/fastify/__tests__/commands.test.ts` covers `customModels[*].key` and
  `authRefreshes[*].refreshToken`/`clientSecret` reorder/delete behavior through
  `/api/v1/commands/settings/providers`;
  `server/fastify/__tests__/providerSecrets.test.ts` covers
  `botPresets[*].openAIKey`/`proxyKey` and
  `characters[*].oaiTTSConfig.apiKey`.
- Audit gate: R6 no longer appears in `pnpm client-thinning:audit`.

## A3F12 - Compatibility Adapters Can Fan Out Conflicting Concurrent Commands

Severity: **Medium**

`dispatchCompatibleChatUpdate` can dispatch chat metadata, message replacement,
and scriptstate commands back-to-back for one optimistic local mutation. Each
call reads the cached revision independently. Without a command queue, the first
successful command bumps the server revision and later concurrent commands can
409 and roll back the whole optimistic snapshot.

Evidence:

- Multi-command fan-out:
  `src/ts/chatCommands.ts:146`,
  `src/ts/chatCommands.ts:151`,
  `src/ts/chatCommands.ts:155`.
- Command wrapper reads one base revision per call:
  `src/ts/server/commands.ts:2155`.
- Server strictly rejects stale revisions:
  `server/fastify/src/commands/mutations.ts:50`.

Impact: Compatibility adapters can lose part of an intended composite update or
roll back successful state because sibling commands raced each other.

Required closeout:

- Closed in Bucket 1. `dispatchCompatibleChatUpdate` now serializes metadata,
  message replacement, and scriptstate commands so each command reads the
  command revision cached by the previous response.
- Regression proof: `src/ts/compatibilityAdapters.test.ts`.
- No dedicated R-rule is required unless the implementation exposes a reusable
  audit pattern; close with focused compatibility fan-out tests.
- Serialize command dispatches that share one optimistic snapshot, or replace
  fan-out with composite server commands where atomicity matters.
- Add tests for a compatibility chat update that changes metadata, messages, and
  scriptstate together.

## A3F13 - Command Event Sink Keeps Unbounded Event History

Severity: **Low**

The in-memory command event sink appends every emitted event to an array and
never trims it. SSE listeners need current invalidation events, but the current
implementation keeps full process lifetime history.

Evidence:

- Unbounded append:
  `server/fastify/src/commands/events.ts:327`,
  `server/fastify/src/commands/events.ts:331`.
- Full copy exposed by `list()`:
  `server/fastify/src/commands/events.ts:343`.

Impact: A long-running server with frequent commands can grow memory
unboundedly. This is not a correctness blocker for Alpha 3 unless event replay
semantics are supposed to be durable.

Required closeout:

- Closed in Bucket 6. `InMemoryCommandEventSink` now retains only the latest
  1000 command events for `list()` diagnostics and trims older history on emit.
  Live subscribers still receive every emitted event; event replay is not a
  durable process-lifetime contract.
- Regression proof:
  `server/fastify/__tests__/events.test.ts` covers bounded retained history,
  live fanout preservation, and `clear()` behavior.
- No dedicated R-rule was added because the retention limit is local to the
  event sink implementation and is covered directly by the focused test.
