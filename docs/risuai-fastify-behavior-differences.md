# Original RisuAI vs Fastify Variant: shared-feature behavior divergence audit

Audit date: 2026-07-11

## Scope

This report compares:

- Original RisuAI: `/home/codex/Risuai`, commit `b201b1b0f0dac6424f9c2dc2fa56b0fcfa5e6198`, app version `2026.6.210`.
- Fastify Variant: `/home/codex/risuai-fastify`, commit `b9347698631033082424b70a62dabcf6b60e14b4`, app version `Fastify Variant Version: Alpha`.
- Common ancestor: `71c476e9c86263fe907105b011ca4dde0a619d66` from 2026-05-18.

The audit includes only behavior belonging to a feature that predates the split and is still retained or exposed in both applications. New Fastify-only features, new upstream-only features, and features deliberately removed from the Variant are excluded from the main finding count.

The comparison used source call-path tracing, current tests, post-split upstream fixes, and focused local probes. It did not send requests to live third-party model providers.

Path prefixes below are conceptual repository roots:

- `Original/...` means `/home/codex/Risuai/...`.
- `Variant/...` means `/home/codex/risuai-fastify/...`.

## Executive summary

The most serious differences are not cosmetic. The Fastify path can construct materially different provider requests, bypass request policies whose controls remain visible, reject otherwise valid legacy chat imports, lose non-media assets on backup restore, and include legacy account credentials that the original deliberately strips.

The audit identified 15 actionable potential bug points. Two additional differences are kept as runtime-test candidates rather than being called bugs from static evidence alone.

| ID  | Severity | Confidence | Shared feature | Fastify difference |
| --- | --- | --- | --- | --- |
| F01 | High | Very high | Provider message serialization and vision input | Internal prompt metadata is sent to providers and multimodal rows are not converted to provider-native image parts. |
| F02 | High | Very high | Generation parameters, bias, tools, reasoning, multi-generation, and cache controls | Most configured controls are materialized but never reach the provider request. |
| F03 | High | Very high | Request triggers, retries, fallback models, banned-character retry, blank fallback, and Escape Output | The server path bypasses the original request wrapper implementing these policies. |
| F04 | High | Very high | Preview Request hotkey | The compact server response reduces an array-valued prompt to `''`; the hotkey then parses the empty string as JSON. |
| F05 | High | Very high | Chat import | Imported chat, message, and folder IDs are not re-keyed for the Variant's global uniqueness rules. Common imports can fail after an optimistic success message. |
| F06 | High | Very high | Local `.bin` backup restore | Export writes every referenced asset, while import silently discards `.onnx`, `.css`, `.json`, and other non-media records. |
| F07 | High (privacy) | High | Local `.bin` backup export | Legacy `account.token` and `account.id` are retained; the original explicitly removes them. |
| F08 | Medium-high | Very high | Hypa V3 memory manager | New server summaries are not loaded into the manager; it can show jobs and “no summaries,” with legacy controls forced read-only. |
| F09 | High | Very high | Imported Hypa V3 memory | Imported summaries use a sentinel model that active selection filters out, causing omission/re-summarization and metadata loss. |
| F10 | Medium-high | High | Remove Incomplete Response | The browser trims the live stream, but server finalization persists an untrimmed result. |
| F11 | Medium | Very high | CBS `reverse` | The Variant reverses the raw matcher, including `reverse::`; its regression test is skipped. |
| F12 | Medium | Very high | CBS `setdefaultvar` | Missing variables resolve to the truthy string `"null"`, so defaults are not installed. |
| F13 | Medium-high | High | Legacy `.risup` preset import | A full legacy preset becomes prompt-only; provider/model fields are dropped and parameter fields are usually inert. |
| F14 | Medium | Very high | Display → Fullscreen | The visible setting has an empty callback despite a working browser fullscreen helper elsewhere. |
| F15 | Medium | Very high | Ctrl+1…9 preset shortcuts | Shortcuts still address legacy `botPresets`, which are empty on a fresh Variant database, instead of the split/profile-first preset model. |

## Detailed findings

### F01 — Provider rows are not sanitized or converted to native multimodal content

Classification: likely incomplete provider port; severity high; confidence very high.

Original RisuAI performs provider-specific wire conversion. For OpenAI Chat Completions it converts `multimodals` into `image_url` content parts, blanks the internal NewChat marker, and deletes `memo`, `removable`, `attr`, `multimodals`, `thoughts`, and `cachePoint` before serialization. Anthropic, Gemini, and the Responses API have their own native media conversions.

