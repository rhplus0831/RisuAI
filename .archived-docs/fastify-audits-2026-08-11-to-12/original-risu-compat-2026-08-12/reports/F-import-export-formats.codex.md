# Brief F — Import/export formats and remaining UI-visible flows (Codex track)

Audit basis: current `HEAD` versus Original RisuAI at `/home/codex/risu-baseline-71c476e9c` (`71c476e9c`), with the changed surface in `f2dc174f4..HEAD` used as the entry point. I found nine unadjudicated user-visible divergences. D1/D2 and the other standing decisions in `ADJUDICATION.md` are not repeated here.

## Findings

### F-1 — Legacy monolithic presets lose their provider/model half

- **Severity:** high
- **Current behavior:** `importPreset` accepts Original JSON, `.risupreset`, and `.risup` envelopes, but its ordinary legacy tail deliberately calls the prompt-only importer (`src/ts/storage/database.svelte.ts:6985-7029`, `src/ts/storage/database.svelte.ts:7153-7157`). That importer filters through `promptPresetExportPayload` (`src/ts/storage/database.svelte.ts:6258-6267`), while fields such as `apiType`, `aiModel`, `modelProfiles`, `textgenWebUIBlockingURL`, and `koboldURL` belong to the excluded model field set (`src/ts/presetSplit.ts:5-71`, `src/ts/presetSplit.ts:300-310`). The reverse path likewise exports only `db.promptPresets[id]` through the prompt-only payload (`src/ts/storage/database.svelte.ts:6911-6957`).
- **Baseline behavior:** Original exported the complete `db.botPresets[id]` row, redacting only credentials/URLs selected by the writer (`/home/codex/risu-baseline-71c476e9c/src/ts/storage/database.svelte.ts:2249-2277`). Its importer merged the decoded object over `presetTemplate` and appended that complete object to `db.botPresets` (`/home/codex/risu-baseline-71c476e9c/src/ts/storage/database.svelte.ts:2298-2323`, `/home/codex/risu-baseline-71c476e9c/src/ts/storage/database.svelte.ts:2453-2457`).
- **Consequence / repro:** In Original, export a preset with `aiModel: "kobold"`, a nondefault `koboldURL`, and a distinctive prompt, then import it from Prompt Settings in current. Current creates only a prompt preset and creates no paired model preset; selecting it does not restore the Kobold selection/URL, whereas importing and selecting the same file in Original does. Conversely, a current prompt-preset export imported by Original is filled with Original's default model/provider values rather than the model preset paired with it in current.
- **Charter classification:** `decide` — preserving the split-preset UI boundary is an intentional architectural choice, but it silently breaks both directions of the fork-point monolithic-preset contract.
- **Confidence:** high

### F-2 — A standalone CHAT block rejects the entire save instead of importing the supported blocks

- **Severity:** high
- **Current behavior:** the block assembler throws `UnsupportedStandaloneChatBlocksError` as soon as it sees block type `CHAT` (`server/fastify/src/risuSave/importSnapshot.ts:92-99`, `server/fastify/src/risuSave/importSnapshot.ts:184-211`). The `.risu` route maps that to 422 before applying the assembled database (`server/fastify/src/routes/save.ts:101-159`), so otherwise valid root, character, and preset blocks are not restored.
- **Baseline behavior:** Original's block switch handles character and resource blocks but has no `CHAT` arm (`/home/codex/risu-baseline-71c476e9c/src/ts/storage/risuSave.ts:485-554`). Type 3 reaches the default warning and decoding continues (`/home/codex/risu-baseline-71c476e9c/src/ts/storage/risuSave.ts:601-607`); the local-backup loader then applies the partially assembled database (`/home/codex/risu-baseline-71c476e9c/src/ts/drive/backuplocal.ts:436-440`).
- **Consequence / repro:** Build a valid block-format `RISUSAVE` containing `ROOT`, one `CHARACTER_WITH_CHAT` or `BOTPRESET`, and one valid type-3 standalone `CHAT` block. Original ignores only the unsupported chat block and restores the supported data. Current returns the localized unsupported-CHAT error and leaves the whole live database unchanged. The better diagnostic does not remove the acceptance divergence.
- **Charter classification:** `decide` — exact parity means tolerant partial import, while current's atomic failure avoids silently discarding the standalone chat.
- **Confidence:** high

