# DL2 Pass 3 report — codex

## Checks

- Reset chats after export confirmation — FINDING DL2-P3-1 — `src/ts/characters.ts:1039-1064` strictly hydrates, serializes, awaits the download helper, and returns false on thrown failure; `src/ts/globalApi.svelte.ts:75-98` constructs the Blob and invokes the browser download anchor. However, `src/lib/SideBars/SideChatList.svelte:1000-1012` then awaits two promise-backed confirmations before re-reading the live chats, and `server/fastify/src/routes/commands.ts:6014-6024` deletes every chat/message/Hypa row in that later state.
- Settings item deletion confirmation — SAFE — `src/ts/setting/confirmSettingsItemRemoval.ts:3-5` is synchronous and fails closed when confirmation is unavailable. All 20 touched removal sites put this guard before their mutation with no upstream `await`; representative array and structural-row paths are `src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:132-141` and `src/lib/Setting/Pages/PromptSettings.svelte:1459-1471`.
- Prompt-preset archive — FINDING DL2-P3-2 — Runtime archive/restore is a reversible `{ archived }` row patch (`src/lib/Setting/botpreset.svelte:308-316`, `server/fastify/src/routes/commands.ts:3939-3951`), and device/whole-`.risu` paths preserve the `prompt_presets` row (`server/fastify/src/repository.ts:2690-2719`, `server/fastify/src/risuSave/exportSnapshot.ts:28-36`, `server/fastify/src/risuSave/exportSnapshot.ts:212-218`). The standalone JSON/`.risup` round-trip nevertheless strips this metadata at `src/ts/presetSplit.ts:250-259` and `src/ts/storage/database.svelte.ts:6182-6191`.
- Mood Light trashed-bot hiding and management dialog — SAFE — Management excludes trashed rows only from selectable targets and toggles only normalized membership metadata (`src/ts/moodLightMembership.ts:152-188`, `src/ts/moodLightMembership.ts:191-223`); persistence writes only the settings patch (`src/lib/SideBars/Sidebar.svelte:372-388`). Asset GC still scans every character and chat row without a trash/Mood-Light filter (`server/fastify/src/assetGc.ts:140-184`), while the trash catalog places each row in exactly one Mood Light partition (`src/lib/Others/GridCatalog.svelte:23-55`).

## Findings

### DL2-P3-1 — Reset is not fenced to the exported chat state

- Severity: medium / Confidence: certain
- Evidence: `src/ts/characters.ts:1049-1061` freezes the export payload and awaits `downloadFile`; `src/ts/globalApi.svelte.ts:75-98` constructs the Blob, invokes the browser anchor, and only then returns. The later UI sequence at `src/lib/SideBars/SideChatList.svelte:1004-1012` is decisive:

  ```ts
  const firstConfirmed = await alertConfirm(...)
  const secondConfirmed = await alertConfirm(...)
  const liveCharacter = getDatabase().characters?.find(...)
  const previous = currentChatStateSnapshot()
  ```

  These are real asynchronous dialog promises (`src/ts/alert.ts:300-314`), so background resource/generation settlement can advance the chat state while either dialog is open. Reset execution obtains the then-current command revision (`src/ts/server/commands.ts:5667-5679`) rather than the export-time revision, and its synchronous server transaction deletes all then-current chat rows, message rows, and Hypa data (`server/fastify/src/routes/commands.ts:6014-6024`).
- Loss scenario: User exports character chats at state S → while either confirmation is open, a background generation finalization or durable replay adds chat content N and its resource update reaches the browser → user confirms → the UI deliberately re-reads S+N and the server accepts reset against the current revision → N is durably deleted although the downloaded export contains only S.
- Fix direction: Return/capture an export-time revision plus stable chat/message identity fence, carry it to reset, and reject with a re-export prompt if the live character chat state differs. Do not let the reset use only the post-confirmation current revision.

### DL2-P3-2 — Standalone prompt-preset round-trip drops archive metadata

- Severity: medium / Confidence: certain
- Evidence: Archive is durable metadata persisted by `updatePromptPreset(liveIndex, { archived })` at `src/lib/Setting/botpreset.svelte:308-316`. But `PROMPT_PRESET_FIELDS` omits `archived` (`src/ts/presetSplit.ts:124-145`), and the exporter copies only those fields plus `name` and `id`:

  ```ts
  const payload = {
    ...extractPromptPresetFields(promptPreset),
    ...extractPromptPresetModelOverrideFields(promptPreset),
  }
  ```

  `downloadPreset` serializes that lossy payload for both JSON and `.risup` (`src/ts/storage/database.svelte.ts:6840-6862`), while `addImportedPromptPreset` applies the same lossy projection again before staging an imported row (`src/ts/storage/database.svelte.ts:6182-6191`).
- Loss scenario: User archives a prompt preset → exports it from the archive view as JSON or `.risup` → later deletes/loses the original and imports the file → all prompt content returns, but `archived: true` is silently gone and the preset is restored as active, destroying the user's durable organization metadata.
- Fix direction: Include and boolean-normalize `archived` in `promptPresetExportPayload` and preserve it through standalone import. Pin both JSON and `.risup` archive-state round-trips.

## Free-hunt findings

No additional findings beyond DL2-P3-1 and DL2-P3-2, which fall directly under the enumerated reset and archive checks.

## Not examined

None in the assigned Pass 3 surface. This was static read-only tracing; the brief prohibited test-suite runs.

Co-Authored-By: Codex <noreply@openai.com>
