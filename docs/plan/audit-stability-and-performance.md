# Stability And Performance Audit

Date: 2026-06-04.

This is a fresh, broad audit of the current Fastify-only RisuAI codebase for
**stability** and **performance** issues. It was prompted by the three recently
completed performance workstreams (deep-clone narrowing, server/client protocol
stability, lazy projection) and is intended to find what those targeted efforts
did not cover.

The code is the source of truth. Every finding below was located in the current
code and then independently re-verified against that code (see *Method*). Line
numbers are accurate as of this date but will drift; treat the cited symbol
names as the durable anchor.

## Scope And Context

- **Deployment model: single-user self-host.** There is no multi-tenant/hosted
  mode. Severity is judged accordingly: a bug that crashes the one server
  process, loses the one user's data, or hangs their UI is serious; a problem
  that would only matter across tenants is not.
- **Not yet released, no real users.** DB migrations are a non-concern and the
  `data/` folder is a disposable backup. Data *loss/corruption during normal
  use* is still a real stability concern; data *migration* risk is not.
- **Three workstreams already landed** (`docs/archive/frontend-performance`,
  `docs/archive/server-client-protocol-stability-performance`,
  `docs/archive/lazy-projection`). This audit verified the current code rather
  than re-reporting what they fixed. Where a landed narrowing left a specific
  caller or path on the old broad pattern, that is called out.
- **`docs/archive/leftover.md`** tracks known, deliberately-deferred,
  evidence-gated follow-ups. Findings that match a leftover item are still
  listed here, tagged **[known-leftover]**, so this audit is a complete picture;
  the genuinely new issues are the priority.

## Method

The audit fanned out across ten areas — server prompt-assembly/generation,
command mutations + SQLite, projection/bootstrap/events, jobs/streaming/timers,
Hypa V3 memory, Lua runtime + provider adapters, import/export/assets/backups,
client projection-sync/bridges, client state-store/snapshots, and client
generation/parsing/rendering. Each area produced grounded candidate findings;
**every candidate was then handed to an independent adversarial verifier** that
re-read the cited code, checked whether the path is live (not dead /
local-assembler-only / test-only), checked whether a landed workstream or guard
already mitigates it, cross-checked `leftover.md`, and re-scored severity under
the single-user self-host model.

Raw counts: 67 candidates → **58 confirmed**, 4 context-dependent, 5 dismissed.
After deduping (two finders independently found the same prompt-assembly load),
the confirmed set is **3 high, 14 medium, 40 low**. The dismissed and
context-dependent findings are recorded at the end so they are not re-opened./ef

## Cross-Cutting Themes

Most individual findings are instances of five recurring patterns. Fixing the
pattern is usually higher-leverage than fixing one call site.

1. **Server reconstitutes a broad in-memory `Database` on hot paths.** The
   lazy-projection workstream moved messages into SQLite and made the *wire*
   payload lean, but the *server* still calls `loadPersisted` /
   `loadPersistedWithMessages` (which run `loadCharactersFromSqlite`,
   `loadCollectionsFromSqlite` over all 9 collection tables, and
   `getAllAssetMetadata`, `JSON.parse`-ing every row) on most write and read
   paths — every command mutation, prompt assembly, chat-message hydration
   fallback, single-character projection, bulk hydration, asset GC, import
   report, and memory batch. There is **no per-request memoization** and **no
   field-scoped SQLite loader actually wired on a hot path**. Cost scales with
   total corpus size, not the row being touched. (M1, M3, H1, M5, M11, several
   lows.)

2. **Client whole-corpus deep clones survive on hot/warm paths.** Several
   callers still use `currentChatStateSnapshot()` /
   `cloneJsonValue(DBState.db.characters)` (= `JSON.parse(JSON.stringify(...))`
   over every character and every hydrated transcript) for a rollback that only
   needs one scalar or one row. The frontend-performance workstream narrowed the
   snapshot *family* but missed specific callers — most notably **chat
   selection, which has no scalar-snapshot analog** (`CharacterSelectionSnapshot`
   exists; `ChatSelectionSnapshot` does not). (H2, M13, M14, M12, several lows.)

3. **Streaming re-does O(message) work per token.** No render coalescing exists
   between the per-provider-delta SSE frame and a full CBS+markdown+DOMPurify
   re-parse of the whole growing message, making long streamed responses
   accidentally O(length²) on the main thread. (H3.)

4. **Outbound fetches lack preventive timeouts / abort propagation.**
   Non-streaming provider calls, the legacy proxy `/fetch` route, and the Lua
   runtime rely on client-disconnect abort only; a hung/slow upstream is bounded
   only by Node/undici defaults, and client disconnect does not cancel in-flight
   work. (M7, M9, several lows.)

5. **Decompression/buffering without preventive caps.** Size limits are checked
   *after* full materialization (gzip-bomb), SSE/stream buffers grow unbounded
   when a delimiter never arrives, and an aborted bundle download leaks an FD +
   stalled task. Less-common paths, but real stability foot-guns. (M10, M12,
   several lows.)

## Findings Index

| ID | Sev | Cat | Area | Title |
| -- | --- | --- | ---- | ----- |
| H1 | High | perf | server | Chat-message hydration falls back to a whole-corpus load on every normal chat-open and generation completion |
| H2 | High | perf | client | `changeChatTo` deep-clones the entire characters array on every chat-list click |
| H3 | High | perf | client | Streaming re-parses the entire growing message every token frame (accidentally quadratic) |
| M1 | Med | perf | server | Prompt assembly loads + parses the entire message corpus per send **[known-leftover]** |
| M2 | Med | perf | server | Per-message regex recompilation in the history `editprocess` walk |
| M3 | Med | perf | server | Every command mutation loads + parses all 9 collection tables (read side never narrowed) |
| M4 | Med | perf | server | `maskProviderSecrets` full JSON round-trip clone + `loadSingleCharacterRow` whole-array clone |
| M5 | Med | perf | server | `jsonPayloadBytes` full `JSON.stringify` on every projection/bootstrap response even when metrics are off |
| M6 | Med | both | server | Proxy `/fetch` does not abort upstream on client disconnect and has no request timeout |
| M7 | Med | both | server | `voyageContext3` embed batch materializes every chunk of a chat into one uncapped request |
| M8 | Med | stab | server | Non-streaming provider fetches have no upstream timeout, only client-driven abort |
| M9 | Med | stab | server | Legacy compressed `.risu` import fully decompresses before the size check (gzip-bomb) |
| M10 | Med | perf | server | Periodic asset GC + import asset report synchronously parse the whole message corpus |
| M11 | Med | stab | server | Bundle export hangs and leaks an FD + Zip when a client aborts a large download |
| M12 | Med | perf | client | `/setvar` + `/addvar` re-run the full `setDatabase` normalizer (incl. language-pack clone) per write |
| M13 | Med | perf | client | `changedCharacterFields` deep-clones the full character (chats + histories) twice, then discards |
| M14 | Med | perf | client | `setupSendChatContext` keeps the whole-corpus clone per message send |

