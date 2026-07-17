# Media pickers store non-PNG uploads as PNG

## Summary

Several UI pickers explicitly accept JPEG, WebP, GIF, and audio files but discard the selected filename when calling the generic asset uploader. `saveAsset()` interprets a missing filename as PNG, so the browser sends every one of those byte streams to Fastify as `image/png`. Fastify trusts that header and durably stores `.png`/`image/png` metadata without inspecting the bytes. The UI then persists the returned hash and reports a successful update even though the asset's authoritative type is wrong.

Affected live pickers include NovelAI/WaveSpeed reference images, character emotion images, character-folder images, and GPT-SoVITS reference audio. In the last case WAV, OGG, AAC, or MP3 bytes are all registered as a PNG image.

## Location

- `src/lib/Setting/Pages/OtherBotSettings.svelte:471-500`
- `src/lib/SideBars/CharConfig.svelte:708-742,999-1031`
- `src/lib/SideBars/Sidebar.svelte:173-233`
- `src/ts/globalApi.svelte.ts:145-169,232-237`
- `src/ts/server/assets.ts:9-31,50-59,71-99`
- `src/ts/server/settingsBridge.svelte.ts:137-225,535-568`
- `src/ts/server/characterBridge.svelte.ts:59-134,333-365`
- `src/ts/characterCommands.ts:1763-1818`
- `server/fastify/src/routes/assets.ts:217-250,288-320`
- `server/fastify/src/repository.ts:33-57,2022-2081`
- `server/fastify/src/risuSave/bundleExport.ts:59-71`
- `server/fastify/src/risuSave/localBackupDatabase.ts:17-28`
- `server/fastify/src/risuSave/localBackupExport.ts:55-67`
- `src/ts/process/stableDiff.ts:117-143,486-510,557-570,811-840`
- `src/ts/process/tts.ts:506-520`

## Trigger

Use any affected picker with a non-PNG file, for example:

1. In Other Bot Settings, choose a JPEG or WebP NovelAI character/I2I image or WaveSpeed reference image.
2. In Character Settings, add a WebP/GIF emotion or upload an MP3/WAV/OGG/AAC GPT-SoVITS reference clip.
3. In the sidebar, choose a JPEG or WebP character-folder image.
4. Let the upload and subsequent settings, character, or character-order command complete.

## Expected behavior

The uploaded asset's persisted extension and content type should match its actual bytes. Fastify should reject inconsistent type declarations, and the reference stored in settings/character data should resolve to correctly typed content in reads, generation, TTS, and portable backups.

## Actual behavior

Each picker receives the original file name but calls `saveAsset(bytes)` without it. The server creates an asset row with `ext = "png"` and `contentType = "image/png"` even for JPEG, WebP, GIF, MP3, WAV, OGG, or AAC bytes. The asset id is returned normally, and the surrounding freshness guards then persist that id into the correct UI record, so the interaction looks fully successful.

`GET /api/v1/assets/:id` subsequently labels the bytes `image/png`. ZIP and legacy local backups name the entry `<hash>.png` and rewrite references to that path. Image-generation consumers receive bare base64 and, in one NovelAI character-reference path, explicitly construct `data:image/png;base64,...` around the non-PNG bytes. GPT-SoVITS happens to read raw bytes and retain the original filename separately, so some providers may still accept that audio, but its server metadata and exported representation remain an image.

The corruption is sticky: assets are keyed only by content hash. If the same bytes are later uploaded by a correct picker with the correct MIME type, `addAssets()` returns the existing metadata unchanged instead of repairing it.

## Underlying cause

The migrated asset API requires the caller to translate a filename/extension into a MIME type. `saveAsset()` defaults its optional `fileName` argument to an empty string, and `assetExtensionFromFileName('')` defaults to `png`. The affected UI paths omit the argument even though each selected-file result contains `.name`.

The client then maps `png` to `image/png` and sends that value as the `Content-Type` header. The Fastify route validates only that the header is in its allowlist; the repository never sniffs or cross-checks magic bytes. It derives the disk extension directly from the declared type.