The Variant's `reformatMessages` returns the original rows unchanged whenever role rewriting is unnecessary. `buildPayload` then assigns those rows directly to `messages`. Equivalent Fastify adapters for Anthropic, Gemini, and Responses also lack the original native media conversion.

Consequences:

- The literal `[Start a new chat]` marker can reach the model.
- Internal fields can cause strict OpenAI-compatible endpoints to reject the request.
- Vision models can receive a nonstandard `multimodals` property instead of actual image parts, so the image is effectively absent.
- Thought/cache metadata can leak or be silently ignored instead of receiving provider-specific treatment.

Evidence:

- Original OpenAI conversion and cleanup: `Original/src/ts/process/request/openAI/requests.ts:108-160`.
- Original Anthropic conversion: `Original/src/ts/process/request/anthropic.ts:100-224`.
- Original Gemini conversion: `Original/src/ts/process/request/google.ts:58-105`.
- Original Responses conversion: `Original/src/ts/process/request/openAI/responses.ts:123-160`.
- Variant returns row references for full-system models: `Variant/server/fastify/src/prompt/chatDispatch.ts:341-411`.
- Variant sends those rows directly: `Variant/server/fastify/src/generation/openai.ts:116-125`.
- The server still creates NewChat rows with `memo`: `Variant/server/fastify/src/prompt/history.ts:439-440`.
- Vision content passes preflight on vision-capable profiles: `Variant/src/ts/process/request/serverPromptAssembly.ts:181-193`.

A local fake-provider probe confirmed that the Fastify OpenAI body contained `[Start a new chat]`, `memo`, `removable`, `attr`, `thoughts`, and `multimodals`.

Recommended regression: golden-test the final wire body, not only the assembled prompt event, for text-only and image-bearing requests across OpenAI Chat, Responses, Anthropic, and Gemini.

### F02 — Most existing generation controls do not reach server provider dispatch

Classification: likely incomplete provider contract; severity high; confidence very high.

The Variant preserves the settings, exposes many of them in the UI, stores them in durable model profiles, and copies them into the effective runtime database. The main server dispatcher nevertheless derives only response tokens, temperature, and streaming for most providers. Horde is a partial exception for `top_k` and `top_p`.

| Control family | Original behavior | Fastify behavior |
| --- | --- | --- |
| `top_p`, `top_k`, `min_p`, `top_a`, repetition/frequency/presence penalties, per-role Separate Parameters | `applyParameters` selects global or separate values and writes supported provider fields. | Runtime fields are copied into the effective DB, but most dispatch arms pass only `temperature` and a token limit. |
| Seed, JSON schema, prediction, OpenRouter transforms/provider filters | OpenAI request shaping adds them when configured. | The server OpenAI request type/body has no corresponding fields unless a user manually reproduces some through Additional Parameters. |
| Logit bias / banned tokens | Original tokenizes bias strings, handles strong bans, and emits `logit_bias` or provider equivalents. | Assembly explicitly says no provider-level bias contract exists and does not compute or emit bias rows. |
| Reasoning/thought continuation and output | Original maps saved thoughts to provider reasoning fields and parses reasoning output. | Fastify OpenAI parsing reads only `message.content`/`delta.content`; reasoning fields are lost. |
| Function/model tools and hosted Responses tools | Original serializes tools and handles tool calls; Responses supports hosted tools. | OpenAI Chat has no tool field; Responses hardcodes `tools: []`. |
| `genTime` multi-generation | Original sends `n` and returns all choices/rerolls. | Server payload has no `n` and response parsing selects one choice. |
| Anthropic prompt cache points | Original converts `cachePoint` to native `cache_control`. | Fastify retains prompt metadata but does not emit cache controls. |

Evidence:

- Runtime profile fields: `Variant/src/ts/model/modelProfileRecords.ts:74-104`.
- Effective DB materialization: `Variant/server/fastify/src/prompt/effectiveGenerationConfig.ts:175-220`.
- Server dispatch reads mostly token limit/temperature/streaming: `Variant/server/fastify/src/prompt/chatDispatch.ts:785-1078`.
- OpenAI body contains only model/messages/stream/tokens/temperature: `Variant/server/fastify/src/generation/openai.ts:19-43,116-125`.
- Variant OpenAI response types only expose content, not reasoning fields: `Variant/server/fastify/src/generation/openai.ts:191-199,277-288`.
- Bias omission is explicit: `Variant/server/fastify/src/prompt/assemble.ts:1487-1488`.
- Responses hardcodes an empty tool list: `Variant/server/fastify/src/generation/openaiResponses.ts:154-164`.
- Original parameter application: `Original/src/ts/process/request/shared.ts:137-340`.
- Original OpenAI bias/settings/schema/tools: `Original/src/ts/process/request/openAI/requests.ts:185-203,348-499`.
- Original multi-generation: `Original/src/ts/process/request/openAI/requests.ts:565-573,851-865`.

Recommended regression: create a provider-by-setting matrix that asserts final outgoing bodies, including profile overrides and Separate Parameters. Preview/assembly snapshots are insufficient because the loss occurs later at dispatch.

### F03 — Server dispatch bypasses the original request-policy wrapper

Classification: incomplete server orchestration; severity high; confidence very high.

Original RisuAI wraps provider dispatch in a loop that performs several pre-existing policies:

- Run the declarative `request` trigger and accept its rewritten prompt.
- Retry provider failures up to `requestRetrys`.
- Move through configured fallback models.
- Retry output containing a banned character set.
- Fall back when a response is blank.
- Unescape prompt content, force non-streaming, and re-escape output for a character with Escape Output enabled.

Normal Variant sends route directly to one server provider dispatch. The server trigger implementation includes a `request` mode, but the assembly/finalization call path never invokes it. The server request envelope also contains no Escape Output flag. These controls remain visible and persisted, so users receive no indication that they are inactive.

Evidence:

- Original wrapper: `Original/src/ts/process/request/request.ts:205-345`.
- Original request trigger: `Original/src/ts/process/request/request.ts:245-260`.
- Original Escape Output: `Original/src/ts/process/request/request.ts:212-219,281-283`.
- Variant single inline dispatch: `Variant/server/fastify/src/routes/generationChat.ts:1655-1665`; durable dispatch: `:2572-2582`.
- Variant assembly invokes input/start/output phases but no request phase: `Variant/server/fastify/src/prompt/assemble.ts:854-959,1979-1988,2151-2225`.
- Request retries remain exposed: `Variant/src/ts/setting/advancedSettingsData.ts:74-82`.
- Fallback models remain exposed: `Variant/src/lib/Setting/Pages/PromptSettings.svelte:1119-1147`.
- Escape Output remains exposed: `Variant/src/lib/SideBars/CharConfig.svelte:1908`.

Recommended regression: use a deterministic fake provider that fails once, returns blank once, and then succeeds; assert request-trigger rewrites, retry count, fallback selection, banned-set handling, and escaping on the actual `/generate/chat` route.

### F04 — Preview Request returns an empty body and can throw in the hotkey handler

Classification: likely direct bug; severity high; confidence very high.

The original Preview Request hotkey asks the selected provider builder for a JSON description of its URL/body/headers. The hotkey parses that JSON and shows it.

The Variant instead asks server prompt assembly for `promptInfo.promptText`. That field is typed and populated as `OpenAIChat[]`, but compact-capable clients ask the server to retain it only when it is a string. The normal client always advertises compact support, so the route returns `""`. The client again requires a string and stores `""`; the hotkey then executes `JSON.parse(previewBody)`.

Evidence:

- Shared hotkey JSON parse: `Variant/src/ts/hotkey.ts:144-159`; `Original/src/ts/hotkey.ts:127-142`.
- Original provider preview capture: `Original/src/ts/process/index.svelte.ts:1494-1517` and `Original/src/ts/process/request/openAI/requests.ts:599-660`.
- Variant client always advertises compact prompts: `Variant/src/ts/process/request/serverChat.ts:39-40,239-250`.
- Variant prompt field is an array: `Variant/server/fastify/src/prompt/assemble.ts:495-496,1884,2012`.
- Compact route converts non-strings to empty string: `Variant/server/fastify/src/routes/generationChat.ts:213-224`.
- Browser adapter repeats the string-only check: `Variant/src/ts/process/serverBackedSendChat.ts:304-307`.
- The focused server test checks only `typeof === 'string'`, so `""` passes: `Variant/server/fastify/__tests__/generation.chat.test.ts:4607-4627`.

