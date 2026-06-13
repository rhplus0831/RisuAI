# Network Transfer-Size Audit

Date: 2026-06-13.

Last updated: 2026-06-13. H2, H3, M2, L4, and the H1 immediate bootstrap duplicate were remediated after the initial audit.

This audit examines every place the server sends data to the client and every
place the client sends changes back, looking for endpoints that **transmit or
accept more data than necessary**. The goal is reducing network usage, not
correctness or latency. The code is the source of truth: every finding was
located in current code on the `fastify` branch and adversarially re-verified
against it. Line numbers will drift; symbol names and file paths are the durable
anchors. IDs (H/M/L) are scoped to this audit.

## Scope And Context

- Deployment model: single-user self-host. The dominant real cost is bytes on a
  hot path (per-keystroke / per-message / per-swipe / per-chat-select), not
  once-per-session or once-per-import payloads. Severity is calibrated by
  **bytes × frequency**, not raw size alone.
- All HTTP responses pass through `@fastify/compress` (`global: true`,
  `threshold: 1024`, `app.ts:105-109`), so raw-byte estimates below overstate
  on-wire cost for repetitive JSON. Two transports bypass it and are called out:
  the events SSE stream (hijacked raw writes) and the stream-job WebSocket
  (`perMessageDeflate` off).
- Surfaces audited (per `routeManifest.ts`): bootstrap, per-resource projection,
  bulk hydration, command mutations, command/memory SSE, chat/completion/
  preview generation, import/export/backup/realm, assets, memory reads/jobs,
  and proxy/hub/stream-jobs/legacy-storage.

## Method

Multi-agent audit, 38 agents. Nine endpoint families were each deep-read by one
finder (server handler + client consumer traced end to end), producing 29 raw
findings. Every finding was then handed to an independent adversarial verifier
instructed to default toward refutation unless the over-transmission was proven
by the code: re-read the cited files, confirm the data is actually
transmitted/accepted, confirm the consumer truly ignores it (or the server truly
need not accept it), and recalibrate magnitude and frequency. No finding was
fully refuted, but the verifier downgraded six severities, corrected several
magnitudes, and refuted sub-claims inside otherwise-valid findings (those
corrections are folded in below). Three headline findings (H1, H2/H3, M3) were
additionally hand-checked against live code while writing this report.

## What Is Already Tight (Do Not "Fix")

The audit confirmed that most of the protocol is already well-narrowed. Recording
this so these are not re-flagged:

- **Command write-path is field-level.** Character updates send only changed
  fields (`changedCharacterFields`), chat-metadata sends `changedChatMetadata`,
  single-message edits send a one-field patch (`updateMessageCommand`), prompt
  items patch by id, settings patches are grouped and carry only changed keys.
- **Command SSE events carry no state.** Each frame is a thin delta descriptor
  `{type, revision, resource, id?, parentId?, origin?}`; the client re-fetches
  the changed resource by id. The event catalog (`commands/events.ts`) shows
  deliberate per-row resource granularity (`characterRow`, `moduleUpdated`,
  `moduleEnabled`, `globalLorebook`) so a foreign refresh pulls one row, not the
  corpus.
- **Generation request bodies are minimal.** `/generate/chat` and
  `/preview-prompt` send only ids + the new user-message string; the server
  re-reads the chat/character/DB from SQLite by id (`loadPersistedForAssembly`).
  No whole-chat / whole-character / whole-DB upload. Inlay bytes ride as
  `/assets` ids, not inline.
- **Streaming is delta-based.** Tokens stream as deltas, not cumulative text
  (no O(L²) growth), and durable reattach replays per-token deltas, not a
  cumulative buffer.
- **Bootstrap already lazy-stubs** chats (message-free), character lorebooks,
  inactive characters (shells), and the top-level `promptTemplate`.

The remaining findings are the exceptions to these patterns.

## Cross-Cutting Themes

Most findings are instances of seven patterns. Fixing the pattern is usually
better than the instance.

1. **Whole-collection replacement on a single-element edit (C→S).** Editing one
   message / lorebook entry / script / trigger re-uploads the entire array. The
   server already row-diffs the upload against stored rows (`applyChatMessageDiff`)
   — proving it only needs the delta — and the merge infrastructure already
   exists (`loadChatHydrationRange`, a computed-but-unserialized `firstChangedIndex`).
   See H3, L3, L7; H2's swipe/reroll case has been remediated with targeted
   message commands.
2. **Bootstrap ships heavy collections not read on load (S→C).** `botPresets`,
   `modules`, and `plugins` are shipped in full (~90% of a measured 2.4 MB
   bootstrap) though the list UIs read only names/metadata; the same stub +
   lazy-hydrate pattern already used for characters/messages/promptTemplate is
   not applied to them. See H1, L1.
3. **SSE `done` events still carry duplicated fields (S→C).**
   `done.result` duplicates the streamed tokens. The previously duplicated
   `prompt.messages` and unread `prompt.lorebookActivation` fields were removed
   for compact-capable clients behind a client-capability flag. See L5.
4. **Full-replace projection where a tail/delta would do (S→C).** A foreign
   `generation.persisted` re-ships the whole transcript; any gap resync re-pulls
   the whole bootstrap, even though `command_events` records exactly which
   resources changed per revision. See M1, L2.
