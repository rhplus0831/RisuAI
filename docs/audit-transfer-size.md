# Network Transfer-Size Audit

Date: 2026-06-13.

Last updated: 2026-06-14. H1, H2, H3, M1, M2, M3, M4, L1, L4, L6, L7, L8, L9, L10, L11, L12, L17, L19, L21, and L22 were remediated after the initial audit.

This audit examines every place the server sends data to the client and every
place the client sends changes back, looking for endpoints that transmit or
accept more data than necessary. The goal is reducing network usage, not
correctness or latency. The code is the source of truth: every finding was
located in current code on the `fastify` branch and adversarially re-verified
against it. Line numbers will drift; symbol names and file paths are the durable
anchors. IDs (H/M/L) are scoped to this audit.

## Remaining Work

Start here before reading the detailed findings. The first list is the active
queue; the second list captures open findings intentionally left alone. Everything
else in the detailed index is remediated.

Actionable items:

- L3 - small, straightforward write-path cleanup. Add per-definition upsert,
  delete, and reorder commands for regex scripts and triggers. Detailed notes:
  "Commands write-path".
- L5 - low-priority generation cleanup. For compact-capable clients, replace
  live-stream `done.result` with a digest/length check plus a recovery fetch when
  streamed tokens are missing or mismatched. Keep legacy behavior until the
  fallback exists. Detailed notes: "Generation SSE".
- L14 - latent API hardening. Add pagination/projection to memory chunk and
  summary reads before they are wired to UI. Detailed notes: "Memory".
- L18 - request-size hardening. Replace whole-corpus chat hydration paths with
  bounded chunks or streaming export, then add server-side `maxItems` limits.
  Detailed notes: "Bulk hydration".

No-action decisions for now:

- L2 - keep full-bootstrap resync as the rare recovery fallback unless traces
  show frequent replay gaps or full resyncs remain too large.
- L13 - keep global memory-job broadcast; revisit only if multi-client active use
  becomes a supported product goal.
- L15 - keep the raw SSE event stream uncompressed because frames are already
  tiny and compression adds flush complexity.
- L16 - keep `origin.writerSessionId`; it prevents own-echo re-fetch races.
- L20 - keep Realm-import progress frames unchanged unless that progress protocol
  is revised for another reason.

## Scope And Context

- Deployment model: single-user self-host. The dominant real cost is bytes on a
  hot path (per-keystroke / per-message / per-swipe / per-chat-select), not
  once-per-session or once-per-import payloads. Severity is calibrated by
  bytes × frequency, not raw size alone.
- All HTTP responses pass through `@fastify/compress` (`global: true`,
  `threshold: 1024`, `app.ts:105-109`), so raw-byte estimates below overstate
  on-wire cost for repetitive JSON. One transport bypasses it and is called out:
  the events SSE stream (hijacked raw writes). The stream-job WebSocket now
  negotiates `perMessageDeflate`.
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

- Command write-path is field-level. Character updates send only changed
  fields (`changedCharacterFields`), chat-metadata sends `changedChatMetadata`,
  single-message edits send a one-field patch (`updateMessageCommand`), prompt
  items patch by id, settings patches are grouped and carry only changed keys.
- Command SSE events carry no state. Each frame is a thin delta descriptor
  `{type, revision, resource, id?, parentId?, origin?}`; the client re-fetches
  the changed resource by id. The event catalog (`commands/events.ts`) shows
  deliberate per-row resource granularity (`characterRow`, `moduleUpdated`,
  `moduleEnabled`, `globalLorebook`) so a foreign refresh pulls one row, not the
  corpus.
- Generation request bodies are minimal. `/generate/chat` and
  `/preview-prompt` send only ids + the new user-message string; the server
  re-reads the chat/character/DB from SQLite by id (`loadPersistedForAssembly`).
  No whole-chat / whole-character / whole-DB upload. Inlay bytes ride as
  `/assets` ids, not inline.
- Streaming is delta-based. Tokens stream as deltas, not cumulative text
  (no O(L²) growth), and durable reattach replays per-token deltas, not a
  cumulative buffer.
- Bootstrap already lazy-stubs chats (message-free), character lorebooks,
  inactive characters (shells), and the top-level `promptTemplate`.

The remaining findings are the exceptions to these patterns.

## Cross-Cutting Themes

Most findings are instances of seven patterns. Fixing the pattern is usually
better than the instance.

1. Whole-collection replacement on a single-element edit (C→S). Editing one
   message / lorebook entry / script / trigger re-uploads the entire array. The
   server already row-diffs the upload against stored rows (`applyChatMessageDiff`)
   — proving it only needs the delta — and the merge infrastructure already
   exists (`loadChatHydrationRange`, a computed-but-unserialized `firstChangedIndex`).
   See H3, L3, L7; H2's swipe/reroll case has been remediated with targeted
   message commands.
2. Resolved bootstrap heavy collections (S→C). `botPresets` now use lazy
   per-preset hydration, and `modules`/`plugins` now use a browser-local
   revisioned body cache so unchanged bodies are omitted after the first cached
   load. See H1, L1.
3. SSE `done` events still carry duplicated fields (S→C).
   `done.result` duplicates the streamed tokens. The previously duplicated
   `prompt.messages` and unread `prompt.lorebookActivation` fields were removed
   for compact-capable clients behind a client-capability flag. See L5.
4. Full-replace projection where a tail/delta would do (S→C). Any gap resync
   re-pulls the whole bootstrap, even though `command_events` records exactly
   which resources changed per revision. The foreign `generation.persisted`
   branch now ships a ranged message tail instead of the whole transcript. See
   L2.
5. base64-in-JSON for binary (both). Resolved for the two audited hot spots:
   stream-job chunks now use binary WS frames, and bulk asset upload uses binary
   framing for missing assets.