### F-3 — One oversized optional CharX entry makes the entire card unimportable

- **Severity:** med
- **Current behavior:** the ZIP reader records entries over 50 MiB as excluded (`src/ts/process/processzip.ts:364-370`, `src/ts/process/processzip.ts:396-405`, `src/ts/process/processzip.ts:466-472`), and the character importer turns any nonempty exclusion list into a hard failure before parsing/creating the character (`src/ts/characterCards.ts:271-289`).
- **Baseline behavior:** Original also omitted an entry whose completed data exceeded 50 MiB (`/home/codex/risu-baseline-71c476e9c/src/ts/process/processzip.ts:335-366`), but the caller never treated `excludedFiles` as fatal: it read `card.json`, waited for the importer, and created the character with the remaining material (`/home/codex/risu-baseline-71c476e9c/src/ts/characterCards.ts:128-161`).
- **Consequence / repro:** Import a valid `.charx` with a small `card.json` plus an otherwise optional/unreferenced `assets/big.bin` (or `module.risum`) larger than 50 MiB. Original creates the character and silently omits that entry. Current reports an incomplete-card error and creates no character.
- **Charter classification:** `decide` — tolerant parity risks a visibly incomplete card; fail-closed safety rejects an Original-accepted file.
- **Confidence:** high

### F-4 — An oversized inline data URI now aborts the card instead of dropping only that asset

- **Severity:** med
- **Current behavior:** when a V3 asset's `data:` URI base64 portion reaches the 50 MiB threshold, current throws and aborts the import (`src/ts/characterCards.ts:985-1003`).
- **Baseline behavior:** Original showed `Data URI too large`, skipped that asset with `continue`, and went on to construct the character (`/home/codex/risu-baseline-71c476e9c/src/ts/characterCards.ts:868-877`, `/home/codex/risu-baseline-71c476e9c/src/ts/characterCards.ts:995-1019`).
- **Consequence / repro:** Import a valid V3 character JSON whose `data.assets[0].uri` is a base64 `data:` URI of at least 50 MiB and whose rest of the card is valid. Original creates the card without asset 0 after a warning. Current creates nothing.
- **Charter classification:** `decide` — this is the same partial-import versus fail-closed tradeoff as F-3, reached through a distinct Original-accepted file shape.
- **Confidence:** high

### F-5 — Kobold URL normalization does not match the fork point

- **Severity:** med
- **Current behavior:** current always segment-joins the suffix `/api/v1/generate`; a configured `/api/v1` therefore becomes `/api/v1/generate`, and an arbitrary `/custom` becomes `/custom/api/v1/generate` (`server/fastify/src/generation/kobold.ts:78-95`, `server/fastify/src/generation/kobold.ts:126-139`).
- **Baseline behavior:** Original replaced the path only when `url.pathname.length < 3`; otherwise it posted to the user-supplied path unchanged (`/home/codex/risu-baseline-71c476e9c/src/ts/process/request/request.ts:952-963`, `/home/codex/risu-baseline-71c476e9c/src/ts/process/request/request.ts:981-999`). Both templates store `http://localhost:5001/api/v1` as the default (`src/ts/process/templates/templates.ts:250-260`; `/home/codex/risu-baseline-71c476e9c/src/ts/process/templates/templates.ts:246-255`).
- **Consequence / repro:** Use the shared default URL and a compatibility server that exposes POST `/api/v1` but not `/api/v1/generate`. Original posts to `/api/v1` and succeeds; current posts to `/api/v1/generate` and receives a 404. A custom non-root path diverges in the same way.
- **Charter classification:** `fix` — the delta's canonical endpoint behavior may be more useful for modern Kobold servers, but it is not the claimed fork-point URL rule and needs compatibility gating if retained.
- **Confidence:** high

### F-6 — Ooba Legacy WebSocket streaming is no longer available