5. **base64-in-JSON for binary (both).** Bulk asset upload and the stream-job WS
   both base64-wrap raw bytes (~33% inflation) although a raw-binary path already
   exists for single-asset upload. See M4, L8.
6. **Content-addressed dedup not used client-side (C→S).** The `/assets/exists`
   probe is fully implemented but has zero callers, so duplicate/re-import
   uploads re-send bytes the server discards. See M3.
7. **Over-returning full rows where the UI reads a few fields (S→C).** Memory
   jobs (5 of 11 fields read), the memory.job SSE frame (~50% unread), and the
   import response (all but `{revision, event}` discarded). See L9, L12, L19.

## Findings Index

| ID  | Dir | Endpoint | Frequency | Title |
| --- | --- | --- | --- | --- |
| H1  | S→C | GET /bootstrap | per-session + resync | Partially resolved: active preset promptTemplate duplicate stripped; full preset stubbing remains |
| H2  | C→S | PUT /commands/chats/:id/messages | per swipe/reroll | Resolved: swipe/reroll now uses targeted tail/truncate/message-update commands |
| H3  | C→S | PUT /commands/.../lorebooks | per lorebook edit | Resolved: entry edit/delete/reorder use compact per-entry lorebook commands |
| M1  | S→C | GET /projection/generation | per foreign generation | generation.persisted re-ships the whole transcript instead of a tail |
| M2  | S→C | POST /generate/chat (prompt) | per-generation | Resolved: compact-capable clients no longer receive `messages` duplicating `formated` |
| M3  | C→S | POST /assets/bulk | on-import | Bulk upload never probes /assets/exists, re-sends duplicate bytes |
| M4  | S→C | GET /proxy/stream-jobs/:id/ws | per-chunk (LAN stream) | WS base64-encodes every LLM chunk (~33% inflation) |
| L1  | S→C | GET /bootstrap | per-session + resync | All modules and plugins shipped in full incl. disabled items |
| L2  | S→C | GET /bootstrap (resync) | per gap/reconnect | Resync re-pulls the entire projection with no revision delta |
| L3  | C→S | PUT /commands/.../scripts\|triggers | per edit burst | One script/trigger edit re-uploads the whole array |
| L4  | S→C | POST /generate/chat (prompt) | per-generation | Resolved: compact-capable clients no longer receive unread `lorebookActivation` |
| L5  | S→C | POST /generate/chat (done) | per-generation | `done.result` duplicates tokens already streamed |
| L6  | S→C | POST /generate/preview-prompt | per manual preview | preview returns the full prompt payload; client reads only promptText |
| L7  | S→C | POST /generate/chat (message_patch) | per rewriting send | `replace_all` carries the full transcript the server just persisted |
| L8  | C→S | POST /assets/bulk | on-import | Bulk upload base64-inflates assets ~33% vs the raw single-upload path |
| L9  | S→C | GET /memory/jobs | 5s poll + per event | Returns full job rows; UI reads only 5 of 11 fields |
| L10 | both | GET /memory/jobs | per job transition | Client re-fetches the whole job list on every SSE event |
| L11 | S→C | GET /memory/jobs | every 5s | Poll persists with no ETag/304; mostly unchanged bodies |
| L12 | S→C | GET /events | per job transition | memory.job frame ships a full status block no client reads |
| L13 | S→C | GET /events | per job transition | memory.job frames broadcast to every client, no chat scoping |
| L14 | S→C | GET /memory/chunks\|summaries/:id | none today | SELECT * full-text reads, unbounded; latent (no caller yet) |
| L15 | S→C | GET /events | per-session | SSE stream is emitted uncompressed (hijacks before compress hook) |
| L16 | S→C | GET /events | per command event | origin.writerSessionId rides every frame (usable only by author) |
| L17 | S→C | POST /projection/chatMessages/bulk | export only | Bulk chat response ships reroll `alternates` the consumer discards |
| L18 | both | POST /projection/chatMessages/bulk | export only | Bulk endpoints have no maxItems bound and no per-chat window |
| L19 | S→C | POST /import/bundle | per import | Import response echoes fields incl. unbounded unsupportedReferences |
| L20 | S→C | POST /import/realm-character | per import | Realm SSE re-sends a constant phase/message string per asset frame |
| L21 | S→C | GET /proxy/stream-jobs/:id/ws | LAN stream | WS perMessageDeflate off; skips the compression the HTTP path gets |
| L22 | S→C | GET /storage/list | per save | Remote-block existence check downloads the entire key list for one name |

---

## High-Severity Findings

### H1 — Bootstrap ships all `botPresets` in full, and each preset's `promptTemplate` duplicates the field bootstrap already lazy-strips

- **Status:** partially remediated 2026-06-13. Bootstrap now strips
  `botPresets[botPresetsId].promptTemplate`, removing the active preset's
  duplicate of the lazy top-level `promptTemplate`. Non-active preset
  `promptTemplate` arrays still ship until the full preset-stub + lazy-fetch
  projection is implemented.
- **Direction / endpoint:** S→C, `GET /api/v1/bootstrap`.
- **Frequency:** every cold load / first connect, and again on every full resync
  (gap / reconnect / restore).