Recommended regression: invoke the real hotkey path against an assembled OpenAI prompt and assert valid parseable JSON with redacted credentials, or deliberately redefine the feature as an assembled-prompt preview and update both the UI and contract.

### F05 — Common chat imports violate the Variant's global ID invariants

Classification: likely import-port bug; severity high; confidence very high.

The retained browser importer mostly follows the original assumptions: it re-keys a v2 chat ID, re-keys a folder only when it collides inside the selected character, and leaves nested message IDs untouched. HTML import can preserve the chat ID, and Tavern JSONL creates messages without Risu `chatId` values.

The Fastify command API has stronger rules: chat IDs, message IDs, and folder IDs are globally unique, and every message ID must be non-empty. Consequently:

- A Tavern JSONL import can fail because its messages have no IDs.
- Exporting and re-importing a non-empty Risu chat can fail because message IDs collide.
- HTML round-trip can fail because the chat ID is preserved.
- A folder ID accepted by the browser's selected-character check can collide with another character.

The import is optimistic and shows a success alert immediately after dispatch, before the async command rejection/reconciliation completes.

Evidence:

- Variant v2/HTML/JSONL import behavior: `Variant/src/ts/characters.ts:675-753,780-822`.
- Command snapshots clone rather than re-key: `Variant/src/ts/chatCommands.ts:2372-2374`.
- Server requires message IDs: `Variant/server/fastify/src/commands/messages.ts:88-99,122-128`.
- Server rejects global chat/message duplicates: `Variant/server/fastify/src/routes/commands.ts:4173-4206`.
- Original directly inserts the same formats without the server invariants: `Original/src/ts/characters.ts:422-448,490-496`.

Recommended regression: round-trip each supported chat export format into the same instance and another character, asserting fresh chat/folder/message IDs and rewritten bookmark/memo references before displaying success.

### F06 — Local `.bin` restore discards valid non-media assets written by export

Classification: definite exporter/importer asymmetry; severity high/data loss; confidence very high.

The Fastify repository supports media, fonts, ONNX models, CSS, and JSON/signature assets. Local backup export writes every referenced asset as `<id>.<ext>` without filtering by MIME type. The matching legacy `.bin` importer stages only image, audio, video, and font content types; all other records are silently skipped as if they were browser-local cold-storage data.

The database references therefore survive while the corresponding `.onnx`, `.css`, `.json`, or other non-media bytes disappear.

Evidence:

- Supported content types: `Variant/server/fastify/src/repository.ts:32-56`.
- Export enumerates all referenced assets: `Variant/server/fastify/src/risuSave/localBackupExport.ts:55-68,120-130`.
- Import's media-only filter: `Variant/server/fastify/src/risuSave/localBackupImport.ts:42-60,325-341`.
- Original loader stores every non-cold-storage record as an asset: `Original/src/ts/drive/backuplocal.ts:535-565`.

Recommended regression: import a module containing ONNX/CSS/JSON assets, export a local backup, restore into an empty data directory, and byte-compare every referenced asset.

### F07 — Local backups retain legacy account credentials

Classification: likely privacy/security regression; severity high; confidence high.

Original RisuAI explicitly creates `dbWithoutAccount` before encoding `database.risudat`. The Variant loads and encodes the full persisted database. Its normalization preserves arbitrary root fields, and the current database type still includes `account.token` and `account.id`.

This matters for migrated databases even if the Fastify architecture no longer uses the old account flow: obsolete credentials should not silently move into portable device backups.

Evidence:

- Original strips the field: `Original/src/ts/drive/backuplocal.ts:180-193`.
- Variant exports the full persisted snapshot: `Variant/server/fastify/src/routes/save.ts:265-294`.
- Snapshot normalization does not omit account: `Variant/server/fastify/src/risuSave/exportSnapshot.ts:34-40,160-167`.
- Credential shape remains declared: `Variant/src/ts/storage/database.svelte.ts:2148-2152`.

Recommended regression: seed a legacy account token, export `.bin`, decode `database.risudat`, and assert that the entire `account` field is absent. Decide the separate `.risu.zip` redaction policy explicitly rather than inheriting it accidentally.

### F08 — The Hypa V3 manager does not load live server summaries

Classification: incomplete server-memory UI port; severity medium-high; confidence very high.