6. Content-addressed dedup not used client-side (C→S). Resolved for bulk
   asset upload: the client now hashes assets, probes `/assets/exists`, and
   uploads only ids the server reports missing.
7. Over-returning full rows where the UI reads a few fields (S→C). Resolved
   for memory jobs and memory.job SSE frames. The import response still echoes
   fields that consumers discard except `{revision, event}`. See L19.

## Findings Index

| ID  | Dir | Endpoint | Frequency | Title |
| --- | --- | --- | --- | --- |
| H1  | S→C | GET /bootstrap | per-session + resync | Resolved: preset bootstrap/field projections are stubbed with lazy full-preset hydration |
| H2  | C→S | PUT /commands/chats/:id/messages | per swipe/reroll | Resolved: swipe/reroll now uses targeted tail/truncate/message-update commands |
| H3  | C→S | PUT /commands/.../lorebooks | per lorebook edit | Resolved: entry edit/delete/reorder use compact per-entry lorebook commands |
| M1  | S→C | GET /projection/generation | per foreign generation | Resolved: generation.persisted ships the changed message tail with range metadata |
| M2  | S→C | POST /generate/chat (prompt) | per-generation | Resolved: compact-capable clients no longer receive `messages` duplicating `formated` |
| M3  | C→S | POST /assets/bulk | on-import | Resolved: bulk upload probes /assets/exists and skips duplicate bytes |
| M4  | S→C | GET /proxy/stream-jobs/:id/ws | per-chunk (LAN stream) | Resolved: WS streams chunks as binary frames, not base64 JSON |
| L1  | S→C | GET /bootstrap | per-session + resync | Resolved: module/plugin bodies use revisioned bootstrap body cache |
| L2  | S→C | GET /bootstrap (resync) | per gap/reconnect | Resync re-pulls the entire projection with no revision delta |
| L3  | C→S | PUT /commands/.../scripts\|triggers | per edit burst | One script/trigger edit re-uploads the whole array |
| L4  | S→C | POST /generate/chat (prompt) | per-generation | Resolved: compact-capable clients no longer receive unread `lorebookActivation` |
| L5  | S→C | POST /generate/chat (done) | per-generation | `done.result` duplicates tokens already streamed |
| L6  | S→C | POST /generate/preview-prompt | per manual preview | Resolved: compact preview response returns only promptInfo.promptText |
| L7  | S→C | POST /generate/chat (message_patch) | per rewriting send | Resolved: compact `replace_all` carries only the changed suffix |
| L8  | C→S | POST /assets/bulk | on-import | Resolved: missing bulk assets upload with binary framing, not base64 JSON |
| L9  | S→C | GET /memory/jobs | 5s poll + per event | Resolved: job list projects render fields and drops payload/timestamps |
| L10 | both | GET /memory/jobs | per job transition | Resolved: client upserts the changed job from SSE instead of refetching |
| L11 | S→C | GET /memory/jobs | every 5s | Resolved: job polling uses ETag/If-None-Match and 304 |
| L12 | S→C | GET /events | per job transition | Resolved: memory.job frame carries compact job fields plus progress |
| L13 | S→C | GET /events | per job transition | memory.job frames broadcast to every client, no chat scoping |
| L14 | S→C | GET /memory/chunks\|summaries/:id | none today | SELECT * full-text reads, unbounded; latent (no caller yet) |
| L15 | S→C | GET /events | per-session | SSE stream is emitted uncompressed (hijacks before compress hook) |
| L16 | S→C | GET /events | per command event | origin.writerSessionId rides every frame (usable only by author) |
| L17 | S→C | POST /projection/chatMessages/bulk | export only | Resolved: bulk chat response omits reroll `alternates` |
| L18 | both | POST /projection/chatMessages/bulk | export only | Bulk endpoints have no maxItems bound and no per-chat window |
| L19 | S→C | POST /import/bundle | per import | Resolved: import response omits unbounded unsupportedReferences/detail |
| L20 | S→C | POST /import/realm-character | per import | Realm SSE re-sends a constant phase/message string per asset frame |
| L21 | S→C | GET /proxy/stream-jobs/:id/ws | LAN stream | Resolved: WS negotiates perMessageDeflate |
| L22 | S→C | GET /storage/list | per save | Resolved: remote-block existence uses a single-key check |

---

## High-Severity Findings

### H1 — Bootstrap ships all `botPresets` in full, and each preset's `promptTemplate` duplicates the field bootstrap already lazy-strips

- Status: remediated 2026-06-13. Bootstrap and preset field projections now
  ship lightweight preset stubs, while full preset data is fetched through
  per-preset lazy hydration when a consumer needs `promptTemplate` or full
  generation settings.
- Direction / endpoint: S→C, `GET /api/v1/bootstrap`.
- Frequency: every cold load / first connect, and again on every full resync
  (gap / reconnect / restore).
- What is over-transmitted: all preset objects in full. Measured against the
  real `data/risu.db`: `bot_presets` = 1,062,118 bytes (≈44% of a 2.4 MB
  bootstrap), of which the per-preset `promptTemplate` arrays are ≈933 KB
  (52,831 / 374,129 / 185,097 / 196,936 / 59,084 / 62,218 / 2,900 bytes).
- Why unnecessary: bootstrap deliberately strips the top-level
  `database.promptTemplate` so the client hydrates it lazily
  (`stripLazyBootstrapFields` deletes *only* `promptTemplate`,
  `repository.ts:1403-1406`), but the identical content rides inside every
  `botPresets[i].promptTemplate`, defeating the optimization. The active
  preset's copy is provably equal to the stripped top-level field
  (`saveCurrentPresetLocal` writes `db.promptTemplate` back into
  `botPresets[botPresetsId].promptTemplate`, `database.svelte.ts:2398`; `setPreset`
  reads it on switch, `:2699`). The preset list UI reads only `name`/`image`
  (`botpreset.svelte:149,236`).