40 low-severity findings follow in [Low-Severity Findings](#low-severity-findings).

---

## High-Severity Findings

### H1 — Chat-message hydration falls back to a whole-corpus load on every normal chat-open and generation completion

- **Category:** performance · **Area:** server · **known-leftover:** no
- **Location:** `server/fastify/src/repository.ts:1061` (`loadChatHydration`);
  callers `server/fastify/src/routes/projection.ts:287` (chatMessages) and
  `:395` (generation.persisted).

**What.** `loadChatHydration` early-returns the cheap table-backed path only
when `message.length > 0 && hypaV3Data !== undefined`. But `getChatHypaV3`
returns `undefined` for any chat that has never used Hypa V3 memory — the
overwhelming majority, since it is an opt-in feature with its own
`chat_hypa_v3` table and the writers only insert a row when `hypaV3Data` is
present. So for a normal chat the `hypaV3Data !== undefined` half is false, the
early return is skipped, and execution falls into the "defensive, not-yet
extracted" branch that calls `loadPersisted(db, dataDir)` — a full SQLite read
of settings, every collection table, and `loadCharactersFromSqlite`
(`JSON.parse` of every character row and every chat metadata row) — followed by
a whole-corpus `eachChat` scan. After all that, `hypaV3Data` is still
`undefined`, so the work contributes nothing.

**Impact / trigger.** Hot path: **every chat-open** (`hydrateActiveChat` →
`GET /projection/chatMessages`) and **every server-owned generation completion**
(`generation.persisted`) for a chat without Hypa V3 memory — i.e. the common
case. Cost scales with total corpus size (#characters × #chats × their
metadata), exactly what lazy-projection moved messages to SQLite to avoid. On a
large corpus, opening any non-Hypa chat or finishing any response runs a
synchronous full-corpus parse on the single event-loop thread. (The parse is of
character/chat *metadata*, not message bodies — chat rows are message-free
post-extraction — so it is lighter than the pre-lazy-projection load, but still
grows with library size and blocks the loop.)

**Fix.** Treat the messages table as authoritative once populated: early-return
whenever `message.length > 0` (a legitimately-`undefined` `hypaV3Data` must not
force a whole-corpus load — the embedded copy is absent in that case too, so the
fallback yields nothing). Only consult `loadPersisted` when the messages table
genuinely has zero rows for the chat. Add a test asserting `loadChatHydration`
does not call `loadPersisted` for a chat that has message rows but no
`chat_hypa_v3` row.

---

### H2 — `changeChatTo` deep-clones the entire characters array on every chat-list click

- **Category:** performance · **Area:** client · **known-leftover:** no
- **Location:** `src/ts/globalApi.svelte.ts:1817` (`changeChatTo`) →
  `src/ts/chatCommands.ts:73-78` (`currentChatStateSnapshot`).

**What.** Clicking a chat calls `changeChatTo`, whose first line is
`const previous = currentChatStateSnapshot()`, which does
`cloneJsonValue(DBState.db.characters)` — `JSON.parse(JSON.stringify(...))` over
every character and every hydrated chat transcript, synchronously on the UI
thread, before the `chatPage` flip. The operation only mutates one scalar
(`chatPage`) and dispatches an empty-patch select command, so the rollback only
needs `chatPage` + `selectedChar`. This is the exact stall the workstream fixed
for **character** select via the scalar `CharacterSelectionSnapshot` — but no
analogous chat-selection scalar snapshot exists (`ChatSelectionSnapshot` /
`restoreChatSelection` are absent), so chat select was left on the broad clone.

**Impact / trigger.** Hot, user-facing: every chat switch from the chat list /
sidebar (`ChatList.svelte`, `SideChatList.svelte`). Opened chats accumulate full
hydrated transcripts in `DBState.db.characters` (lazy-projection stubs
*un-opened* chats but does not remove already-loaded histories), so in a long
session the clone grows to hundreds of ms / seconds — the same class as the
already-fixed char-select stall (`char-select-snapshot-deepclone-fixed`). Cold
sessions with few hydrated chats are cheap; the stall grows with the session.

**Fix.** Add a scalar `ChatSelectionSnapshot` / `restoreChatSelection` pair
(capture `selectedCharID` + the target character's `chatPage`, locate by
`chaId` on restore), mirroring the landed `CharacterSelectionSnapshot` remedy,
and have `changeChatTo` dispatch the select with that scalar rollback. Low risk;
the narrow-rollback infrastructure already exists.

---

### H3 — Streaming re-parses the entire growing message every token frame (accidentally quadratic)

- **Category:** performance · **Area:** client · **known-leftover:** no
- **Location:** `src/lib/ChatScreens/Chat.svelte:375`
  (`$effect.pre → displaya/risuChatParser`) +
  `src/lib/ChatScreens/ChatBody.svelte:259` (`markParsingResult $derived.by →
  markParsing`) → `src/ts/parser/parser.svelte.ts:822` (`ParseMarkdown`, no
  memo) + `:55` (`risuChatParser`, no memo). Fed by
  `src/ts/process/postGeneration/streamResponse.ts:104-133` (per-chunk `.data`
  write + `reloadKeys` bump) and
  `src/ts/process/request/serverChat.ts:409-412` (per-token full-string
  enqueue). Server emits one frame per provider delta at
  `server/fastify/src/routes/generation.ts:394` (`writeSseChunk`, no coalescing).

**What.** During a streamed response the server emits one SSE `token` frame per
provider delta with no batching. The client accumulates the full string each
token (`tokenResult += content; controller.enqueue({[streamKey]: tokenResult})`,
no `requestAnimationFrame`/throttle/debounce — confirmed absent), writes the
**full** accumulated text into `message[msgIndex].data`, and bumps `reloadKeys`
every frame. That deep mutation propagates through Svelte 5 reactivity to the
streaming `<Chat>`, re-running `risuChatParser` over the whole message and
`ParseMarkdown` (`parseAdditionalAssets` + `processScriptFull('editdisplay')`
[runs the `display` trigger over the full chat + CBS] + `md.render` +
`DOMPurify.sanitize`) over the entire message — **every token**, with no
input-keyed cache.

**Impact / trigger.** Every streamed generation. For an N-token response of
final length L, total client parse work is ~O(N·L) ≈ O(L²). Long
markdown/CBS/display-script-heavy responses — ordinary for this UI — produce
visible streaming stutter and main-thread jank; worse for users with
display/regex scripts (re-run over the full text every token). Degrades
gracefully (no crash), so high, not critical.

**Fix.** Primary: **coalesce token-driven renders** — buffer incoming frames and
flush the displayed text at most once per animation frame (or short timer), so
the full reparse runs a bounded number of times. Optionally batch provider
deltas into fewer SSE frames server-side (helps every client). A naive
prefix-memo of `ParseMarkdown` is unsafe because `editdisplay`/`display` and CBS
can depend on the whole message + trailing context; render coalescing is the
behavior-preserving choice. Keep a final full-fidelity flush on the `done` frame
and preserve auto-scroll.

---

## Medium-Severity Findings

### M1 — Prompt assembly loads + parses the entire message corpus per send  **[known-leftover]**

- **perf · server** · `server/fastify/src/repository.ts:855`
  (`loadPersistedWithMessages`) → `messageStore.ts:451`
  (`getAllChatMessagesGrouped`) / `:104` (`getAllChatHypaV3Grouped`), reached via
  `routes/generationChat.ts:352` (`loadDatabaseDeps.loadDatabase`), called on
  `/generate/chat` (`:868`/`:1527`) and `/generate/preview-prompt` (`:1848`).

Every send/continue/regenerate/preview resolves its database through
`loadPersistedWithMessages`, which runs
`SELECT chat_id, json FROM messages WHERE alternate=0 ORDER BY chat_id, seq`
over the **entire** messages table (and the whole `chat_hypa_v3` table),
`JSON.parse`-ing every row and joining all messages into all chats — even though
assembly only ever reads the one target chat's transcript (`resolveScope`
`structuredClone`s a single chat; no consumer iterates sibling chats' messages).
A scoped loader `getChatMessagesGroupedByIds([chatId])` already exists and is not
used here. *Documented as evidence-gated in `leftover.md` ("Prompt-construction
runtime narrowing").* Two finders independently surfaced this; it is the most
clearly corpus-scaling server cost on the generation hot path.

**Fix.** Add an assembly-specific loader: message-free `loadPersisted` + a
single-id message/hypa join for the target chat only. **Do not** change
`loadPersistedWithMessages` itself — `assetGc`/`exportSnapshot`/`save`/`risuSave`
need all chats' messages. Give non-target chats `message=[]` to preserve
`eachChat`/memo-iteration invariants, and preserve per-chat hypaV3 embedded
fallback. Opt-in `databaseLoadMs` metrics already exist to confirm the win.

### M2 — Per-message regex recompilation in the history `editprocess` walk

- **perf · server** · `server/fastify/src/prompt/scripts.ts:316-356`
  (`processScript`: `getActiveModules`@327, `parseScripts`@332, `applyOne new
  RegExp`@280), invoked per message via `prompt/history.ts:299`
  (`formatHistoryMessage`) inside the window loop at `history.ts:488-503`.

`buildHistoryWindow` iterates every message in the window and, per message,
re-resolves active modules, re-builds and `parseScripts()` the full
preset+custom+module regex list, and compiles `new RegExp(...)` per
`editprocess`-typed script — none memoized. For N window messages and M
editprocess scripts that is N module-resolution passes, N parse passes, and
~N·M `RegExp` compilations per assembly; `makeMs` returns the full
non-truncated list, so N can be hundreds on a long chat. The SPA has both a
module memo and a script cache; the server has neither (the gaps are even noted
in `modules.ts:15-18` and `scripts.ts:50`).

**Fix.** Hoist active-module resolution + `parseScripts` + the compiled-RegExp
list once per assembly and thread it into `formatHistoryMessage` (inputs are
invariant across the per-message loop). Exclude `cbs`-action scripts, which
pre-expand their source per message and cannot share a precompiled RegExp.

### M3 — Every command mutation loads + parses all 9 collection tables (read side never narrowed)

- **perf · server** · `server/fastify/src/repository.ts:747`/`:129-155`
  (`loadPersisted` → `loadCollectionsFromSqlite`), reached via
  `commands/mutations.ts:147` (`applyTargetedCommandMutation`) from the hot
  routes in `routes/commands.ts`: scriptstate PATCH `:3310`, message append
  `:3360`, message PATCH `:3402`, message DELETE `:3447`, messages PUT `:3537`,
  generation-result `:3578`.

The mutation-range workstream narrowed the **write** side (each targeted route
writes only its own table) but not the **read** side. Every command — including
the hottest ones — calls `loadPersisted`, which always runs
`loadCollectionsFromSqlite`: one `SELECT data_json FROM <table> ORDER BY
position` per collection (modules, plugins, bot_presets, prompt_templates,
personas, loadouts, lore_books, translator_presets, hypa_v3_presets) plus a full
`plugin_custom_storage` scan, `JSON.parse`-ing every row. The
message/scriptstate/generation mutate callbacks only touch `characters`, so all
collection parse work is discarded. (The verifier notes the **larger** discarded
cost on these routes is actually `loadCharactersFromSqlite` + the whole-corpus
`normalizeAllCharacterChats`, which also only needs to locate one row — see L6.)

**Fix.** A genuine field-scoped SQLite loader that parses only the tables a
command reads, or a per-request memo of `loadCollectionsFromSqlite`. Note the
existing `loadPersistedDatabaseFields`/`selectDatabaseFields` do **not** help —
they call `loadPersisted` and then slice the already-parsed result. Narrowing the
character/chat read needs care (global `normalizeAllCharacterChats` dedup
relies on the full character set).

### M4 — `maskProviderSecrets` full JSON round-trip clone + `loadSingleCharacterRow` whole-array clone

- **perf · server** · `server/fastify/src/providerSecrets.ts:59-66` +
  `:247-250` (`cloneJsonValue` = `JSON.parse(JSON.stringify(...))`);
  `routes/projection.ts:519-536` (`loadSingleCharacterRow`, reached from the
  `characterRow` branch `:358-385`); `routes/bootstrap.ts:31-35`.

`maskProviderSecrets` deep-clones its **entire** argument before masking ~36
secret paths. `loadSingleCharacterRow` — the per-character `characterRow`
projection that exists *specifically to ship one character* — hands it
`loadStubbedProjectionFields(['characters'])` (a full SQLite read + parse of all
characters) and then JSON-deep-clones the whole array just to `.find()` one row.
Bootstrap pays the same full clone of the whole stubbed DB once per page load.

**Fix.** `loadSingleCharacterRow` should do a `WHERE id = ?` single-row read
(precedent: `loadCharacterSelectionRows`) and mask only that row (still strip
`globalLore` for wire parity). Add an opt-in `maskProviderSecretsInPlace` for
callers that own a freshly-parsed object (the SQLite loaders always do), rather
than changing the existing contract.

### M5 — `jsonPayloadBytes` full `JSON.stringify` on every projection/bootstrap response even when metrics are off

- **perf · server** · `server/fastify/src/routes/projection.ts:555`
  (`emitProjectionMetric`) and `routes/bootstrap.ts:45`;
  `protocolMetrics.ts:18` (`jsonPayloadBytes`).

`emitProtocolMetric` guards on `protocolMetricsEnabled()` internally, but its
`fields` argument is built eagerly at the call site with
`payloadBytes: jsonPayloadBytes(response)`. JS evaluates the argument before the
call, so `Buffer.byteLength(JSON.stringify(response))` runs on **every**
projection response and **every** bootstrap regardless of
`RISU_PROTOCOL_METRICS` (default off) — Fastify then serializes the same object
again for the body. A ~2× serialization of the heaviest read payloads (full
message history on chat-open; whole stubbed DB on bootstrap) for zero benefit in
the default config. Fires per discrete user action, so bounded, but it directly
undercuts the lazy-projection goal of cheap chat-opens.

**Fix.** Defer evaluation: have `emitProtocolMetric` accept a thunk for
expensive fields and call it only after the `protocolMetricsEnabled()` guard, or
early-return from the metric block when metrics are off.

### M6 — Proxy `/fetch` does not abort upstream on client disconnect and has no request timeout

- **both · server** · `server/fastify/src/routes/proxy.ts:33-96`;
  `proxy.ts:32-42` (`createTimeoutController`) / `:19-25`
  (`getRequestTimeoutMs`); `app.ts:80-84` (no `requestTimeout`).

The non-streaming proxy route passes only `createTimeoutController(timeoutMs)`'s
signal to `fetch()`; it never registers `req.raw.on('close', ...)` to abort the
upstream on browser disconnect, and no Fastify `requestTimeout`/`connectionTimeout`
is configured. `getRequestTimeoutMs` returns `null` (signal `undefined`) when no
`risu-timeout-ms` header is present, which is the typical case. When the user
cancels/navigates away, the server keeps reading the upstream provider
connection. **Scope (verifier correction):** this is the *legacy* browser-driven
non-streaming path — modern generation is server-owned and streaming jobs *do*
handle `close`. Node/undici defaults (~300s) backstop a truly hung upstream, and
the route is rate-limited, so this is bounded under self-host, not an unbounded
leak.

**Fix.** Combine `req.signal` with the timeout via
`AbortSignal.any([...])`, abort on `req.raw.once('close', ...)` (remove the
listener in `finally`), and set a sane Fastify `requestTimeout` backstop.

### M7 — `voyageContext3` embed batch materializes every chunk of a chat into one uncapped request

- **both · server** · `server/fastify/src/memoryEmbedJobHandler.ts:91-95`
  (uncapped `claimNext` loop) + `:294-307` (single contextual request) →
  `memoryEmbeddingAdapter.ts:143-152` (one fetch, `inputs: groups`).

The embed handler drains a chat's entire pending embed queue with no batch-size
cap, and for the `voyageContext3` model builds one request body
`groups: [parsed.map(item => item.chunk.text)]` containing every pending chunk's
full text, expecting exactly one vector per chunk. A strict
`vectors.length !== parsed.length` check means a provider that caps/truncates a
huge batch fails the **whole** batch, and `commitBatchResults` retries them all
together. `embeddingMaxConcurrent` does not apply to this contextual single-
request path. Background worker, so no UI hang/crash; bounded per-chat;
retry-capped. Triggers on the first embedding pass over a long imported chat with
a (paid, opt-in) Voyage key — uncommon but reachable.

**Fix.** Cap the drained batch and slice the contextual request into
token-aware sub-batches, committing each independently so one oversized request
can't fail unrelated chunks. Keep `groupId` consistent within each sub-batch.

### M8 — Non-streaming provider fetches have no upstream timeout, only client-driven abort

- **stab · server** · `server/fastify/src/routes/generation.ts:371`
  (`attachAbort`, disconnect-only) and `generationChat.ts:201`
  (non-durable `streamAssembly`); buffered shape at `generation/openai.ts:167`,
  `horde.ts:189/194`.

Buffered (non-streaming) provider calls do `await fetch(endpoint, {signal:
req.signal})` then buffer the whole body with no `AbortSignal.timeout` and no
size cap. The only cancellation is client disconnect. **Scope (verifier
correction):** the *primary* normal send path is **durable** (`runGenerationJob`
uses a 10-min `deadlineAt` swept by `tickGc`), so the common case is already
bounded. The unbounded paths that remain live are **non-durable** sends
(non-server-routable provider, group char, interactive Lua, non-vision caption
fallback) and **all** `routes/generation.ts` endpoints (translation, memory
summarization, classification/embeddings, generic proxy). Horde's poll deadline
does not bound an in-flight fetch.

**Fix.** Give the non-durable signal a deadline at the source — install a bounded
timer in `attachAbort` (mirroring the durable 600s default) so both buffered and
streaming non-durable paths are covered in two spots instead of ~10 adapters.
Add a body-size cap. Pick a generous default so slow local models aren't killed.

### M9 — Legacy compressed `.risu` import fully decompresses before the size check (gzip-bomb)

- **stab · server** · `server/fastify/src/risuSave/legacyEnvelopeCodec.ts:74-82`
  and `risuSave/blockCodec.ts:115-119`; reachable via `routes/save.ts:80`
  (`/import/risusave`) and `:150` (`/import/bundle` embedded `database.risu`).

For `legacy-compressed`/`legacy-stream` envelopes (and per-block in the block
codec) the decoder `fflate.gunzipSync(...)` fully expands the payload into one
in-memory `Uint8Array`, then calls `assertExpandedSizeWithinLimit(...)` — the
guard runs **after** the allocation, so it cannot prevent it. **Verifier
nuance:** this is a *known, accepted* tradeoff of the landed "expanded import
size limits" slice (it deliberately caps *after* inflate), and `fflate` throws a
catchable `RangeError` at ~2 GB (returned as 400, no crash). A real process OOM
only happens if a sub-2 GB-but-large expansion exhausts physical RAM on a small
box, and the file is auth-gated / self-imported. So "guaranteed OOM" is
overstated, but the preventive gap is real. The bundle ZIP layer and realm
`.charx` import *are* bounded-streaming; only the inner `.risu` gunzip is not.

**Fix.** Use `fflate`'s streaming `Gunzip`/`Decompress` with an `ondata`
accumulator that throws once cumulative output exceeds the cap (per envelope and
per block). Give `/import/bundle`'s inner `.risu` a finite default cap.

### M10 — Periodic asset GC + import asset report synchronously parse the whole message corpus

- **perf · server** · `server/fastify/src/assetGc.ts:82` (`runAssetGc`, 15-min
  `setInterval` at `app.ts:176-182`); `messageStore.ts:451`
  (`getAllChatMessagesGrouped`); `risuSave/assetReferences.ts:31` via
  `routes/save.ts:406` (import asset report).

`runAssetGc` calls `loadPersistedWithMessages` (whole-corpus message scan +
`JSON.parse` per row), then walks the hydrated DB for referenced asset ids — all
synchronous (the file documents reliance on no `await` for atomicity), so it
blocks the event loop for its full duration. Default-armed (built with no opts).
The same whole-corpus hydrate+walk runs **inline** after every import via
`buildRepositoryRisuSaveAssetReport`. On a large corpus this is a periodic
UI/generation hiccup every 15 min plus an extra stall appended to each import.

**Fix.** The walker only needs each message's `data` string to extract
`{{inlay...}}` tokens — do a targeted `SELECT data FROM messages WHERE
alternate=0` scanned with `INLAY_TOKEN_RE` (no per-row `JSON.parse`, no full
hydrate), unioned with the non-message references from `loadPersisted`. Make the
import asset report deferred/optional.

### M11 — Bundle export hangs and leaks an FD + Zip when a client aborts a large download

- **stab · server** · `server/fastify/src/risuSave/bundleExport.ts:111`
  (`outputReady = once(stream, 'drain')`) + `:156-161` (per-chunk `await
  readOutputReady()`); `routes/save.ts:273` (`reply.send(bundle.stream)`).

Backpressure is handled with `events.once(stream, 'drain')`, which settles only
on `'drain'`/`'error'` — **not** `'close'`. When a client aborts a large bundle
download, Fastify destroys the reply stream cleanly (emits `'close'`, no
`'error'`), so the pending `once` never settles, the `addFileEntry` loop is
parked forever, the per-asset `fs.createReadStream` stays open, and the `fflate`
`Zip` is never terminated. The verifier reproduced this empirically on
Node 24. Requires an abort *while write backpressure is pending* (common on any
non-trivial download). Each occurrence leaks one FD + one parked task + Zip
state; accumulates over repeated aborted large downloads. (Introduced by the
protocol-stability streaming-export commit; not mitigated since.)

**Fix.** Make `readOutputReady` also settle on `'close'`/`'error'` (race
`once(stream,'drain')` vs `once(stream,'close')`), and on premature close call
`zip.terminate()` and destroy the in-flight read stream so the loop unwinds.

### M12 — `/setvar` + `/addvar` re-run the full `setDatabase` normalizer per write

- **perf · client** · `src/ts/process/command.ts:211` (`setvar`) / `:232`
  (`addvar`); normalizer `src/ts/storage/database.svelte.ts:106-787` (filter
  `:110`, `changeLanguage` `:785`); `src/lang/index.ts:14`.

These slash handlers mutate `chat.scriptstate` in place inside the trusted write
scope and then call `setDatabase(db)` — a ~680-line normalizer that re-allocates
`data.characters = data.characters.filter(...)` (O(characters)) every call and
ends with `changeLanguage`, which for any non-English UI does
`merge(safeStructuredClone(languageEnglish), languageX)` — a full deep
clone+merge of the ~99 KB language pack — **per call**. The in-place mutation
under the projection guard plus the existing scoped dispatch already persist the
write; `setDatabase(db)` is redundant (the canonical `setChatVar` does the same
mutation **without** it). **Verifier correction:** the per-token `{{setvar::}}`
CBS idiom routes through the cheap `setChatVar` path; the expensive path is the
*slash-command* form via trigger `command`/`v2Command` effects — warm
(≤ per-message), not the hottest loop.

**Fix.** Drop the `setDatabase(db)` calls in the `setvar`/`addvar` cases
(mirroring `setChatVar`). **Do not** lump in the `/send` and
`mutateCurrentChatMessages` cases — they have broader message semantics and need
separate assessment. If normalization is genuinely needed, do it once at load
time, not per var write.

### M13 — `changedCharacterFields` deep-clones the full character (chats + histories) twice, then discards

- **perf · client** · `src/ts/characterCommands.ts:362-377`
  (`changedCharacterFields`) / `:353-360` (`sanitizeCharacterPatch`); callers
  `setCurrentCharacter`/`setCharacterByIndex` at
  `src/ts/storage/database.svelte.ts:979`,`:1006`.

The character field diff calls `cloneJsonValue(previous)` and
`cloneJsonValue(current)` — each a full JSON deep clone of the entire character
**including `chats[]`** (all hydrated histories) — then immediately runs
`sanitizeCharacterPatch`, which strips exactly those heavy keys
(`CHARACTER_PATCH_EXCLUDED_KEYS`). The expensive part of both clones is thrown
away. The currently-open character's chat is hydrated, so the discarded
transcript is heavy. Runs on warm one-shot actions (asset add, playground apply,
chat-screen char edits, plugin/Lua setters); not per-token, so latency-only, no
hang. (`prepareCompatibleCharacterUpdate` at `:280` has the same shape.)

**Fix.** Build the kept-key set first and clone only non-excluded values — drop
the outer `cloneJsonValue(previous/current)` and iterate `Object.entries`
directly, skipping `CHARACTER_PATCH_EXCLUDED_KEYS` before any clone
(`sanitizeCharacterPatch` already clones per kept key). Apply to
`prepareCompatibleCharacterUpdate` too.

### M14 — `setupSendChatContext` keeps the whole-corpus clone per message send

- **perf · client** · `src/ts/process/sendChatContext.ts:96`
  (`currentChatStateSnapshot` in the serverBacked branch).

Every send captures `rollbackSnapshot = currentChatStateSnapshot()` (whole
characters-array deep clone) to cover two rollbacks — the character's
`lastInteraction` and the active chat's message-id backfill — **both of which
live under one character row**. `canUseServerCommands()` is unconditionally
true, so this fires on every server-backed send. Once-per-send (not per-token),
at the start of a multi-second LLM wait, so the latency is largely masked; cost
scales with corpus size + opened-chat histories. The archive's
`INTENTIONALLY_BROAD` list reserves `currentChatStateSnapshot` for
create/delete/reorder/fork only — this send-path use is unregistered.

**Fix.** Capture `currentCharacterRowSnapshot(selectedChar)` (covers
`lastInteraction` + that char's chat messages) and roll back via
`restoreCharacterRow`. Both mutations are confined to `characters[selectedChar]`,
so rollback correctness is preserved.

---

## Low-Severity Findings

40 confirmed low-severity findings. Bounded, infrequent, or latent foot-guns
under single-user self-host, but real and actionable. Grouped by area; the
location is the durable anchor. **[KL]** = matches a known `leftover.md` item.

### Server — generation / prompt assembly

| ID | Title | Location |
| -- | ----- | -------- |
| L1 | `getActiveModules` re-scans the full modules collection ~8× per assembly (no memo) | `prompt/modules.ts:40` (callers in `assemble.ts`, `lorebook.ts`, `history.ts`, `scripts.ts`, `assetLookup.ts`, `triggers.ts`) |
| L2 | Whole-transcript run-var expansion runs over every message each assembly | `prompt/assemble.ts:738` (`applyCurrentChatRunVars`), `:1680` (`runServerPostGeneration`) |
| L3 **[KL]** | Lorebook keyword search recompiles per-entry regexes inside the recursive activation loop | `prompt/lorebook.ts:245` (inside `while(matching)`@`:329`, entry loop@`:332`) |
| L4 **[KL]** | `targeted-assembly` scriptstate persist rewrites the full characters table | `routes/generationChat.ts:531`/`:875`/`:1531` → `commands/mutations.ts:158-163` → `repository.ts:313` |

### Server — commands / SQLite

| ID | Title | Location |
| -- | ----- | -------- |
| L5 | `getAllAssetMetadata` full assets-table scan on every command mutation, result discarded | `repository.ts:751`/`:629-634`; consumers `commands/mutations.ts` |
| L6 | Every targeted command parses all characters **and** all chat rows just to locate one row | `repository.ts:288` (`loadCharactersFromSqlite`); `commands/chats.ts:417` (`normalizeAllCharacterChats`) + `:305` (`requireChatLocation`) |
| L7 **[KL]** | Four create/delete routes still do a full ~13-table rewrite for a single-row change | `routes/commands.ts:2498`/`:2537`/`:3976`/`:4049` → `commands/mutations.ts:248-250` (Tier-5 floor) |
| L8 | `pruneCommandEventHistory` runs an `OFFSET 999` index walk on every command write | `commands/events.ts:140-156`, called from `persistCommandEvent` `:101` |
| L9 | Character delete issues a redundant `chats` DELETE the FK cascade already performed | `routes/commands.ts:2652-2653`; `repository.ts:471`/`:484`; FK `:253-254` |

### Server — projection / events

| ID | Title | Location |
| -- | ----- | -------- |
| L10 | Every SSE connection loads + maps the full command-event history even when no replay is requested | `routes/events.ts:76`; `commands/events.ts:115` (`listPersistedCommandEventHistory`) |
| L11 | SSE memory-event subscription has a latent leak if a close-yield is ever introduced before it | `routes/events.ts:148` (no `cleanedUp` guard before `memoryEvents.subscribe`) |

### Server — jobs / streaming / lifecycle

| ID | Title | Location |
| -- | ----- | -------- |
| L12 | Proxy WS viewer not closed when it attaches to an already-done job — pins job + ping timer | `routes/streamJobs.ts:199-224` (asymmetric vs `generationChat.ts:1082-1085`) |
| L13 | `onClose` closes the DB without awaiting detached generation runners; aborted cancel-persist can touch a closed DB | `app.ts:186-198`; `routes/generationChat.ts:1743` (`void runGenerationJob`) → `generationFinalizationRetry.ts:51` |
| L14 | Durable generation SSE viewer has no heartbeat during long assembly — risks idle-proxy disconnect before first token | `routes/generationChat.ts:1060-1086`; silent window at the `await` `:1527` |
| L15 | Streaming proxy job buffers the entire upstream response in memory when no viewer is attached (only a coarse byte cap) | `streamJobs.ts:268-294`/`:424-438` (never calls `enableReplay`) |

### Server — Hypa V3 memory

| ID | Title | Location |
| -- | ----- | -------- |
| L16 **[KL]** | Orphan cleanup opens a write transaction + re-parses all summary metadata on every generation | `memoryRepository.ts:594-628`, reached from `prompt/assemble.ts:1126` |
| L17 | A single chat's long embed/summarize batch blocks memory jobs for all other chats | `memoryWorker.ts:101`/`:127-179`; `memorySummarizeJobHandler.ts:91-96` / `memoryEmbedJobHandler.ts:91-95` (drain-all `claimNext`) |
| L18 | `loadPersisted()` rebuilds the full `Database` object from SQLite on every embed/summarize batch | `memoryEmbedJobHandler.ts:456-466`; `memorySummarizeJobHandler.ts:341-351` |

### Server — Lua runtime / provider adapters

| ID | Title | Location |
| -- | ----- | -------- |
| L19 **[KL]** | No aggregate Lua exec-time/engine budget across triggers + edit-hook phases — a card can stall assembly | `prompt/luaRuntime.ts:911`/`:1064-1080`; `prompt/triggers.ts:846-869` |
| L20 | Request `AbortSignal` never propagated into the Lua runtime — client disconnect can't cancel in-flight hook work | `prompt/luaRuntime.ts:907` (no `signal` field); `routes/generationChat.ts:868` (assembled with no signal) |
| L21 | Fresh wasmoon engine boot + full prelude recompile on every `triggerlua` run (per-send hot-path overhead) | `prompt/luaRuntime.ts:926-943`/`:1066-1080`; `triggers.ts:846-868` |
| L22 | Unbounded SSE buffer growth in streaming providers when upstream omits event delimiters | `generation/openai.ts:316`, `gemini.ts:415`, `anthropic.ts:291`, `mistral.ts:355`, `ollama.ts:267` |
| L23 **[KL]** | IPv6 SSRF guard does not unwrap 6to4 / NAT64 / IPv4-compatible embedded private addresses | `prompt/luaRuntime.ts:175-182` (`isBlockedV6`) / `:143-154` |
| L24 | `additionalParams` DSL `setObjectValue` allows prototype pollution via dotted `__proto__`/`constructor` keys | `generation/additionalParams.ts:104-119` (reached from all provider adapters) |
| L25 | Lua `request()` rate counter increments **before** validation — blocked URLs still consume the egress budget | `prompt/luaRuntime.ts:311-321` (`count++`@`:311` precedes `validateEgressUrl`@`:313`) |

### Server — import / export / assets / backups

| ID | Title | Location |
| -- | ----- | -------- |
| L26 **[KL]** | Ordinary + bundle `.risu` export materialize the full corpus and additionally JSON-clone+normalize it synchronously before encoding | `routes/save.ts:202`/`:245-247`; `risuSave/exportSnapshot.ts:47`; `importSnapshot.ts:175`/`:246-249` |
| L27 | `listBackups` `JSON.parse` of each `manifest.json` is unguarded — one corrupt manifest 500s the whole backups list | `repository.ts:1518-1520`; `routes/backups.ts:41-44` |
| L28 | Legacy `db.json` re-import during restore runs without a transaction and after the restore event is already emitted | `repository.ts:976-1005` (no `BEGIN`/`COMMIT`) / `:1665-1671` (post-`COMMIT`) |

### Client — projection sync / bridges

| ID | Title | Location |
| -- | ----- | -------- |
| L29 | Persisted command events lose writer-session origin — SSE reconnect replay can defeat own-echo suppression | `commands/events.ts:89`/`:166`; client guard `src/ts/bootstrap.ts:410`/`:321` |
| L30 | Reattach is not re-armed after completion — switching between two chats with live jobs leaves the second un-reattached | `src/ts/process/reattach.ts:48-87` (`if (reattaching) return` + `finally`) / `:34-41` |
| L31 | Script-definition watcher scans + re-stringifies every character's and module's scripts per keystroke | `src/ts/server/scriptDefinitionBridge.svelte.ts:248-279`/`:342-365` |
| L32 **[KL]** | Discrete lorebook editor actions clone the whole characters+modules graph and run a whole-DB id-assign write | `src/ts/server/lorebookBridge.svelte.ts:122-131`/`:188-211` (callers in `LoreBook/*`) |

### Client — state store / command helpers

| ID | Title | Location |
| -- | ----- | -------- |
| L33 | Reactive `$effect` deep-clones the entire modules array as a dependency read on every character switch | `src/ts/stores.svelte.ts:195` |
| L34 | `toggleSelectedChatModule` deep-clones all characters to toggle one chat's modules array | `src/ts/moduleCommands.ts:196-215`; `chatCommands.ts:73-78` |
| L35 | MCP `setCharacterInfo` uses the whole-corpus clone for a single character field patch | `src/ts/process/mcp/risuaccess/characters.ts:584` |
| L36 | Fire-and-forget command runners swallow command-factory rejections without rollback | `src/ts/chatCommands.ts:245`/`:260-274`; `characterCommands.ts:150-156`; `server/commands.ts:2200-2217` |
| L37 | Stray `console.log` of full command/preset objects on warm paths | `src/ts/process/command.ts:40`/`:43`/`:249`; `database.svelte.ts:2652` |

### Client — generation / parsing / rendering

| ID | Title | Location |
| -- | ----- | -------- |
| L38 | `console.log('Trigger time', ...)` runs on every message render (`editdisplay` path) | `src/ts/process/scripts.ts:168` (via `parser.svelte.ts:841` ← `ChatBody.svelte:259` ← `Chat.svelte:375`) |
| L39 | Terminal assistant-message lookup copies the whole transcript to scan it | `src/ts/process/serverBackedSendChat.ts:69-77` (called at `:449`) |
| L40 | Trigger effects compile `new RegExp` on every effect execution (9 sites, no memo) | `src/ts/process/triggers.ts:1724`/`:2210`/`:2429`/`:3126`/`:3360` (cf. `scripts.ts:126-138` `getCompiledRegex`) |

---

## Context-Dependent Findings (lower confidence)

Real and correctly located, but the impact is bounded enough — or the
triggering path narrow enough — that they sit below the low bar or depend on
usage not present in single-tab single-user operation. Recorded so they are
neither lost nor over-weighted.

- **U1 — Bulk chat/lorebook hydration loads the whole corpus even for a small id
  set** (`repository.ts:1086`/`:1150`). Real residual redundancy, but the only
  live callers (`ensureAllChatsHydrated`, export, branch-tree) already pass the
  whole corpus, and the load is message-free metadata. Micro-optimization at
  best.
- **U2 — Foreign `fields` event with `characters` re-stubs the whole array and
  drops chat hydration** (`bootstrap.ts:374-396`). Bounded (one array-reference
  swap, lazy refetch), and in single-tab use these events are own-echo-suppressed
  or already routed to the narrow `characterRow`/`generation-chat` modes. The
  remaining broad mappings are *intentional* for gap/reconnect recovery and are
  the subject of the `leftover.md` "sprawling-resource" evidence gate. **[KL]**
- **U3 — Hydration / lorebook id `Set`s grow for the session** (
  `chatMessageHydration.svelte.ts:35-46`). Bounded by corpus size, string ids
  only, cleared on resync; the reactivity-widening concern is effectively nil
  (per-key `SvelteSet` signals + early return). Foot-gun, not a leak. No action
  warranted.
- **U4 — `setCurrentChat` keeps the broad clone** (`database.svelte.ts:1016-1027`).
  The marquee "per-generation" caller (`buildHistoryWindow`) is local-assembler
  only and dead on the default server route; the genuinely live callers
  (`/trigger` slash, trigger-button) are rare. Cheap consistency cleanup
  (`currentChatScopedSnapshot` + `dispatchCompatibleChatUpdateScoped` exist), not
  a hot-path fix.

## Investigated And Dismissed

Verified **not** to be live issues. Listed so they are not re-opened.

- **Inline (non-durable) continue/regenerate loses partial text on disconnect**
  — *unreachable*. The real client always sends `durable:true` for
  server-dispatched continue/regenerate; the inline streaming branch is only
  hit by a hand-crafted `durable:false` request. For non-durable mode the
  browser owns persistence by design.
  (`routes/generationChat.ts:945-983`.)
- **Per-generation memory selection cosine-ranks ALL chat embeddings on the event
  loop** — *false on the live route*. `/generate/chat` passes
  `loadPromptMemoryQueryVectors: () => []`, so the ranking loop never executes.
  What remains is a bounded, index-backed embedding-blob decode behind the opt-in
  hypaV3 feature — a documented `leftover.md` memory-bridge item, not a quadratic
  spike. (`assemble.ts:1205`; `memorySimilarityRanking.ts:70`.)
- **Orphan cleanup cascade-deletes a still-referenced shared chunk for a
  different summary model** — *impossible by invariant*. A summary's stored
  `metadata.chatMemos` is the same value hashed into the `chunkId`, so two
  summaries sharing a chunk always have identical memos and are orphaned-or-kept
  together. No cross-model data loss. (`memoryRepository.ts:594-628`;
  `memoryChunkPlanner.ts:170`.)
- **`buildMemoryWindow` deep-clones all characters to write one `lastMemory`
  scalar** — *dead path, already documented*. Lives in the local assembler that
  the default `server` route never reaches; the frontend-performance workstream
  already downgraded it to inventory-only (`active-risk-analysis.md:167`;
  `cloneCostGateCompleteness.test.ts:175`).
- **`addMetadataToElement` logs two lines per render** — *dead code*.
  `aiWatermarkingLawApplies()` is a `// TODO` stub hardcoded to `return false`,
  so the early return always fires and the `console.log`s are unreachable today.
  (`parser.svelte.ts:958`; `globalApi.svelte.ts:1739`.)

## Relationship To Prior Workstreams And `leftover.md`

- The three landed workstreams remain valid; this audit did not find a
  regression of their committed fixes. It found **adjacent paths they did not
  cover**: the server still rebuilds broad `Database` objects (lazy-projection
  fixed the wire, not the server read), and several client snapshot call sites
  (chat select, send context, character-field diff) kept the broad clone the
  frontend-performance family otherwise narrowed.
- Findings tagged **[known-leftover]** (M1, L3, L4, L7, L16, L19, L23, L26, L32,
  U2) are already tracked in `docs/archive/leftover.md` as deliberately-deferred
  / evidence-gated. They are included for completeness; the **new** issues —
  especially H1, H2, H3 and most mediums — are the priority.

## Suggested Remediation Order

1. **H1** — one-line guard change (`message.length > 0`) with the largest
   blast-radius-to-effort ratio; removes a whole-corpus parse from every
   chat-open and generation completion. Add the regression test.
2. **H3** — render coalescing for streaming; the most user-visible perf issue.
3. **H2** — add `ChatSelectionSnapshot` (mirror the landed char-select fix).
4. **Cross-cutting server read narrowing** — M1 + M3 + L6 share a root cause; an
   assembly-specific scoped loader and a per-request `loadPersisted` memo (or a
   field-scoped SQLite loader) address M1, M3, M4, M5, L5, L10, L18 together.
5. **Cross-cutting client clone narrowing** — M13, M14, M12, L34, L35 are all
   "narrow the snapshot to one row / drop the redundant normalize."
6. **Stability foot-guns** — M9, M11, M8/M6, L24, L27 (small, isolated, each a
   clear preventive fix).
7. The **[known-leftover]** items stay gated on the existing
   `RISU_PROTOCOL_METRICS` evidence path unless a real corpus shows them
   dominating.

## How To Reproduce / Verify

- Server stage timings: run with `RISU_PROTOCOL_METRICS=1` during normal use;
  `projection_response` / `databaseLoad*` / `asset_byte_read` / `risusave_export`
  lines land in the server log (confirms M1, M5, H1 cost on a real corpus).
- Offline corpus cost: `pnpm analyze:db <input>` (`util/analyze-database.ts`)
  reports export materialization, bootstrap payload, and asset fanout.
- Client per-token cost (H3): open the browser profiler during a long streamed
  response and watch `ParseMarkdown` / `risuChatParser` self-time grow with
  message length; `localStorage.setItem('risu:protocol-debug','1')` adds protocol
  logs.
- Type/test gates after any fix: `pnpm test`, `pnpm api:test`,
  `pnpm client-thinning:audit`, and the two project-reference TypeScript checks
  (`tsc -p tsconfig.client-lib.json`; `tsc -p server/fastify/tsconfig.json
  --noEmit`).