- **What is over-transmitted:** all preset objects in full. Measured against the
  real `data/risu.db`: `bot_presets` = 1,062,118 bytes (≈44% of a 2.4 MB
  bootstrap), of which the per-preset `promptTemplate` arrays are ≈933 KB
  (52,831 / 374,129 / 185,097 / 196,936 / 59,084 / 62,218 / 2,900 bytes).
- **Why unnecessary:** bootstrap deliberately strips the **top-level**
  `database.promptTemplate` so the client hydrates it lazily
  (`stripLazyBootstrapFields` deletes *only* `promptTemplate`,
  `repository.ts:1403-1406`), but the identical content rides inside every
  `botPresets[i].promptTemplate`, defeating the optimization. The active
  preset's copy is provably equal to the stripped top-level field
  (`saveCurrentPresetLocal` writes `db.promptTemplate` back into
  `botPresets[botPresetsId].promptTemplate`, `database.svelte.ts:2398`; `setPreset`
  reads it on switch, `:2699`). The preset list UI reads only `name`/`image`
  (`botpreset.svelte:149,236`).
- **Magnitude:** ~933 KB of preset `promptTemplate` per cold load and per resync
  (compresses well, but still the single largest projection contributor); ~7×
  multiplier (all presets shipped vs. at most one consumed on a switch).
- **Nuance:** non-active presets' `promptTemplate` *is* consumed on demand by the
  prompt-diff feature (`PromptDiffModal.svelte:367` reads
  `db.botPresets[id].promptTemplate` for arbitrary ids), so they cannot simply be
  deleted — they need the lazy-fetch endpoint below.
- **Completed remediation:** the immediate safe win is done: strip
  `botPresets[botPresetsId].promptTemplate` from the bootstrap projection, since
  it duplicates the lazily-hydrated top-level field (saves ~the active preset's
  template, e.g. 374 KB, with zero feature loss).
- **Remaining full fix:** stub all presets to `{id, name, image, metadata}` in
  `loadBootstrapProjectionDatabase` and add a per-preset lazy projection
  (`GET /api/v1/projection/preset?id=`) fetched by `setPreset` and the diff
  modal.