- Magnitude: ~933 KB of preset `promptTemplate` per cold load and per resync
  (compresses well, but still the single largest projection contributor); ~7×
  multiplier (all presets shipped vs. at most one consumed on a switch).
- Nuance: non-active presets' `promptTemplate` *is* consumed on demand by the
  prompt-diff feature (`PromptDiffModal.svelte:367` reads
  `db.botPresets[id].promptTemplate` for arbitrary ids), so they cannot simply be
  deleted — they need the lazy-fetch endpoint below.
- Completed remediation: bootstrap stubs all presets to
  `{id, name, image, metadata}`; `GET /api/v1/projection/preset?id=` returns one
  full masked preset; preset command-event field refreshes remain stubbed; client
  preset switch/copy/download and prompt-diff consumers hydrate full presets on
  demand. Preset hydration ignores stale projection revisions, and current-preset
  saves no longer overwrite an unloaded `promptTemplate` with `null`.
- Evidence: `server/fastify/src/repository.ts` (`stubBotPresets`,
  `loadPresetHydration`, bootstrap projection), `server/fastify/src/routes/projection.ts`
  (`mode: 'preset'` hydration and stubbed field refresh), `src/ts/server/projection.ts`
  (`fetchServerPresetProjection`), `src/ts/storage/database.svelte.ts`
  (`ensureBotPresetHydrated`, preset switch/copy/download hydration),
  `src/lib/Others/PromptDiffModal.svelte` (diff hydration), and regression
  coverage in `server/fastify/__tests__/bootstrap.test.ts`,
  `server/fastify/__tests__/projection.test.ts`,
  `server/fastify/__tests__/commands.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`, and
  `src/ts/storage/database.svelte.test.ts`.

### H2 — Resolved: swipe/reroll navigation used to re-upload the entire chat transcript when only the tail message(s) changed

- Status: remediated 2026-06-13. Swipe/reroll now routes single tail data
  swaps through `PATCH /api/v1/commands/messages/:messageId`, pure truncates
  through `POST /api/v1/commands/chats/:chatId/messages/truncate`, and saved
  candidate tail slices through `POST /api/v1/commands/chats/:chatId/messages/tail`.
  Focused regression coverage exists in `rerollNavigation.test.ts`,
  `rerollNavigation.rollback.test.ts`, and `server/commands.test.ts`.
- Direction / endpoint: C→S, `PUT /api/v1/commands/chats/:chatId/messages`.
- Frequency: per swipe/reroll navigation to a saved candidate — a frequent
  interactive chat action.
- What is over-transmitted: the complete `message[]` array (every message's
  role, full `data` text, `promptInfo.promptText` — the entire prompt per
  message — `generationInfo`, etc.), uncompressed, when typically only the
  trailing assistant turn changed.
- Why unnecessary: the server already holds the prior transcript and computes
  a common-prefix row diff, deleting/inserting only from the first divergence
  (`applyChatMessageDiff`, `messageStore.ts:435-464`) — so it provably needs only
  the changed tail. The cheap path already exists and is used elsewhere:
  `applyTailDataSwap` uses a single `updateMessageCommand`, and a dedicated
  `POST /chats/:id/messages/truncate` (taking only `{baseRevision, afterMessageId}`)
  is already used by `Chat.svelte`.
- Magnitude: O(full transcript). A long chat is easily tens-to-hundreds of KB
  of JSON; swapping one ~1–5 KB candidate re-sends the whole history each time —
  a 10×–100× inflation on a per-click action. The cleanest proof is
  `applyRerollTruncate` (`rerollNavigation.svelte.ts:217`): a *pure truncate* that
  nonetheless sends the full surviving array via replace.
- Completed remediation: N=1 tail data swaps use `updateMessageCommand`, pure
  truncates use the existing truncate endpoint, and multi-row saved-candidate
  swaps use a `replaceTailMessages {afterMessageId, messages}` command so the
  request body scales with changed rows, not transcript length.
- Current evidence: `src/ts/process/rerollNavigation.svelte.ts:107-160`
  dispatches data swaps, tail-slice swaps, and truncates through targeted
  helpers; `src/ts/chatCommands.ts:1073-1186` maps those helpers to
  `updateMessageCommand`, `truncateMessagesCommand`, and
  `replaceTailMessagesCommand`; `src/ts/server/commands.ts:2182-2238` sends the
  bounded request bodies; `server/fastify/src/routes/commands.ts:3631-3723`
  implements the truncate and tail replacement routes.

### H3 — Resolved: editing a single lorebook entry used to re-upload the entire lorebook collection

- Status: remediated 2026-06-13. Debounced entry edits now send one entry via
  scoped upsert commands; simple deletes send one entry id; pure reorders send
  only an id list. The full `PUT .../lorebooks` routes remain as the fallback for
  bulk import/replace and mixed changes that cannot be represented by one compact
  delta.
- Direction / endpoint: C→S,
  `PUT /api/v1/commands/characters/:id/lorebooks` (and `/chats/:id/lorebooks`,
  `/modules/:id/lorebooks`, `/lorebooks/:id/entries`).
- Frequency: per lorebook edit burst (debounced 250 ms) — fires on any entry
  field edit, an `alwaysActive`/`selective` toggle, or add/remove/reorder of a
  single entry.
- What is over-transmitted: every entry of the lorebook (`key`, `secondkey`,
  the unbounded free-text `content`, `comment`, `insertorder`, `mode`,
  `alwaysActive`, `selective`, `folder`, plus extras) is re-sent even when only
  one entry's one field changed.