- **Severity:** med
- **Current behavior:** the settings UI renders disabled Streaming/Half-streaming controls plus a buffered-only notice for an Ooba-Legacy-only configuration (`src/lib/Setting/Pages/BotSettings.svelte:1789-1806`). Dispatch always wraps `runOobaLegacy` as a buffered result (`server/fastify/src/prompt/chatDispatch.ts:1580-1634`), and that adapter performs a complete HTTP fetch/body parse (`server/fastify/src/generation/oobaLegacy.ts:218-263`).
- **Baseline behavior:** Original derived both stream and blocking endpoints (`/home/codex/risu-baseline-71c476e9c/src/ts/process/request/request.ts:645-654`) and, when `useStreaming` was true, opened the WebSocket, emitted cumulative text chunks, and returned a streaming response (`/home/codex/risu-baseline-71c476e9c/src/ts/process/request/request.ts:703-748`). Its settings exposed both Blocking and Stream provider URLs (`/home/codex/risu-baseline-71c476e9c/src/lib/Setting/Pages/BotSettings.svelte:461-471`).
- **Consequence / repro:** Restore an Original full backup with the Mancer/Ooba-Legacy model, `useStreaming: true`, a working `wss://.../api/v1/stream`, and a working blocking URL, then send a message. Original renders incremental WebSocket output. Current disables the setting and waits for a complete HTTP response; long responses show no token-by-token progress.
- **Charter classification:** `decide` — restoring the retired browser WebSocket transport has architectural/security cost, but the loss of incremental display is directly user-visible and has no charter sign-off in `ADJUDICATION.md`.
- **Confidence:** high

### F-7 — Current CharX exclusions are not semantically readable by Original

- **Severity:** low
- **Current behavior:** V3 export starts with the stored `prebuiltAssetExclude` values (`src/ts/characterCards.ts:1857-1861`), rewrites an embedded asset URI to `embeded://...`, and rewrites an equal exclusion reference to that transformed URI (`src/ts/characterCards.ts:1522-1539`, `src/ts/characterCards.ts:1625-1668`). Current's own importer later maps packaged references back to imported asset IDs (`src/ts/characterCards.ts:123-147`, `src/ts/characterCards.ts:1159-1163`).
- **Baseline behavior:** Original resolves an `embeded://` asset URI to the newly saved `imgp` value used in `additionalAssets` (`/home/codex/risu-baseline-71c476e9c/src/ts/characterCards.ts:861-899`) but preserves `prebuiltAssetExclude` literally (`/home/codex/risu-baseline-71c476e9c/src/ts/characterCards.ts:1005-1010`). `{{chardisplayasset}}` filters by exact equality against the stored asset ID (`/home/codex/risu-baseline-71c476e9c/src/ts/cbs.ts:1487-1504`).
- **Consequence / repro:** In current, give a character one additional asset and place that asset's server ID in `prebuiltAssetExclude`; export V3 CharX and import it in Original. Original saves the embedded bytes under its own asset path but leaves the exclusion as `embeded://...`, so the equality check misses and `{{chardisplayasset}}` exposes an asset that was excluded before export.
- **Charter classification:** `fix` — make the exported exclusion value match the deterministic asset reference Original will assign, while retaining current's normalization for current-to-current imports.
- **Confidence:** high

### F-8 — Incomplete bundle restore has a new user-visible completion result

- **Severity:** low
- **Current behavior:** after a successful restore, current computes missing/orphaned asset counts (`server/fastify/src/routes/save.ts:560-597`) and replaces the ordinary success notice with a localized “success with asset caveats” notice when either count is nonzero, while still returning `ok` (`src/ts/storage/backup.ts:79-104`).
- **Baseline behavior:** Original applies `database.risudat`, streams whatever asset records are present, and finishes with the undifferentiated `Success` alert (`/home/codex/risu-baseline-71c476e9c/src/ts/drive/backuplocal.ts:436-485`). Its exporter can produce a backup whose database still references skipped missing assets (`/home/codex/risu-baseline-71c476e9c/src/ts/drive/backuplocal.ts:71-96`, `/home/codex/risu-baseline-71c476e9c/src/ts/drive/backuplocal.ts:160-178`).
- **Consequence / repro:** Import an Original `.bin` whose `database.risudat` references `assets/missing.png` but whose archive omits that record, or one that carries an unreferenced asset record. Both versions apply the database and available files. Original shows only `Success`; current explicitly reports the missing/orphaned count. This is not a stricter acceptance path, but it is an exact UI-result divergence introduced by the named delta entry point.
- **Charter classification:** `decide` — the warning is truthful and non-destructive, but it is visible and therefore requires an individual decision under the exact-parity charter.
- **Confidence:** high

### F-9 — Cold-storage stubs now block chat export