- **Evidence:** `server/fastify/src/repository.ts:1388-1393` (bootstrap pipeline),
  `:1403-1414` (strips top-level promptTemplate and the active preset's duplicate),
  `:126-136` (botPresets loaded in full, never stubbed); client applies wholesale
  `src/ts/server/bootstrap.ts:118-127`; consumers
  `src/lib/Setting/botpreset.svelte:149,236`,
  `src/ts/storage/database.svelte.ts:2398,2699`,
  `src/lib/Others/PromptDiffModal.svelte:367`.

### H2 — Resolved: swipe/reroll navigation used to re-upload the entire chat transcript when only the tail message(s) changed

- **Status:** remediated 2026-06-13. Swipe/reroll now routes single tail data
  swaps through `PATCH /api/v1/commands/messages/:messageId`, pure truncates
  through `POST /api/v1/commands/chats/:chatId/messages/truncate`, and saved
  candidate tail slices through `POST /api/v1/commands/chats/:chatId/messages/tail`.
  Focused regression coverage exists in `rerollNavigation.test.ts`,
  `rerollNavigation.rollback.test.ts`, and `server/commands.test.ts`.
- **Direction / endpoint:** C→S, `PUT /api/v1/commands/chats/:chatId/messages`.
- **Frequency:** per swipe/reroll navigation to a saved candidate — a frequent
  interactive chat action.
- **What is over-transmitted:** the complete `message[]` array (every message's
  role, full `data` text, `promptInfo.promptText` — the entire prompt per
  message — `generationInfo`, etc.), uncompressed, when typically only the
  trailing assistant turn changed.
- **Why unnecessary:** the server already holds the prior transcript and computes
  a common-prefix row diff, deleting/inserting only from the first divergence
  (`applyChatMessageDiff`, `messageStore.ts:435-464`) — so it provably needs only
  the changed tail. The cheap path already exists and is used elsewhere:
  `applyTailDataSwap` uses a single `updateMessageCommand`, and a dedicated
  `POST /chats/:id/messages/truncate` (taking only `{baseRevision, afterMessageId}`)
  is already used by `Chat.svelte`.
- **Magnitude:** O(full transcript). A long chat is easily tens-to-hundreds of KB
  of JSON; swapping one ~1–5 KB candidate re-sends the whole history each time —
  a 10×–100× inflation on a per-click action. The cleanest proof is
  `applyRerollTruncate` (`rerollNavigation.svelte.ts:217`): a *pure truncate* that
  nonetheless sends the full surviving array via replace.
- **Completed remediation:** N=1 tail data swaps use `updateMessageCommand`, pure
  truncates use the existing truncate endpoint, and multi-row saved-candidate
  swaps use a `replaceTailMessages {afterMessageId, messages}` command so the
  request body scales with changed rows, not transcript length.
- **Current evidence:** `src/ts/process/rerollNavigation.svelte.ts:107-160`
  dispatches data swaps, tail-slice swaps, and truncates through targeted
  helpers; `src/ts/chatCommands.ts:1073-1186` maps those helpers to
  `updateMessageCommand`, `truncateMessagesCommand`, and
  `replaceTailMessagesCommand`; `src/ts/server/commands.ts:2182-2238` sends the
  bounded request bodies; `server/fastify/src/routes/commands.ts:3631-3723`
  implements the truncate and tail replacement routes.

### H3 — Resolved: editing a single lorebook entry used to re-upload the entire lorebook collection

- **Status:** remediated 2026-06-13. Debounced entry edits now send one entry via
  scoped upsert commands; simple deletes send one entry id; pure reorders send
  only an id list. The full `PUT .../lorebooks` routes remain as the fallback for
  bulk import/replace and mixed changes that cannot be represented by one compact
  delta.
- **Direction / endpoint:** C→S,
  `PUT /api/v1/commands/characters/:id/lorebooks` (and `/chats/:id/lorebooks`,
  `/modules/:id/lorebooks`, `/lorebooks/:id/entries`).
- **Frequency:** per lorebook edit burst (debounced 250 ms) — fires on any entry
  field edit, an `alwaysActive`/`selective` toggle, or add/remove/reorder of a
  single entry.
- **What is over-transmitted:** every entry of the lorebook (`key`, `secondkey`,
  the unbounded free-text `content`, `comment`, `insertorder`, `mode`,
  `alwaysActive`, `selective`, `folder`, plus extras) is re-sent even when only
  one entry's one field changed.
- **Why unnecessary:** the server already holds the full lorebook and simply
  assigns the incoming array (`character.globalLore = entries`,
  `commands.ts:4039`). A per-entry upsert/delete keyed by id would carry only the
  delta. (Confirmed the existing `source === 'entry'` machinery only affects
  client-local rollback granularity — the wire payload is still the whole
  collection.)
- **Magnitude:** O(all entries). Lorebooks with dozens of multi-KB-content
  entries are common; re-sending the whole book to toggle one checkbox is
  10×–100× the needed bytes per burst.
- **Completed remediation:** added per-entry lorebook commands (upsert by id,
  delete by id, reorder by id list) for global lorebooks, character `globalLore`,
  chat `localLore`, and module lorebooks; kept the full PUT only for
  bulk/mixed-shape replacement.
- **Current evidence:** `applyLorebookEntryDraftEdit` now routes single-entry
  debounced edits through compact upsert commands; collection replacement
  dispatch detects simple upsert/delete/reorder deltas before falling back to full
  replacement; typed client helpers live in `src/ts/server/commands.ts`; Fastify
  scoped entry routes live in `server/fastify/src/routes/commands.ts`; server
  validators/mutators live in `server/fastify/src/commands/lorebooks.ts`.

---

## Medium-Severity Findings

### M1 — `generation.persisted` projection re-ships the entire transcript instead of a tail/delta

- **Direction / endpoint:** S→C, `GET /api/v1/projection/generation?parentId=<chatId>`.
- **Frequency:** per foreign `generation.persisted` event (other tabs/devices
  live-viewing the same chat; the originating session is own-echo-skipped). Not
  per-keystroke, but unbounded in size.
- **What is over-transmitted:** the full `message[]` (plus `hypaV3Data`,
  `alternates`) for the affected chat, though only the single newly-persisted turn
  changed.
- **Why unnecessary:** the generation branch calls `loadChatHydration` with **no
  range** (`projection.ts:394-409`), returning every row; the client replaces the
  whole array (`hydrateServerChatMessages` with no `range`, full-replace at
  `database.svelte.ts:1049`). The tail-merge path already exists —
  `loadChatHydrationRange` returns `messageStart`/`messageTotal`
  (`repository.ts:1572-1605`) and `hydrateServerChatMessages` already supports a
  placeholder-aware splice-merge `range` (`database.svelte.ts:1031-1047`); only
  this branch and its wrapper fail to use them.
- **Magnitude:** up to the full chat per event — measured top chat
  `772eff9f` = 278 messages / 2.65 MB. For an active long chat under multi-session
  viewing, each foreign turn re-ships megabytes vs. a few-KB delta.
- **Recommendation:** have the generation branch ship only the changed tail
  (`loadChatHydrationRange` with a small tail + `messageStart`/`messageTotal`) so
  the client splices by absolute index instead of replacing the array. Low-risk:
  the infrastructure already exists.
- **Evidence:** `server/fastify/src/routes/projection.ts:394-409`;
  `repository.ts:1513-1537` (full `getChatMessages`); client
  `src/ts/bootstrap.ts:386-393` (foreign-only via `isOwnCommandEvent` `:336-339`),
  `chatMessageHydration.svelte.ts:301-316`; range-capable alt
  `projection.ts:259-289` + `repository.ts:1572-1605`.

### M2 — `prompt` SSE event ships a full `messages` projection that duplicates `formated` and is never read

- **Status:** remediated 2026-06-13. Fresh browser generation requests now send
  `clientCapabilities.compactPromptEvent: true`; the Fastify route omits
  `prompt.messages` for capable clients while keeping the legacy field for
  clients that do not advertise the capability.
- **Direction / endpoint:** S→C, `POST /api/v1/generate/chat` (and `/preview-prompt`).
- **Frequency:** per-generation (every send/regenerate/continue) and per manual
  preview.
- **What is over-transmitted:** the entire `messages: Array<{role, content}>` — one
  row per assembled prompt row (system card, persona, every lorebook entry, the
  full chat-history window) — whose `content` is the same text already in each
  corresponding `formated` row.
- **Why unnecessary:** `messages` is documented as a lossy `{role, content}`
  projection of `formated` (`sseEvents.ts:34-46`); the client reads only
  `formated`/`promptInfo`/`biases`. A literal search for `prompt.messages` across
  production code returns zero genuine consumers (only test fixtures). The durable
  replay path additionally double-buffers the identical frame.
- **Magnitude:** roughly the full prompt text a second time — ~3–12 KB per typical
  generation, tens of KB for big-lorebook chats.
- **Completed remediation:** the browser adapter appends
  `clientCapabilities.compactPromptEvent: true` to fresh `/generate/chat`
  requests; the server sanitizes the `prompt` event and `/preview-prompt` JSON
  response for capable clients. Legacy clients still receive the original field.
- **Current evidence:** `server/fastify/src/prompt/assemble.ts:1726` (built),
  `:1735` (`formated` in the same object);
  `server/fastify/src/routes/generationChat.ts` (`promptEventForClient`);
  `src/ts/process/request/serverChat.ts` (capability injection);
  regression coverage in `server/fastify/__tests__/generation.chat.test.ts` and
  `src/ts/process/request/tests/serverChat.test.ts`.

### M3 — Bulk upload never probes existence before re-sending asset bytes the server already stores

- **Direction / endpoint:** C→S, `POST /api/v1/assets/bulk`.
- **Frequency:** on-import (character/card import; per imported asset batch).
- **What is over-transmitted:** the entire byte payload of every asset in an
  import, including assets whose `sha256` already exists on the server. The
  existence probe (a tiny request of 64-hex ids returning only the missing
  subset) is never used.
- **Why unnecessary:** the server is content-addressed and detects duplicates by
  `sha256` (`repository.ts:1956-1965`) returning `created:false` **after** the
  full bytes already crossed the wire. The `/assets/exists` endpoint is fully
  implemented (`assets.ts:256-284`) but has **zero** client callers (verified:
  no `src/` reference). Hashing client-side and probing first would upload only
  genuinely-missing assets.
- **Magnitude:** up to a full import's asset bytes on every re-import / shared-
  character import (often several MB of emotion/additional images), bounded only
  by the 32 MB/32-item batch chunking. Zero on the first import of a new
  character.
- **Recommendation:** before bulk upload, sha256 each asset client-side
  (Web Crypto `subtle.digest`) and POST the ids to the existing `/assets/exists`;
  upload bytes only for returned `missing` ids and reuse known ids for the rest.
- **Evidence:** client `src/ts/globalApi.svelte.ts:201-226` (unconditional),
  `:154-165` (no pre-check); dead endpoint
  `server/fastify/src/routes/assets.ts:256-284` →
  `repository.ts:697-701,2014-2016`; server dedup `repository.ts:1956-1965`;
  import callers `src/ts/characterCards.ts:236,632-640,675-689,724`.

### M4 — Stream-job WebSocket base64-encodes every LLM chunk inside JSON (~33% inflation)

- **Direction / endpoint:** S→C, `GET /api/v1/proxy/stream-jobs/:id/ws`.
- **Frequency:** per upstream chunk on every **local-network** streaming LLM
  generation (`openai_streaming` interceptor) — many frames per message.
- **What is over-transmitted:** each upstream byte is sent as base64 text
  (4 chars per 3 bytes) wrapped in `{"type":"chunk","dataBase64":"..."}`, instead
  of the raw bytes the equivalent HTTP proxy path streams.
- **Why unnecessary:** the client immediately base64-decodes back to a
  `Uint8Array` (`proxyJobWs.ts:21`), and the HTTP `/proxy/fetch` fallback for the
  same request streams the body raw (`routes/proxy.ts:78`). The base64 layer is
  unique to the WS path and exists only to fit a text frame; the client already
  enqueues into a `ReadableStream<Uint8Array>` controller and could take binary
  frames directly.
- **Magnitude:** ~33% inflation of the entire streamed response, plus a ~30-byte
  JSON envelope per (small) token frame — so 33% is a lower bound.
- **Nuance:** scoped to `local_network` streaming (Ollama/LM Studio on the user's
  LAN), so the bytes don't cross the internet — which is why this is medium, not
  high.
- **Recommendation:** send upstream chunks as **binary** WS frames
  (`socket.send(buffer)`), keeping JSON only for control frames. Failing that,
  enable `perMessageDeflate` (see L21).
- **Evidence:** `server/fastify/src/streamJobs.ts:494-502` (per-chunk base64),
  `:372-373` (JSON.stringify), `routes/streamJobs.ts:53` (text frame); client
  `src/ts/globalApi.svelte.ts:1162-1165,1312-1317`, `src/ts/network/proxyJobWs.ts:21-23`;
  raw HTTP contrast `routes/proxy.ts:78`.

---

## Low-Severity Findings

### Bootstrap / projection (S→C)

**L1 — Bootstrap ships all modules and all plugins in full, including disabled
items.** All 14 modules (742 KB) and both plugins (342 KB) — ~46% of the
bootstrap — ship full lorebook/regex/trigger/asset/script bodies. Module list/menu
needs only metadata; disabled plugins' scripts never execute
(`plugins.svelte.ts:486`). *Nuance (corrects the finder):* the client DOES consume
module bodies at runtime for **active** modules via
`getModuleLorebooks/Triggers/RegexScripts/Assets` (`modules.ts:414-475`, called
from scripts/triggers/cbs/translator/render), so "metadata only" is wrong and a
lazy-hydrate must cover all four module-activation paths; and modules have no
`enabled` field (enablement lives in `settings.enabledModules`). The plugin half
is cleaner: ship `script` only for enabled plugins, lazy-fetching on
enable/open. Evidence: `repository.ts:126-136,1388-1393`; `modules.ts:390-475`;
`plugins.svelte.ts:486`; `apiV3/v3.svelte.ts:1599`.

**L2 — Full-bootstrap resync re-pulls the entire projection with no revision
delta.** Any gap/reconnect calls `forceServerProjectionResync` →
`fetchServerBootstrapProjectionReadOnly` and wholesale-replaces the DB
(`projectionResync.ts:67,75,83-92`), even when only a few resources changed since
the client's cached revision. `command_events` already records `{revision, type,
resource, id, parent_id}` per revision (`db.ts:383-391`), so a
"changes-since-revision-R" endpoint could ship only affected resources, falling
back to full bootstrap only when the event log no longer covers R. *Nuance:* rare
(single-writer invariant means steady-state gaps essentially only arise on SSE
reconnect/replay-unavailable); this is a self-healing recovery cost, not a hot
path. Triggers: `src/ts/bootstrap.ts:343,383,422-425,429`.

### Commands write-path (C→S)

**L3 — Editing one regex script or trigger re-uploads the entire scripts/triggers
array.** Same pattern as H3 for `customscript`/`triggerscript`/`module.regex`/
`module.trigger`: a single-element change re-sends the whole array
(`scriptDefinitionBridge.svelte.ts:340-408`; server overwrite
`commands.ts:4745,4781,4817,4844-4870`). Trigger `effect[]` arrays carry
multi-KB Lua/CBS code. Lower than H3 because the 250 ms debounce coalesces bursts
to one request and it is an authoring path scoped to the open panel, not a
generation/chat-select hot path. Fix: per-definition upsert/delete/reorder by id.

### Generation SSE (S→C)

**L4 — Resolved: `prompt` event shipped a `lorebookActivation` report no client
reads.** Remediated 2026-06-13 behind the same
`clientCapabilities.compactPromptEvent` flag as M2. The full
`LorebookActivationReport` is still built for assembly internals, but it is no
longer emitted to compact-capable `/generate/chat` SSE clients or
`/preview-prompt` JSON callers. Legacy clients still receive the original field.

**L5 — Terminal `done.result` re-sends the completion text already streamed.**
`emitSuccessDone` always stamps the full accumulated text onto `done`
(`providerTransport.ts:55-63`); the client reads it only when
`tokenResult.length === 0` (`serverChat.ts:452-457`), so on a live stream it is a
redundant second copy (~2–16 KB/generation). *Nuance:* `done.result` is **not**
dead — it is the durable-reattach recovery payload (`done` is replay-protected
while `token` is evicted first, `streamJobs.ts:79-87`), and a single emitted frame
goes to both the live socket and the replay buffer, so suppressing it only on the
live socket needs an architectural split. Low-priority.

**L6 — `preview_prompt` returns the whole prompt payload when only
`promptInfo.promptText` is read.** The preview branch reads only
`served.prompt.promptInfo?.promptText` (`serverBackedSendChat.ts:231-233`) and
discards `messages`/`formated`/`lorebookActivation`. *Nuance (corrects the
finder):* there is no `biases` field in the prompt payload, and the dedicated
`/preview-prompt` route appears unused by the live client (the preview path is the
SSE `/chat` route via hotkey). Manual-frequency. Fix: project `preview_prompt`
down to `promptInfo`.

**L7 — `replace_all` message mutations carry the full transcript the server just
persisted.** When a trigger/editinput/history-normalize rewrites history, assembly
emits `{type:'replace_all', messages: <full array>}` on `message_patch`
(`assemble.ts:694-705`), applied wholesale client-side
(`serverMessagePatch.ts:17-19`); the same transcript was just written by the
`messages.replaced` command in the same request. The server already computes
`firstChangedIndex` (`assemble.ts:689`) but stores it non-enumerable so it never
serializes — a from-`firstChangedIndex` slice is feasible. *Nuances (correct the
finder):* it is **not** sent twice (the post-gen `messagePatch` is a separate
delta), and the patch is applied to the in-memory projection with no refresh, so a
"re-read by revision" remedy would *add* a round-trip — the right fix is wiring the
existing `firstChangedIndex` slice. Zero on plain trigger-less sends (those use a
small `append`).

### Assets (C→S)

**L8 — Bulk upload base64-encodes assets in JSON (~33% inflation) vs the raw
single-upload path.** `globalApi.svelte.ts:220-225` sends
`Buffer.from(asset.data).toString('base64')` in a JSON body; the server decodes
straight back to a Buffer (`assets.ts:135-141`). The single-asset route already
sends raw binary end-to-end (`src/ts/server/assets.ts:71-82` → buffer parser
`app.ts:124-126` → `assets.ts:158-193`), proving a multipart/length-framed binary
bulk body would carry identical info with zero inflation. Import-only frequency;
uncompressed on the wire. *Nuance:* the 32 MB cap is the client chunker, not the
server `bodyLimit` (100 MB default), so the 413/split path is a rare fallback, not
a normal base64 consequence. Pairs naturally with M3 (probe then raw-binary
upload only the missing).

### Memory

**L9 — `GET /memory/jobs` returns full job rows; the UI reads only 5 of 11
fields.** `listMemoryJobs` does `SELECT *` and `mapMemoryJobRow` emits
`id/chatId/kind/status/payload/error/attemptCount/maxAttempts/nextRunAt/createdAt/
updatedAt` (`memoryRepository.ts:404-424,901-911`); the modal renders only
`kind/status/attemptCount/maxAttempts/id`. `payload` (summarize jobs embed a
`messageIndexes` int array + `chatMemos` UUIDs scaling with window size) is pure
dead weight. *Nuance:* the route is server-filtered to `['pending','running']`, so
N is small, and gzip collapses the repetitive numeric/UUID data — real but low.
Fix: a projected list shape dropping `payload`; full row only on a single-job
detail fetch.

**L10 — Client re-fetches the whole job list on every SSE `memory.job` event.**
`server-memory-jobs.svelte:107-111` calls `void refreshJobs()` (full GET) for
every event whose `chatId` matches, although the event already carries the
changed job's renderable fields. Fix: upsert the single job from the event into
the in-memory array; reserve the GET for initial mount and the reconciliation
poll. *Nuance:* the subscriber mounts only while the HypaV3 modal is open, and an
in-flight-dedup collapses bursts to ~one trailing refresh — modest real impact.

**L11 — 5 s polling persists with no ETag/304.** A 5 s `setInterval` polls
`GET /memory/jobs` while any job is pending/running and the modal is open
(`memoryJobRefresh.ts:3,47-56`); identical lists are re-sent with no conditional
request. *Nuance (corrects the finder):* the SSE channel is only a fetch trigger,
not state delivery (it carries one job's scalars, and the consumer reacts by
firing the same GET), so the poll is a genuine fallback, not a redundant duplicate
of an SSE payload. The real lever is L9 (drop `payload`) + an ETag/304.

**L12 — `memory.job` SSE frame ships a full job-status block no client reads.**
`buildMemoryJobEvent` serializes `jobId/kind/status/attemptCount/maxAttempts/
nextRunAt/error` plus a `hypav3` side-effect (`memoryEvents.ts:70-99`); the only
consumers read `event.chatId` (then re-fetch via REST) and
`open/miniMsg/msg/subMsg`. ~50% of each ~400-byte frame is unread (measured
407→202 bytes). Fix: reduce the live frame to `{type, chatId}` + the 4-field
progress payload (also requires relaxing the client validator
`events.ts:199-202`, which currently hard-rejects frames missing the fields).

**L13 — memory.job frames broadcast to every client with no chat-relevance
scoping.** The SSE endpoint keeps no per-client current-chat state, so every frame
reaches every connected tab/device (`events.ts:152-157`,
`memoryEvents.ts:52-56`). *Nuance:* not purely "received and dropped" — every tab
applies the global, non-chat-scoped `hypaV3ProgressStore`
(`bootstrap.ts:307-312` → `serverMemory.ts:72-89`), so the only true waste is in
the multi-tab case. The high-value fix is the L12 payload trim; relevance scoping
(a client current-chat hint) is optional.

**L14 — `GET /memory/chunks|summaries/:id` are unbounded `SELECT *` full-text
reads with no production caller (latent).** Routes return full chunk/summary text
for an entire chat with no pagination/projection/count option
(`memoryReads.ts:31,47-52`; `memoryRepository.ts:521-530,605-614`). No `src/`
consumer today (only tests/smoke). Flagged so the over-fetch shape is fixed
*before* these are wired to UI: add `limit`/`sinceSeq` and a count-only/id-only
variant.

### Events SSE (S→C)

**L15 — The SSE event stream is emitted uncompressed.** The route hijacks and
writes raw frames (`events.ts:62,123-160`), bypassing `@fastify/compress`. *Nuance
(corrects the finder):* impact is small — frames are 105–177-byte delta
descriptors (heartbeat 13 bytes), already below the 1024 compress threshold, and
per-frame `Z_SYNC_FLUSH` on tiny frames recovers little (the 60–80% figure assumes
a buffered corpus). Not clearly worth the per-frame-flush complexity; record as
known.

**L16 — `origin.writerSessionId` rides on every command frame but is usable only
by the authoring client.** ~64 bytes/frame that a foreign recipient can never
match (`bootstrap.ts:432-435`). *Nuance (corrects the finder):* this is **not**
safely removable — the SSE echo can arrive before the author's HTTP write-response
advances its cached revision, and without `origin` the author would treat its own
echo as foreign and fire a wasteful resource re-fetch (`bootstrap.ts:350-351`). In
the dominant single-tab case the only recipient is the author, who consumes it.
Treat as acceptable-as-is, not a fixable waste.

### Bulk hydration (S→C)

**L17 — Bulk chat hydration ships per-chat reroll `alternates` the consumer
discards.** The bulk response always includes `alternates` (full preserved
reroll-candidate message rows) per chat (`repository.ts:1641,1677`), but
`hydrateChatsBulk` seeds the reroll buffer only for the active chat
(`chatMessageHydration.svelte.ts:228-230`); all bulk callers (export-as-dataset,
export-all-chats, branch-tree) ignore it. Export-only frequency, and most chats
carry zero alternates (cleared on next send), so bounded. Fix: drop `alternates`
from the bulk response; keep it on the single-chat GET that seeds the open chat.

**L18 — Bulk endpoints have no `maxItems` bound and return complete unwindowed
transcripts.** `bulkChatMessagesBodySchema` caps neither the id list nor the
per-chat window (`projection.ts:128-140,474-488`); `ensureAllChatsHydrated` sends
every chat of every character in one POST. *Honest classification:* for the export
use case the bytes are fully consumed — there is **no** redundant transfer — so
this is a request-size/buffering **hardening** item (add `maxItems`, chunk the
export into bounded pages), not transfer waste per se. Listed for completeness.

### Import / export (S→C)

**L19 — Bundle/risusave import response echoes fields the client discards,
including an unbounded `unsupportedReferences` array.** The response carries
`format/envelope/importReport{incompleteChatCount, unsupportedReferenceCount,
unsupportedReferences}/assetReport/bundleReport` (`save.ts:94-104,162-177`), but
`readBundleImportResult` reads only `{revision, event}` and the terminal consumer
reads only `result.status` — zero non-test consumers of the rest.
`unsupportedReferences` is one object per remote/cache-only block (unbounded).
Once-per-import, so small. Fix: return only `{revision, event}` (or scalar counts
if a summary UI is ever added).

**L20 — Realm-import SSE re-sends a constant phase/message string on every
per-asset frame.** `createStepProgress` re-emits `{phase, message, percent}` per
staged/saved asset though only `percent` changes intra-phase
(`realmImport.ts:1491-1499,475-479`); the client `readProgressFrame` requires all
three. ~50–70 redundant bytes/frame; realistic cards have a handful-to-dozens of
assets (~1–3 KB), and it is localhost + once-per-import — trivial. Fix: emit
`message`/`phase` once per phase, percent-only deltas after (small client change),
or throttle per-asset progress.

### Proxy / hub / legacy (S→C)

**L21 — Stream-job WebSocket has `perMessageDeflate` disabled.** `fastifyWebsocket`
is registered with no options (`app.ts:128`), so the `ws` server default
(`perMessageDeflate: false`) means it ignores the browser's deflate offer and
sends highly-compressible token text uncompressed — while the HTTP proxy path is
gzip/br compressed by `@fastify/compress`. *Nuance:* LAN-only path (see M4), and
PMD adds server CPU/memory, so not a pure free win. Fix: register with
`{ options: { perMessageDeflate: true } }`, or move to binary frames (M4), which
makes deflate moot. Compounds with M4's base64 inflation.

**L22 — Remote-block existence check downloads the entire storage key list to test
one filename.** `encodeRemoteBlock` calls `forageStorage.keys()` and uses it only
for `stored.includes(fileName)` (`risuSave.ts:368-369`), which hits
`GET /api/v1/storage/list` returning every hex-decoded save-dir filename
(`legacyStorage.ts:97-105`) — a few KB to tens of KB to answer one boolean. *Low:*
memoized per name per session, only for remote-saving users, on save (not
interactive). Fix: add a dedicated `HEAD /storage/read` (200/404) or
`GET /storage/exists?path=` and query the single key.

---

## Suggested Remediation Order

Ordered by bytes × frequency × implementation ease:

1. **M1 (generation.persisted tail).** Reuse `loadChatHydrationRange` +
   `firstChangedIndex`; low-risk, infra already present (shared with L7).
2. **M3 + L8 (probe `/assets/exists`, then upload missing as raw binary).** Turns
   duplicate/re-imports into near-zero-byte ops and removes 33% inflation.
3. **M4 + L21 (binary WS frames, or enable `perMessageDeflate`).** LAN-scoped but
   hot during streaming.
4. **Memory cleanup (L9, L10, L11, L12).** Projected job-list shape, event-driven
   upserts, ETag/304, trimmed SSE frame — a coherent batch.
5. **Remaining lows (L2, L5, L6, L7, L13–L22)** as opportunistic cleanup; L16 and
   L15 are documented as acceptable-as-is.

## How To Verify

- Sizes were measured against the real `data/risu.db` (66 MB) via `sqlite3`
  byte-length sums on `bot_presets`, `modules`, `plugins`, and chat message JSON.
- For each open finding, the over-transmission is reproducible by reading the cited
  server serializer and confirming the client consumer ignores the field
  (grep the field name across `src/` excluding tests). The `file:line` anchors in
  each finding are the entry points.
- Existing regression coverage asserts the bootstrap projection contains no
  `botPresets[i].promptTemplate` for the active preset (H1). A regression guard
  could still assert that the bulk chat
  response omits `alternates` (L17). Existing focused tests guard the H2 targeted
  swipe/reroll command routing and the M2/L4 compact prompt event behavior.