- Why unnecessary: the server already holds the full lorebook and simply
  assigns the incoming array (`character.globalLore = entries`,
  `commands.ts:4039`). A per-entry upsert/delete keyed by id would carry only the
  delta. (Confirmed the existing `source === 'entry'` machinery only affects
  client-local rollback granularity — the wire payload is still the whole
  collection.)
- Magnitude: O(all entries). Lorebooks with dozens of multi-KB-content
  entries are common; re-sending the whole book to toggle one checkbox is
  10×–100× the needed bytes per burst.
- Completed remediation: added per-entry lorebook commands (upsert by id,
  delete by id, reorder by id list) for global lorebooks, character `globalLore`,
  chat `localLore`, and module lorebooks; kept the full PUT only for
  bulk/mixed-shape replacement.
- Current evidence: `applyLorebookEntryDraftEdit` now routes single-entry
  debounced edits through compact upsert commands; collection replacement
  dispatch detects simple upsert/delete/reorder deltas before falling back to full
  replacement; typed client helpers live in `src/ts/server/commands.ts`; Fastify
  scoped entry routes live in `server/fastify/src/routes/commands.ts`; server
  validators/mutators live in `server/fastify/src/commands/lorebooks.ts`.

---

## Medium-Severity Findings

### M1 — `generation.persisted` projection re-ships the entire transcript instead of a tail/delta

- Status: remediated 2026-06-13. The generation projection now uses the
  event message id to return the changed message's absolute-index tail via
  `loadChatHydrationRange`, including `messageStart`/`messageTotal`; the client
  splices that range into the existing transcript instead of replacing the whole
  array.
- Direction / endpoint: S→C, `GET /api/v1/projection/generation?parentId=<chatId>`.
- Frequency: per foreign `generation.persisted` event (other tabs/devices
  live-viewing the same chat; the originating session is own-echo-skipped). Not
  per-keystroke, but unbounded in size.
- What is over-transmitted: the full `message[]` (plus `hypaV3Data`,
  `alternates`) for the affected chat, though only the single newly-persisted turn
  changed.
- Why unnecessary: the generation branch calls `loadChatHydration` with no
  range (`projection.ts:394-409`), returning every row; the client replaces the
  whole array (`hydrateServerChatMessages` with no `range`, full-replace at
  `database.svelte.ts:1049`). The tail-merge path already exists —
  `loadChatHydrationRange` returns `messageStart`/`messageTotal`
  (`repository.ts:1572-1605`) and `hydrateServerChatMessages` already supports a
  placeholder-aware splice-merge `range` (`database.svelte.ts:1031-1047`); only
  this branch and its wrapper fail to use them.
- Magnitude: up to the full chat per event — measured top chat
  `772eff9f` = 278 messages / 2.65 MB. For an active long chat under multi-session
  viewing, each foreign turn re-ships megabytes vs. a few-KB delta.
- Completed remediation: the projection branch calls
  `loadGenerationChatHydration`, which cuts from the event's persisted message id
  when available and falls back to a small tail otherwise. The response carries
  `messageStart`/`messageTotal`; `applyServerChatMessagesProjection` forwards
  that range into `hydrateServerChatMessages`.
- Current evidence: `server/fastify/src/routes/projection.ts`
  (`resource === 'generation'` branch);
  `server/fastify/src/repository.ts` (`loadGenerationChatHydration`);
  `src/ts/bootstrap.ts` (`generation-chat` apply path);
  `src/ts/server/chatMessageHydration.svelte.ts`
  (`applyServerChatMessagesProjection` range parameter); regression coverage in
  `server/fastify/__tests__/projection.test.ts` and `src/ts/bootstrap.test.ts`.

### M2 — `prompt` SSE event ships a full `messages` projection that duplicates `formated` and is never read

- Status: remediated 2026-06-13. Fresh browser generation requests now send
  `clientCapabilities.compactPromptEvent: true`; the Fastify route omits
  `prompt.messages` for capable clients while keeping the legacy field for
  clients that do not advertise the capability.
- Direction / endpoint: S→C, `POST /api/v1/generate/chat` (and `/preview-prompt`).
- Frequency: per-generation (every send/regenerate/continue) and per manual
  preview.
- What is over-transmitted: the entire `messages: Array<{role, content}>` — one
  row per assembled prompt row (system card, persona, every lorebook entry, the
  full chat-history window) — whose `content` is the same text already in each
  corresponding `formated` row.
- Why unnecessary: `messages` is documented as a lossy `{role, content}`
  projection of `formated` (`sseEvents.ts:34-46`); the client reads only
  `formated`/`promptInfo`/`biases`. A literal search for `prompt.messages` across
  production code returns zero genuine consumers (only test fixtures). The durable
  replay path additionally double-buffers the identical frame.
- Magnitude: roughly the full prompt text a second time — ~3–12 KB per typical
  generation, tens of KB for big-lorebook chats.
- Completed remediation: the browser adapter appends
  `clientCapabilities.compactPromptEvent: true` to fresh `/generate/chat`
  requests; the server sanitizes the `prompt` event and `/preview-prompt` JSON
  response for capable clients. Legacy clients still receive the original field.
- Current evidence: `server/fastify/src/prompt/assemble.ts:1726` (built),
  `:1735` (`formated` in the same object);
  `server/fastify/src/routes/generationChat.ts` (`promptEventForClient`);
  `src/ts/process/request/serverChat.ts` (capability injection);
  regression coverage in `server/fastify/__tests__/generation.chat.test.ts` and
  `src/ts/process/request/tests/serverChat.test.ts`.

### M3 — Bulk upload never probes existence before re-sending asset bytes the server already stores