Server memory mode is always enabled. Summarization jobs write summaries to the server memory tables, and a browser function to list those summaries exists. The visible modal nevertheless derives its list only from legacy `currentChat.hypaV3Data`. In server mode it mounts a job list, then still renders the legacy summary array. It also forces the legacy rows read-only and hides Important, reroll, delete, bulk edit, category, and tag management.

Observable result: after a successful server summary job, the manager can show the job and “no summaries.” New server summaries cannot use the original Important-summary workflow.

Evidence:

- Server memory is always selected: `Variant/src/ts/process/request/serverMemory.ts:65-67`.
- Jobs persist summary rows: `Variant/server/fastify/src/memorySummarizeJobHandler.ts:388-414`.
- Summary-list API exists: `Variant/src/ts/process/request/serverMemory.ts:161-169`.
- Modal reads legacy data and only mounts server jobs: `Variant/src/lib/Others/HypaV3Modal.svelte:36-48,620-711`.
- Management controls are hidden/read-only: `Variant/src/lib/Others/HypaV3Modal.svelte:718-755` and `Variant/src/lib/Others/HypaV3Modal/modal-summary-item.svelte:415-450`.
- Original creates/prioritizes editable Important summaries: `Original/src/ts/process/memory/hypav3.ts:440-464,501-525`.

Recommended regression: complete a real summarize job, open the modal, and assert the server summary is listed and that supported metadata operations round-trip through server APIs.

### F09 — Imported Hypa V3 summaries are filtered out and re-summarized

Classification: likely migration bug; severity high; confidence very high.

Fastify backfills legacy `hypaV3Data` into server memory tables with the fixed model name `legacy-hypav3`. Active memory selection and planning filter summaries by exact equality with the currently configured summarization model. Unless the active model is literally `legacy-hypav3`, imported rows are invisible to selection and planning schedules new summaries for the same chunks.

The original reads `room.hypaV3Data.summaries` directly, independent of a model-name column. Re-summarization can also replace rich legacy metadata: Important state, category, tags, and the full set of chat memos are not reconstructed by the follow-up job payload.

Evidence:

- Legacy sentinel model: `Variant/server/fastify/src/memoryLegacyImport.ts:5,83-110`.
- Exact-model selection: `Variant/server/fastify/src/memorySelectionService.ts:101-116`.
- Planning filters and enqueues the active model: `Variant/server/fastify/src/prompt/assemble.ts:1612-1638,1686-1707`.
- Follow-up payload keeps at most the chunk's single message ID: `Variant/server/fastify/src/prompt/memoryFollowups.ts:62-79`.
- Original uses chat summaries directly: `Original/src/ts/process/memory/hypav3.ts:199-228,978-1008`.
- Original metadata shape: `Original/src/ts/process/memory/hypav3.ts:77-87,1620-1643`.

Recommended regression: import a `.risu` with one Important/category/tagged summary, send once with a normal summary model, and assert the existing summary is immediately selectable without a duplicate summarize job or metadata loss.

### F10 — Remove Incomplete Response is not authoritative on server-owned results

Classification: likely server-finalization omission; severity medium-high; confidence high.

The Variant's live browser renderer still calls `trimUntilPunctuation` when the setting is enabled. Server post-generation only applies `.trim()`, edit-output scripts, CBS, and output triggers. It then persists that server-derived text as the authoritative assistant message.

Therefore the stream can look correctly trimmed while the stored row remains untrimmed; reconciliation or reload can restore the trailing fragment. If post-generation emits `finalText`, the terminal pass can overwrite the optimistic display immediately.

Evidence:

- Variant live trimming: `Variant/src/ts/process/postGeneration/streamResponse.ts:194-204` and non-stream trimming at `Variant/src/ts/process/postGeneration/nonStreamResponse.ts:66-79`.
- Server finalization trims whitespace only: `Variant/server/fastify/src/prompt/assemble.ts:2080-2083,2409-2465`.
- Server persists `postGen.finalText`: `Variant/server/fastify/src/routes/generationChat.ts:1339-1374`.
- Browser applies server terminal text/patch: `Variant/src/ts/process/serverBackedSendChat.ts:525-576`.
- Original trims the same value it keeps in the chat: `Original/src/ts/process/index.svelte.ts:1572-1605,1634-1656`.

Recommended regression: stream a completion ending in an unfinished sentence, wait for server finalization, reload the chat, and assert identical trimmed text at every stage.

## Confirmed medium-sized mismatches

### F11 — CBS `reverse` reverses the matcher instead of the argument