- **Severity:** med
- **Current behavior:** single-chat export strictly hydrates the selected chat and then rejects any remaining cold-storage pointer (`src/ts/characters.ts:454-491`). Export-all strictly hydrates every chat and applies the same guard before serialization (`src/ts/characters.ts:1105-1128`). A missing/corrupt cold-storage record therefore produces an error and no file.
- **Baseline behavior:** Original's single-chat JSON export serializes the selected chat directly (`/home/codex/risu-baseline-71c476e9c/src/ts/characters.ts:192-232`), and export-all directly serializes `char.chats` (`/home/codex/risu-baseline-71c476e9c/src/ts/characters.ts:507-525`), with no export-time hydration or stub guard.
- **Consequence / repro:** Use a valid Original-era character whose older chat's first message is `\uEF01COLDSTORAGE\uEF01missing-key` and whose backing cold-storage item is absent, then choose Export All Chats. Original downloads a version-2 JSON file containing the pointer stub. Current blocks the entire export and names the affected chat. The current outcome avoids presenting a pointer as transcript content, but it rejects an action Original completed.
- **Charter classification:** `decide` — exact parity would emit an incomplete/misleading transcript; current's fail-closed behavior is safer but user-visible.
- **Confidence:** high

## Areas swept and found clean

- **Ordinary character cards:** V2/V3 JSON and PNG, and CharX files whose entries and inline assets stay below the shared limits, retain the baseline card/lore/asset structure. Apart from F-3/F-4, the truthful create/import settlement did not reveal another valid Original-produced card shape newly rejected by current.
- **CHAT JSON/HTML envelopes:** ordinary `risuChat` and `risuAllChats` version-2 exports keep the same `type`/`ver`/`data`/`folders` envelope as Original (`src/ts/characters.ts:510-525`, `src/ts/characters.ts:1119-1128`; baseline `/home/codex/risu-baseline-71c476e9c/src/ts/characters.ts:220-232`, `/home/codex/risu-baseline-71c476e9c/src/ts/characters.ts:507-521`). F-9 is the remaining export-acceptance edge.
- **Whole-database writers:** current emits the same ROOT/resource/`CHARACTER_WITH_CHAT` block families as Original (`server/fastify/src/risuSave/exportSnapshot.ts:125-190`; baseline `/home/codex/risu-baseline-71c476e9c/src/ts/storage/risuSave.ts:140-199`). Current also exposes a dedicated Original-style `.bin` writer, so the additive `.risu.zip` option is not the only device-export path (`src/ts/storage/backup.ts:37-70`, `server/fastify/src/risuSave/localBackupExport.ts:50-86`). Missing/orphaned assets do not reject bundle import; F-8 is limited to the completion notice.
- **Schema leakage:** SQLite schema version 31 is server-internal (`server/fastify/src/db.ts:25`). Portable output uses the legacy block config version 1 and an additive `__risuServerData.version: 1` root field (`server/fastify/src/risuSave/exportSnapshot.ts:115-122`, `server/fastify/src/risuSave/exportSnapshot.ts:175-190`); Original ignores root keys beginning with `__` (`/home/codex/risu-baseline-71c476e9c/src/ts/storage/risuSave.ts:486-495`). I found no v27-v31 table/schema gate serialized into card, CHAT, preset, `.risu`, or legacy `.bin` formats.
- **Translation change `4ed196b1f`:** current separates stored-translation display from request eligibility, so bot-only mode can display a stored user translation without issuing a new user translation request (`src/lib/ChatScreens/Chat.svelte:860-867`, `src/lib/ChatScreens/Chat.svelte:1608-1644`). Original has neither persisted `Message.translation` nor bot-only/bilingual settings and translated all eligible mounted rows through `translateHTML` (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/ChatBody.svelte:67-103`). No same-state fork-point format/display regression attributable specifically to `4ed196b1f` could be constructed.

## Could not verify

- I did not execute generated 50+ MiB binary fixtures or destructive whole-database restore fixtures because the assignment permits writing only this report. The findings above are source-level control-flow comparisons; all cited branches and writer/reader pairs were cross-checked, but byte-level runtime execution remains for consolidation tests.
- Bot-only and bilingual translation states have no fork-point equivalent, so only the shared translation control flow could be compared; provider-produced translated bytes were not compared against a live translation service.