- Status: remediated 2026-06-13. `saveAssets` now hashes each input with
  SHA-256, calls the existing `/api/v1/assets/exists` probe once with unique ids,
  uploads only ids reported missing, de-duplicates repeated missing ids within
  the same import batch, and returns the original input ids in order.
- Direction / endpoint: C→S, `POST /api/v1/assets/bulk`.
- Frequency: on-import (character/card import; per imported asset batch).
- What is over-transmitted: the entire byte payload of every asset in an
  import, including assets whose `sha256` already exists on the server. The
  existence probe (a tiny request of 64-hex ids returning only the missing
  subset) is never used.
- Why unnecessary: the server is content-addressed and detects duplicates by
  `sha256` (`repository.ts:1956-1965`) returning `created:false` after the
  full bytes already crossed the wire. The `/assets/exists` endpoint is fully
  implemented (`assets.ts:256-284`) but has zero client callers (verified:
  no `src/` reference). Hashing client-side and probing first would upload only
  genuinely-missing assets.
- Magnitude: up to a full import's asset bytes on every re-import / shared-
  character import (often several MB of emotion/additional images), bounded only
  by the 32 MB/32-item batch chunking. Zero on the first import of a new
  character.
- Completed remediation: the client pre-hashes import assets with Web Crypto,
  probes `/assets/exists`, uploads only missing unique ids, validates the
  content-addressed ids returned by upload, and reuses known ids without sending
  bytes.
- Current evidence: client `src/ts/globalApi.svelte.ts` (`saveAssets`,
  `sha256Hex`, `findMissingServerAssetIds`, and missing-id stitching); server
  existence probe `server/fastify/src/routes/assets.ts` →
  `repository.ts:697-701,2014-2016`; server dedup remains as a race-safe fallback
  in `repository.ts:1956-1965`; import callers
  `src/ts/characterCards.ts:236,632-640,675-689,724`.

### M4 — Stream-job WebSocket base64-encodes every LLM chunk inside JSON (~33% inflation)

- Status: remediated 2026-06-13. Proxy stream chunks now ride as binary
  WebSocket frames. JSON frames are reserved for control events
  (`job_accepted`, `upstream_headers`, `ping`, `done`, `error`), and the browser
  sets `binaryType = 'arraybuffer'` so chunks enqueue directly into the
  `ReadableStream<Uint8Array>`.
- Direction / endpoint: S→C, `GET /api/v1/proxy/stream-jobs/:id/ws`.
- Frequency: per upstream chunk on every local-network streaming LLM
  generation (`openai_streaming` interceptor) — many frames per message.
- What is over-transmitted: each upstream byte is sent as base64 text
  (4 chars per 3 bytes) wrapped in `{"type":"chunk","dataBase64":"..."}`, instead
  of the raw bytes the equivalent HTTP proxy path streams.
- Why unnecessary: the client immediately base64-decodes back to a
  `Uint8Array` (`proxyJobWs.ts:21`), and the HTTP `/proxy/fetch` fallback for the
  same request streams the body raw (`routes/proxy.ts:78`). The base64 layer is
  unique to the WS path and exists only to fit a text frame; the client already
  enqueues into a `ReadableStream<Uint8Array>` controller and could take binary
  frames directly.
- Magnitude: ~33% inflation of the entire streamed response, plus a ~30-byte
  JSON envelope per (small) token frame — so 33% is a lower bound.
- Nuance: scoped to `local_network` streaming (Ollama/LM Studio on the user's
  LAN), so the bytes don't cross the internet — which is why this is medium, not
  high.
- Completed remediation: `JobRegistry.pushBinary` buffers and fans out raw
  `Buffer` frames with the same backpressure and no-viewer overflow limits as
  control frames. `runStreamJob` sends upstream chunks through that binary path.
  The browser consumes binary `ArrayBuffer` frames directly while retaining a
  legacy decoder for old JSON chunk frames.
- Current evidence: `server/fastify/src/streamJobs.ts` (`StreamJobFrame`,
  `pushBinary`, binary pending-frame accounting, and `runStreamJob` chunk
  dispatch); `server/fastify/src/routes/streamJobs.ts` (`socket.send(frame)`);
  `src/ts/globalApi.svelte.ts` (`ws.binaryType = 'arraybuffer'` and binary chunk
  enqueue); `src/ts/network/proxyJobWs.ts` (`readProxyJobWsBinaryChunk`).

---

## Low-Severity Findings

### Bootstrap / projection (S→C)

#### L1 — Resolved: module/plugin bodies use a revisioned bootstrap body cache

Bootstrap now ships module/plugin metadata stubs plus a `bodyCache` payload with
the global cache epoch, per-object body revisions, and only missing/stale bodies.
The browser sends its cached manifest in `x-risu-body-cache-manifest`,
reconstructs full `database.modules` and `database.plugins` from local cache plus
returned bodies before applying the projection, and then updates the cache. The
first uncached load still receives the bodies; subsequent cold loads and full
resyncs omit unchanged module lorebook/regex/trigger/asset/script bodies and
unchanged plugin scripts. Schema v16 persists `projection_body_cache_state` and
`collection_body_revisions`; imports/restores bump the epoch so stale browser
cache entries cannot collide across database replacements. Evidence:
`server/fastify/src/repository.ts` (`loadBootstrapProjectionDatabaseWithBodyCache`,
body stubs, revision tracking), `server/fastify/src/routes/bootstrap.ts`
(manifest header and `bodyCache` response), `src/ts/server/bootstrapBodyCache.ts`
(browser cache/reconstruction), and regression coverage in
`server/fastify/__tests__/bootstrap.test.ts` and
`src/ts/server/bootstrap.test.ts`.

#### L2 — Full-bootstrap resync re-pulls the entire projection