Variant callback: `Variant/src/ts/cbs.ts:2513-2516` uses `str`. Original callback: `Original/src/ts/cbs.ts:2122-2125` uses `args[0]`. The Variant test documents the defect and is skipped at `Variant/src/ts/parser/tests/cbs/strings.test.ts:178-193`; the equivalent original test runs at `Original/src/ts/parser/tests/cbs/strings.test.ts:150-163`.

This is an existing CBS function, not a new feature. Original fixed it in post-split commits `2a83b027` and `0999071b`.

### F12 — CBS `setdefaultvar` does not set a missing variable

Both Variant chat-var backends return the literal string `"null"` for an absent key: `Variant/src/ts/parser/chatVar.svelte.ts:9-29` and `Variant/server/fastify/src/prompt/promptScope.ts:42-58`. The Variant callback tests only falsiness at `Variant/src/ts/cbs.ts:1112-1123`; `"null"` is truthy. Original also checks `currentValue === 'null'` at `Original/src/ts/cbs.ts:843-855`.

Original fixed this existing function in post-split commits `a39efb21` and `0999071b`.

### F13 — Legacy full `.risup` files import as prompt-only presets

Original exports and imports the complete `botPreset`, including provider/model/runtime fields: `Original/src/ts/storage/database.svelte.ts:2271-2305,2320-2344,2475-2479`.

Variant export is intentionally prompt-preset-only, and legacy import ends in `addImportedPromptPreset`: `Variant/src/ts/storage/database.svelte.ts:4272-4301,4465-4469`. The prompt filter is at `Variant/src/ts/storage/database.svelte.ts:3774-3792`; provider/model fields are classified separately in `Variant/src/ts/presetSplit.ts:3-143`. Old files do not carry the new `overrideModelParameters` flag, so even copied temperature/penalty values are usually inert.

Importing an older preset should either split it into model and prompt presets or clearly warn which fields will be discarded.

### F14 — Display → Fullscreen is an enabled no-op

The Variant setting's callback is empty: `Variant/src/ts/setting/displaySettingsData.svelte.ts:271-279`. A working browser `toggleFullscreen` already exists at `Variant/src/ts/globalApi.svelte.ts:1415-1427` and is used by `Variant/src/lib/Others/GithubStars.svelte:39-45`. Original wires its setting to fullscreen behavior at `Original/src/ts/setting/displaySettingsData.svelte.ts:250-258`.

### F15 — Ctrl+1…9 shortcuts target an empty legacy preset list

Variant hotkeys still call `changeToPreset` against `db.botPresets`: `Variant/src/ts/hotkey.ts:198-254,437-445`. Fresh normalization initializes that list to `[]` and instead creates model/prompt presets: `Variant/src/ts/storage/database.svelte.ts:964-989`. The shortcut prevents the browser default but performs no switch.

Original initializes a default `botPreset` at `Original/src/ts/storage/database.svelte.ts:156-163`, so the same hotkey path has a valid target. Variant shortcuts should address the currently supported preset/profile concept or be removed from the default map.

## Candidates needing runtime checks

### C01 — Fastify `.bin` may not restore its assets correctly in original RisuAI

The Variant claims original-Risu local-backup compatibility at `Variant/src/ts/server/backups.ts:180-187`. Fastify database references are raw SHA asset IDs, while local backup records are named `<sha>.<ext>`: `Variant/src/ts/globalApi.svelte.ts:157-160` and `Variant/server/fastify/src/risuSave/localBackupExport.ts:62-67`. Snapshot export does not rewrite those references.

Original restore stores bytes under `assets/<name>` but later looks up the database string exactly: `Original/src/ts/drive/backuplocal.ts:558-563` and `Original/src/ts/globalApi.svelte.ts:209-220`. Static tracing therefore predicts a reference `<sha>` with bytes stored under `assets/<sha>.<ext>`, producing missing images after a Fastify backup is loaded by original RisuAI.

This is high-confidence static evidence but was not browser-tested in this audit. Keep it separate until one avatar backup is round-tripped from Fastify to original.

### C02 — Server-authoritative commands may expose stale-state races

`canUseServerCommands()` always returns true in the Variant: `Variant/src/ts/server/commands.ts:1402-1404`. Delete/truncate, edit, disable, disable-above, role swap, bookmark rename/remove, and related actions dispatch commands without first changing the authoritative local projection. Examples are at:

- `Variant/src/lib/ChatScreens/Chat.svelte:540-650,1880-1938,2231-2253`.
- `Variant/src/lib/Others/BookmarkList.svelte:97-145`.
- Command-only helpers: `Variant/src/ts/chatCommands.ts:2623-2723`.
- Parent passes message text unbound: `Variant/src/lib/ChatScreens/Chats.svelte:143-169`.

Original updates the displayed state immediately: `Original/src/lib/ChatScreens/Chat.svelte:84-121,837-852,1096-1104` and `Original/src/lib/Others/BookmarkList.svelte:93-107`.

The Variant's bookmark test explicitly requires the old projection to remain after dispatch: `Variant/src/lib/Others/projectionGuard.test.ts:157-195`. Visible latency is therefore a confirmed architectural difference, not evidence by itself of an incomplete migration. Rapid double toggles deriving the same next value and child-local edit text diverging during rollback are plausible consequences, but need browser E2E reproduction before being filed as bugs.

## Deliberate or documented compatibility differences

The following are behavior differences in shared legacy surfaces, but the Variant code explicitly treats them as architectural/safety constraints. They should be documented to users and covered by clear error-path tests rather than filed as accidental parity bugs without further product direction.

| ID  | Shared feature | Original behavior | Fastify behavior and evidence | Risk |
| --- | --- | --- | --- | --- |
| D01 | Provider selection | Dispatches NovelAI, NovelList, Ooba, Plugin, and WebLLM formats. | These formats are explicitly unroutable in `Variant/src/ts/process/request/providerCapability.ts:86-146,304-348`, while the server preflight hard-fails at `Variant/src/ts/process/request/serverPromptAssembly.ts:235-309`. | Imported provider selections that remain visible cannot send. |
| D02 | Non-vision image/inlay handling | Captions an image with browser `runImageEmbedding` and sends the caption: `Original/src/ts/process/index.svelte.ts:879-897`. | Hard-fails non-vision image/asset/inlay content because no server captioner exists: `Variant/src/ts/process/request/serverPromptAssembly.ts:181-193`. | Existing non-vision image workflows become errors. |
| D03 | Plugin V2 hooks and local storage | Runs V2 replacer/edit hooks and always exposes safe local/IndexedDB storage. | V2 generation hooks are permanently unsupported at `Variant/src/ts/process/request/serverPromptAssembly.ts:91-106,202-205`; local storage throws unless Plugin Compatibility Mode is enabled at `Variant/src/ts/plugins/pluginSafeClass.ts:10-20`. | Older plugins fail or behave differently; compatibility mode does not restore generation hooks. |
| D04 | Lua and legacy trigger effects | Browser host functions provide dialogs/UI effects, similarity and image generation, persona-derived text/images, activated-lore loading, and the full declarative effect surface: `Original/src/ts/process/scriptings.ts:123-147,267-285,363-411,693-805`. | Fastify supports `LLMMain`/`axLLMMain` and exact lore reads/upserts, but interactive Lua throws, browser UI functions no-op, and similarity, image generation, persona-derived values/images, and activated-lore loading return empty/errors: `Variant/server/fastify/src/prompt/luaRuntime.ts:1079-1118,1178-1202,1434-1525,1546-1565`. Verified unsupported declarative arms—including command, alert/LLM/image/similarity/regex, persistent-resource/persona/note effects, UI/chat update, wait, and plugin trigger code—fall through as no-ops at `Variant/server/fastify/src/prompt/triggers.ts:37-55,1462-1480`. | Existing cards can silently omit side effects or abort generation. |
| D05 | Complex regex scripts/lore | Uses normal JavaScript `RegExp` directly. | Default strict mode caps pattern/haystack/replacement and rejects nested unbounded quantifiers; worker mode is opt-in: `Variant/server/fastify/src/prompt/boundedRegex.ts:4-12,105-169,176-216` and `Variant/src/ts/storage/database.svelte.ts:1036-1053`. | Previously accepted cards can fail pre-provider dispatch. |
| D06 | Preset Chain | Randomly selects a configured legacy preset before send: `Original/src/ts/process/index.svelte.ts:189-203`. | Explicitly skipped in server-backed mode: `Variant/src/ts/process/sendChatContext.ts:108-139`, even though the setting remains visible. | A visible setting has no live effect. |
| D07 | Streaming edit-output scripts | Applies edit-output transforms to each growing stream update. | Shows raw reformatted text while streaming and applies server-owned edit-output only at terminal completion: `Variant/src/ts/process/postGeneration/streamResponse.ts:141-159` and `Variant/server/fastify/src/prompt/assemble.ts:2085-2105`. | Text intended to be redacted can be briefly visible. |
| D08 | Responses API streaming | Uses a true streaming Responses implementation. | Buffers `runOpenAIResponses` and wraps the final result as one token frame: `Variant/server/fastify/src/prompt/chatDispatch.ts:972-988`. | Different cancellation/progress behavior and delayed display. |
| D09 | Token budgeting | Uses provider/model/custom tokenizers and counts multimodal image cost: `Original/src/ts/tokenizer.ts:81-110,421-438`. | Uses text-only `cl100k_base`/`o200k_base` heuristics and explicitly excludes image-token math: `Variant/server/fastify/src/prompt/tokens.ts:4-16` and `Variant/server/fastify/src/prompt/budgetFinalize.ts:21-23`. | Near context limits, history/lore selection and overflow behavior can differ. |