Content-addressed deduplication makes the first declaration authoritative forever. When an id already exists, the repository returns the old `PersistedAsset` row without comparing its type to the new upload. This turns a caller mistake into durable repository metadata corruption.

There is an additional compatibility hole for AAC: the GPT-SoVITS picker accepts `.aac`, but neither the client nor server asset type map contains AAC. The current PNG fallback accidentally bypasses that unsupported-type check rather than handling AAC correctly.

## Affected data flow

1. **UI interaction:** A file picker accepts a non-PNG file and exposes both `data` and `name` (`OtherBotSettings.svelte:474-485`; `CharConfig.svelte:715-727,1005-1015`; `Sidebar.svelte:173-201`).
2. **Client upload state:** The handler passes only `data`. `saveAsset()` therefore resolves the empty filename to extension `png` (`globalApi.svelte.ts:157-159,232-237`).
3. **Request:** `uploadServerAsset()` maps that extension to `image/png` and sends raw bytes in `POST /api/v1/assets` with `Content-Type: image/png` (`assets.ts:9-18,71-99`).
4. **Server persistence:** The route forwards the declared type and bytes to `addAsset()`. The repository derives `.png`, hashes and writes the untouched bytes, and inserts `{ id, ext: 'png', contentType: 'image/png' }` (`routes/assets.ts:217-245`; `repository.ts:2022-2059`).
5. **Acknowledgement:** Fastify returns `{ assetId, revision }`. Because the id is valid, the client has no response field from which to detect the mismatch.
6. **Domain persistence:** The settings draft persists the id through its settings patch queue; character emotion/audio drafts dispatch character patches; folder upload dispatches a character-order command (`settingsBridge.svelte.ts:535-568`; `characterBridge.svelte.ts:341-363`; `characterCommands.ts:1763-1818`).
7. **Displayed UI:** Image previews resolve the id through `/api/v1/assets/:id`, which sends the false `image/png` header. GPT-SoVITS displays the separately retained original audio filename, masking the inconsistent asset row (`routes/assets.ts:288-305`; `CharConfig.svelte:1021-1030`).
8. **Downstream/export:** Image generation reads raw bytes as base64, while backup builders use the persisted `.png` extension for bundle paths, local records, and rewritten database references (`stableDiff.ts:117-143`; `bundleExport.ts:66-71`; `localBackupDatabase.ts:24-27`; `localBackupExport.ts:62-67`).

## Severity and user impact

**Medium-high.** The primary stored bytes are not lost, and tolerant browser/provider decoders may sniff them successfully, which can hide the defect. However, the authoritative metadata is false, strict consumers can reject previews or generation inputs, audio is advertised as an image, and every exported backup preserves the wrong type. Because hash deduplication prevents a correct reupload from repairing an existing row, affected data remains inconsistent across clients and restores until repository metadata is explicitly migrated.

## Recommended fix

- Pass `img.name`, `file.name`, `audio.name`, or `folderImage.name` to `saveAsset()` in every file-picker path. Prefer changing the API to accept the selected `File`/`SelectedFile` object or an explicit `{ bytes, filename, contentType }` so omitting type information is not the easy default.
- Remove the implicit PNG default for general-purpose uploads. Keep a separate image-specific helper only for call sites that truly create PNG bytes in memory.
- Sniff supported magic bytes on Fastify and either derive the authoritative type or reject a declared type that disagrees with the payload. Apply size/type validation before persistence.
- Add a supported AAC MIME/extension on both sides, or remove AAC from the picker until it is supported.
- Define a repair migration for existing rows: inspect stored bytes, update `ext`/`content_type`, and rename the file transactionally. Account for hash collisions where the same immutable bytes have references created under different declarations.
- When an existing hash is uploaded with a conflicting type, return a clear conflict or safely repair verified metadata instead of silently accepting the previous row.

## Test coverage gap

Current upload freshness tests mock `saveAsset()` as returning an id, so they never assert which filename/MIME type was sent. Add component tests for JPEG/WebP/GIF and each GPT-SoVITS audio extension. Add route/repository tests that reject a JPEG body declared as PNG, verify correct GET headers and backup filenames, and cover a second upload of the same hash with conflicting metadata. Include a migration test for already misclassified rows.