Any gap/reconnect calls `forceServerProjectionResync` →
`fetchServerBootstrapProjectionReadOnly` and wholesale-replaces the DB
(`projectionResync.ts:67,75,83-92`), even when only a few resources changed since
the client's cached revision. `command_events` already records `{revision, type,
resource, id, parent_id}` per revision (`db.ts:383-391`), so a
"changes-since-revision-R" endpoint could ship only affected resources, falling
back to full bootstrap only when the event log no longer covers R. *Nuance:* rare
(single-writer invariant means steady-state gaps essentially only arise on SSE
reconnect/replay-unavailable); this is a self-healing recovery cost, not a hot
path.

Decision: keep the current full-bootstrap fallback for L2 rather than adding
a revision-delta resync endpoint now. Normal command-event handling already
applies one affected resource at a time, and the full-bootstrap path is reserved
for rare recovery cases where a revision gap cannot be replayed safely. Revisit
only if traces show frequent replay-unavailable/gap recovery, or if full resyncs
remain large after the completed bootstrap body-cache work. Triggers:
`src/ts/bootstrap.ts:343,383,422-425,429`.

### Commands write-path (C→S)

#### L3 — Editing one regex script or trigger re-uploads the whole array

Same pattern as H3 for `customscript`/`triggerscript`/`module.regex`/
`module.trigger`: a single-element change re-sends the whole array
(`scriptDefinitionBridge.svelte.ts:340-408`; server overwrite
`commands.ts:4745,4781,4817,4844-4870`). Trigger `effect[]` arrays carry
multi-KB Lua/CBS code. Lower than H3 because the 250 ms debounce coalesces bursts
to one request and it is an authoring path scoped to the open panel, not a
generation/chat-select hot path. Fix: per-definition upsert/delete/reorder by id.

### Generation SSE (S→C)

#### L4 — Resolved: `prompt` event shipped unread `lorebookActivation`

Remediated 2026-06-13 behind the same
`clientCapabilities.compactPromptEvent` flag as M2. The full
`LorebookActivationReport` is still built for assembly internals, but it is no
longer emitted to compact-capable `/generate/chat` SSE clients or
`/preview-prompt` JSON callers. Legacy clients still receive the original field.

#### L5 — Terminal `done.result` duplicates streamed completion text

`emitSuccessDone` always stamps the full accumulated text onto `done`
(`providerTransport.ts:55-63`); the client reads it only when
`tokenResult.length === 0` (`serverChat.ts:452-457`), so on a live stream it is a
redundant second copy (~2–16 KB/generation). *Nuance:* `done.result` is not
dead — it is the durable-reattach recovery payload (`done` is replay-protected
while `token` is evicted first, `streamJobs.ts:79-87`), and a single emitted frame
goes to both the live socket and the replay buffer, so suppressing it only on the
live socket needs an architectural split.

Design direction: for compact-capable clients, replace the live-stream
`done.result` copy with a final result digest such as
`{resultHash, resultLength}`. The browser compares the digest against the text it
assembled from streamed `token` deltas; if it matches, no final text copy is
needed. If the accumulated text is empty, incomplete, or hash-mismatched, the
client fetches the final persisted generation result through a recovery endpoint
or the changed chat-tail projection and applies that result. Use SHA-256 (or an
existing project-standard digest) rather than MD5, since browser Web Crypto
supports SHA-256 directly. Keep legacy `done.result` behavior until the compact
path has both the digest check and fallback fetch wired, because the hash alone
can detect corruption/missing tokens but cannot reconstruct the missing text.
Low-priority.

#### L6 — Resolved: `preview_prompt` returned unused prompt payload

Remediated 2026-06-14. Compact-capable clients now receive only
`{promptInfo: {promptText}}` from `/api/v1/generate/preview-prompt`;
legacy/non-compact callers keep the previous full prompt payload.

Current evidence: `server/fastify/src/routes/generationChat.ts`
(`promptEventForClient`) and regression coverage in
`server/fastify/__tests__/generation.chat.test.ts`.

#### L7 — Resolved: `replace_all` carried the full persisted transcript

Remediated 2026-06-14. Compact-capable `message_patch` events now serialize the
existing `firstChangedIndex` and send only the changed suffix. The browser
splices that suffix into the cached transcript; an empty suffix intentionally
truncates from `firstChangedIndex`. Legacy clients still receive the full
`replace_all` message array.

Current evidence: `server/fastify/src/routes/generationChat.ts`
(`messagePatchForClient`), `src/ts/process/request/serverChatEvents.ts`,
`src/ts/process/request/serverMessagePatch.ts`, and regression coverage in
`server/fastify/__tests__/generation.chat.test.ts` plus
`src/ts/process/request/tests/serverMessagePatch.test.ts`.

### Assets (C→S)

#### L8 — Resolved: bulk upload used base64 JSON for asset bytes

Remediated 2026-06-13. Missing multi-asset batches now use
`application/vnd.risu.assets-bulk`: a 4-byte manifest length, compact JSON
metadata (`contentType`, `size`), and concatenated raw bytes. The legacy JSON
base64 shape remains accepted for compatibility, but the live client no longer
uses it. Single missing assets still use the existing raw `/assets` route.
Covered by binary-framed route regression coverage in
`server/fastify/__tests__/assets.test.ts`.

### Memory

#### L9 — Resolved: `GET /memory/jobs` returned full job rows

Resolved 2026-06-13. `GET /memory/jobs` now uses the projected
`listMemoryJobItems` query (`id/chatId/kind/status/attemptCount/maxAttempts`) and
sets an ETag for the compact list. `listMemoryJobs` still returns the full row
for worker/internal paths.

Original finding: `listMemoryJobs` did `SELECT *` and `mapMemoryJobRow` emitted
`id/chatId/kind/status/payload/error/attemptCount/maxAttempts/nextRunAt/createdAt/
updatedAt` (`memoryRepository.ts:404-424,901-911`); the modal renders only
`kind/status/attemptCount/maxAttempts/id`. `payload` (summarize jobs embed a
`messageIndexes` int array + `chatMemos` UUIDs scaling with window size) is pure
dead weight. *Nuance:* the route is server-filtered to `['pending','running']`, so
N is small, and gzip collapses the repetitive numeric/UUID data — real but low.
Current evidence: `server/fastify/src/memoryRepository.ts` (`MemoryJobListItem`,
`listMemoryJobItems`); `server/fastify/src/routes/memoryJobs.ts`
(`GET /memory/jobs` projected response); coverage in
`server/fastify/__tests__/memoryJobsRoutes.test.ts`.

#### L10 — Resolved: memory job events caused whole-list refetches

Resolved 2026-06-13. The modal now upserts/removes the compact `event.job` from
the in-memory list and reserves REST fetches for initial load, manual refresh,
and reconciliation polling.

Original finding: `server-memory-jobs.svelte:107-111` called `void refreshJobs()` (full GET) for
every event whose `chatId` matches, although the event already carries the
changed job's renderable fields. Fix: upsert the single job from the event into
the in-memory array; reserve the GET for initial mount and the reconciliation
poll. *Nuance:* the subscriber mounts only while the HypaV3 modal is open, and an
in-flight-dedup collapses bursts to ~one trailing refresh — modest real impact.

#### L11 — Resolved: memory job polling lacked ETag/304

Resolved 2026-06-13. `GET /memory/jobs` now returns an ETag and honors
`If-None-Match`; the browser refresh controller stores the last ETag/list and
uses the cached list on `304 Not Modified`.

Original finding: a 5 s `setInterval` polled `GET /memory/jobs` while any job is pending/running and the modal is open
(`memoryJobRefresh.ts:3,47-56`); identical lists are re-sent with no conditional
request. *Nuance (corrects the finder):* the SSE channel is only a fetch trigger,
not state delivery (it carries one job's scalars, and the consumer reacts by
firing the same GET), so the poll is a genuine fallback, not a redundant duplicate
of an SSE payload. The real lever is L9 (drop `payload`) + an ETag/304.

#### L12 — Resolved: `memory.job` frames carried unread status fields

Resolved 2026-06-13. `memory.job` frames now carry `{type, chatId, job}` where
`job` is the compact renderable item (`id/kind/status/attemptCount/maxAttempts`),
plus the existing Hypa V3 progress side-effect. The client validator accepts this
compact shape.

Original finding: `buildMemoryJobEvent` serialized `jobId/kind/status/attemptCount/maxAttempts/
nextRunAt/error` plus a `hypav3` side-effect (`memoryEvents.ts:70-99`); the only
consumers read `event.chatId` (then re-fetch via REST) and
`open/miniMsg/msg/subMsg`. ~50% of each ~400-byte frame is unread (measured
407→202 bytes). Fix: reduce the live frame to `{type, chatId}` + the 4-field
progress payload (also requires relaxing the client validator
`events.ts:199-202`, which currently hard-rejects frames missing the fields).

#### L13 — `memory.job` frames broadcast to every client

The SSE endpoint keeps no per-client current-chat state, so every frame
reaches every connected tab/device (`events.ts:152-157`,
`memoryEvents.ts:52-56`). *Nuance:* not purely "received and dropped" — every tab
applies the global, non-chat-scoped `hypaV3ProgressStore`
(`bootstrap.ts:307-312` → `serverMemory.ts:72-89`), so the only true waste is in
the multi-tab case. The high-value fix is the L12 payload trim; relevance scoping
(a client current-chat hint) is optional.

Decision: keep global memory-job broadcast unchanged. Current and previous
RisuAI behavior is not designed around multiple active devices sharing one
server concurrently; in practice, users normally have a single active
connection, and write access is effectively owned by the most recently active
client. With L12 already trimming the payload, per-client current-chat tracking
would add protocol/state complexity for little real-world byte savings. Revisit
only if multi-client active use becomes a supported product goal.

#### L14 — Memory chunk and summary reads are unbounded

`GET /memory/chunks|summaries/:id` routes return full chunk/summary text for an
entire chat with no pagination/projection/count option
(`memoryReads.ts:31,47-52`; `memoryRepository.ts:521-530,605-614`). No `src/`
consumer today (only tests/smoke). Flagged so the over-fetch shape is fixed
*before* these are wired to UI: add `limit`/`sinceSeq` and a count-only/id-only
variant.

### Events SSE (S→C)

#### L15 — The SSE event stream is emitted uncompressed

The route hijacks and writes raw frames (`events.ts:62,123-160`), bypassing
`@fastify/compress`. *Nuance (corrects the finder):* impact is small — frames are
105–177-byte delta
descriptors (heartbeat 13 bytes), already below the 1024 compress threshold, and
per-frame `Z_SYNC_FLUSH` on tiny frames recovers little (the 60–80% figure assumes
a buffered corpus). Not clearly worth the per-frame-flush complexity; record as
known.

Decision: keep the SSE event stream uncompressed. Command/memory frames are
already compact and heartbeats are tiny, while adding compression to a raw
hijacked SSE stream would introduce per-frame flush complexity for little
practical byte savings.

#### L16 — Command frames keep `origin.writerSessionId`

`origin.writerSessionId` rides on every command frame but is usable only by the
authoring client. ~64 bytes/frame that a foreign recipient can never match
(`bootstrap.ts:432-435`). *Nuance (corrects the finder):* this is not
safely removable — the SSE echo can arrive before the author's HTTP write-response
advances its cached revision, and without `origin` the author would treat its own
echo as foreign and fire a wasteful resource re-fetch (`bootstrap.ts:350-351`). In
the dominant single-tab case the only recipient is the author, who consumes it.
Treat as acceptable-as-is, not a fixable waste.

Decision: keep `origin.writerSessionId` on command frames. It prevents the
authoring client from treating its own SSE echo as a foreign write when the echo
arrives before the HTTP command response updates the cached revision. The small
per-frame cost is acceptable under the dominant single-active-client model.

### Bulk hydration (S→C)

#### L17 — Resolved: bulk chat hydration shipped discarded alternates

Remediated 2026-06-14. Bulk chat hydration now opts out of loading grouped
alternates and omits `alternates` from each bulk row. Single-chat hydration still
returns alternates so the active chat can restore its reroll buffer.

Current evidence: `server/fastify/src/repository.ts` (`loadChatHydrations`
`includeAlternates` option), `server/fastify/src/routes/projection.ts`
(`chatMessages/bulk`), `src/ts/server/projection.ts`,
`src/ts/server/chatMessageHydration.svelte.ts`, and regression coverage in
`server/fastify/__tests__/projection.test.ts` and
`server/fastify/__tests__/serverLoadCostHarness.test.ts`.

#### L18 — Bulk endpoints are unbounded

`bulkChatMessagesBodySchema` caps neither the id list nor the per-chat window
(`projection.ts:128-140,474-488`); `ensureAllChatsHydrated` sends every chat of
every character in one POST. *Honest classification:* for the export use case the
bytes are fully consumed — there is no redundant transfer — so this is a
request-size/buffering hardening item (add `maxItems`, chunk the export into
bounded pages), not transfer waste per se. Listed for completeness.

Design direction: treat `ensureAllChatsHydrated` as deprecated and track its
remaining callers separately for later optimization. Ideally no workflow should
hydrate every chat into the live browser projection; if a workflow truly needs
the whole corpus, it should process chats in bounded chunks or a streaming export
pipeline rather than loading all transcripts into memory at once. A future fix
should inventory current `ensureAllChatsHydrated` callers, replace export/dataset
paths with streaming or chunked processors, and then add server-side `maxItems`
limits so bulk projection requests stay bounded.

### Import / export (S→C)

#### L19 — Resolved: bundle import responses echoed discarded fields

Remediated 2026-06-14. Import responses now keep `{revision, event}` plus
bounded scalar summary fields (`incompleteChatCount`, `unsupportedReferenceCount`,
asset/bundle counts where already useful). They no longer echo `format`,
`envelope`, or the full `unsupportedReferences` array.

Current evidence: `server/fastify/src/routes/save.ts` and regression coverage in
`server/fastify/__tests__/risuSaveImportRoute.test.ts` plus
`server/fastify/__tests__/risuSaveBundleImportRoute.test.ts`.

#### L20 — Realm-import progress repeats phase and message text

`createStepProgress` re-emits `{phase, message, percent}` per staged/saved asset
though only `percent` changes intra-phase
(`realmImport.ts:1491-1499,475-479`); the client `readProgressFrame` requires all
three. ~50–70 redundant bytes/frame; realistic cards have a handful-to-dozens of
assets (~1–3 KB), and it is localhost + once-per-import — trivial. Fix: emit
`message`/`phase` once per phase, percent-only deltas after (small client change),
or throttle per-asset progress.

Decision: keep Realm-import progress frames unchanged for now. The redundant
phase/message bytes are tiny, once-per-import, and the current client parser
requires complete progress frames. Revisit only if the Realm progress protocol is
being changed for another reason.

### Proxy / hub / legacy (S→C)

#### L21 — Resolved: stream-job WebSocket skipped compression

Remediated 2026-06-13. `fastifyWebsocket` now registers with
`{ options: { perMessageDeflate: true } }`, so compatible clients can negotiate
compression for stream-job control and binary chunk frames. This is LAN-scoped
and still trades CPU/memory for bytes, but the route no longer skips the
available WS compression path.

#### L22 — Resolved: remote-block existence fetched the full storage key list

Remediated 2026-06-14. `encodeRemoteBlock` now calls a storage `hasItem` helper;
Fastify storage implements it through authenticated `GET /api/v1/storage/exists`,
so one remote block existence check returns one boolean instead of the full save
key list. Non-Fastify-compatible storage can still fall back to `keys()`.

Current evidence: `server/fastify/src/routes/legacyStorage.ts`,
`server/fastify/src/routeManifest.ts`, `src/ts/storage/fastifyStorage.ts`,
`src/ts/storage/autoStorage.ts`, `src/ts/storage/risuSave.ts`, and regression
coverage in `src/ts/storage/fastifyStorage.test.ts` plus
`server/fastify/__tests__/auth.test.ts`.

## How To Verify

- Sizes were measured against the real `data/risu.db` (66 MB) via `sqlite3`
  byte-length sums on `bot_presets`, `modules`, `plugins`, and chat message JSON.
- For each open finding, the over-transmission is reproducible by reading the cited
  server serializer and confirming the client consumer ignores the field
  (grep the field name across `src/` excluding tests). The `file:line` anchors in
  each finding are the entry points.
- Existing regression coverage asserts bootstrap/preset field projections contain
  only preset stubs and full preset data is served through lazy per-preset
  hydration (H1). Focused tests also guard L6 compact preview projection, L7
  compact `replace_all` suffix application, L17 bulk alternates omission, L19
  bounded import responses, L22 single-key storage existence, the H2 targeted
  swipe/reroll command routing, the M1 ranged generation projection, and the
  M2/L4 compact prompt event behavior.