## Excluded from the main findings

The following were intentionally not counted because they do not satisfy the “existing in both, not newly added” constraint:

- Fastify Agent Presets, durable model profiles, split preset/loadout features, projection APIs, and other Variant additions.
- The Fastify-only prompt-preset export/import-as-copy issue: export preserves its stable ID and same-instance import is rejected as a duplicate. It is worth fixing, but split prompt presets did not exist in both audited applications.
- Upstream features added after the fork rather than merely fixing an old feature.
- Group chat, peer sync, Drive/account sync, Tauri/native-only integrations, legacy Supa/Hypa V2/Hanurai paths, and auto-continue where the Variant removed the surface rather than retaining a differently behaving implementation.
- Bugs from older Variant audit documents that are fixed at the audited commit, including the former translator projection write, double-send window, empty aborted assistant bubble, and staged-bundle-asset issue.

## Recommended regression plan

### P0 — Provider and data safety

1. Add final-wire golden tests for F01 and F02. Assert only provider-legal fields and provider-native image parts, then vary every visible runtime/profile setting.
2. Add `/generate/chat` orchestration tests for F03: request trigger, transient retry, fallback model, blank fallback, banned character set, and Escape Output.
3. Add full `.bin` round-trip tests for F06 and secret-redaction tests for F07.
4. Round-trip every supported chat import format under global ID collisions for F05.
5. Add a real hotkey-to-route Preview Request test for F04; do not stub `promptText` as a string when production assembly returns rows.

### P1 — Memory and output consistency

1. Connect the Hypa manager to `listServerMemorySummaries` and test create/list/edit/delete/Important workflows for F08.
2. Import tagged/Important legacy summaries and assert immediate selection without re-summarization for F09.
3. Compare streamed display, terminal projection, persisted SQLite data, and reload output for F10.
4. Unskip the Variant CBS reverse test and add missing-variable tests against both browser and server backends for F11/F12.

### P2 — Presets and UI

1. Test old full `.risup` migration into both split preset types for F13.
2. Route Ctrl+1…9 to the supported preset/profile abstraction and test fresh installs for F15.
3. Wire the fullscreen setting or hide it where unavailable for F14.
4. Add rapid double-action and failed-command rollback E2E tests for message edits, disable toggles, copies, and bookmarks to resolve C02.
5. Perform the cross-application backup check described in C01.

## Verification performed

- `pnpm exec vitest run src/ts/parser/tests/cbs/strings.test.ts` in the Variant: 10 passed, 1 skipped. The skipped test is `reverse` and its comment describes F11.
- The same command in original RisuAI: 9 passed, including `reverse`.
- Focused Fastify server test for compact Preview Request: passed, but only because it asserts that `promptText` is a string; it does not reject the empty string.
- Local fake-provider inspection confirmed F01's OpenAI wire payload.
- No live provider calls or full browser E2E runs were made, so provider acceptance errors, C01, and C02 should still receive runtime confirmation.

## Bottom line

The Variant's main risk boundary is the transition from a mature browser request pipeline to server-owned assembly/dispatch. Many legacy settings and compatibility surfaces still exist, but their last-mile provider shaping, orchestration, or persistence step is missing. The first fixes should therefore target final wire payload tests and end-to-end round trips rather than more assembly-only snapshots.
