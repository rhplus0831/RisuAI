# V4 Audit — High And Medium Findings (Detail)

This file is the full-detail companion to
`../audit-stability-and-performance-v4.md` for the high- and medium-severity
findings (H1-H2, M1-M5). The finding IDs, titles, severities, and
category/area there are canonical and govern this document. Line numbers were
captured at the audit window (`4ccc15194`..`b355586a6`) and will drift as the
tree moves — the symbol names (function, store, header-set, and file names)
are the durable anchors. Where a candidate finder's mechanism conflicted with
a verifier correction, the corrected mechanism is presented here and the
original finder claim is noted as such.

---

## H1 — `loadPages` is a monotonic high-water-mark that mass-mounts transcripts after a deep jump

- Severity: High · Category: both · Area: client
- Finder: `client-dom-scale` (C26), claimed High, confidence high
- Verification: confirmed 3-0 (liveness: high, mechanism: high, severity:
  medium) — median high (the canonical doc keeps it high on lethality and
  session-stickiness; the severity lens dissented to medium).
- Novelty: new — distinct from `v1-H2` (`changeChatTo` clone), `v3-L30`
  (per-message memo KEY serialization), and `v3-L31` (`customHTML`
  re-parse).
- Location:
  - `src/lib/ChatScreens/DefaultChatScreen.svelte:107`
    (`let loadPages = $state(30)`)
  - `:142-150` (`scrollToMessage` sets `loadPages = totalMessages - index + 5`,
    guarded `if (loadPages < neededLoadPages)`)
  - `:639` (onscroll `loadPages += 15`)
  - `:923` (fold load-more `loadPages += chatFoldedStateMessageIndex.index + 1`)
  - `:434-494` (`screenShot` sets `Infinity` at `:437`, restores its own
    previous value at `:492` — see L20)
  - `:592` (`activeChatMessagesLoading` overlay), `:932-943`
    (`<Chats {loadPages}>`)
  - window consumer `src/lib/ChatScreens/Chats.svelte:46-89`
    (`chatRows` `$derived.by`, `loadEnd = messages.length - loadPages`),
    `:146` (`{#each}` one `<Chat>` per row), `:111-141`
    (`previousChatRoomId` tracking gates auto-scroll only, NOT `loadPages`)
  - no remount: `src/lib/ChatScreens/ChatScreen.svelte:62/81/105` mounts
    `<DefaultChatScreen>` in all three theme branches with no
    `{#key selectedCharID/chatPage}`; `App.svelte:260` renders `<ChatScreen/>`
    under a plain `{:else}` with no `{#key}` above it
  - `changeChatTo` `src/ts/globalApi.svelte.ts:1815-1844` (flips `chatPage`
    + `reloadGuiDisplay` only — bumps `$ReloadGUIPointer`, never remounts)
  - jump driver `src/lib/Others/BookmarkList.svelte:163-164` (`goToChat` →
    `ScrollToMessageStore.value = msg.originalIndex`), `:225-228`;
    `originalIndex` is the forward array index (`:37-38`); opened from
    `src/lib/SideBar/SideChatList.svelte:801-808`
  - parse-memo `src/lib/Others/ChatBodyParseMemo.ts:31/181-192` (keyed on the
    message string + chatID, capped at 180)

**What.** The transcript is windowed: `Chats.svelte`'s `chatRows` derives at
most `loadPages` rows from the tail of `messages` (`loadEnd =
messages.length - loadPages`; when `loadPages >= N` the `i < 0` break lets the
loop render all rows). `loadPages` starts at 30 and only ever GROWS — onscroll
`+= 15`, fold load-more, and crucially `scrollToMessage` (driven by the
bookmark "go to chat" jump) sets it to `totalMessages - index + 5`, i.e.
~the full chat length for a bookmark near the top. Exhaustive search of every
`loadPages` assignment confirms NO path resets it (`screenShot` sets
`Infinity` but restores its own prior value), and `DefaultChatScreen` is a
single persistent instance: nothing wraps it in `{#key selectedCharID}` or
`{#key chatPage}`, and `changeChatTo` only flips `chatPage` and bumps
`$ReloadGUIPointer`. So the value survives every chat AND character switch
until page reload. The next long chat opened then mounts `min(loadPages, N)`
`Chat`+`ChatBody` subtrees in one render flush.

The liveness and mechanism lenses corrected the finder on what the freeze
actually is. The finder emphasized the per-message `ParseMarkdown` /
`markParsing` step (`ChatBody.svelte:394`, via `memoizedChatBodyParse`) as the
synchronous freeze. That step is async/Promise-based and spread across
microtasks — added load, but NOT the synchronous block. The synchronous freeze
is (a) Svelte constructing `min(loadPages, N)` `Chat`+`ChatBody` components and
their DOM in one render flush, and (b) each mounted `Chat`'s `$effect.pre`
(`displaya` at `Chat.svelte:350-376`) synchronously running `risuChatParser` (a
full CBS pass, confirmed synchronous at `parser.svelte.ts:55-57`) per message.
The mechanism lens further pinned the precise prerequisite: `loadPages`
persists only WITHIN a session without a page reload (the component remounts on
reload, resetting to 30). The two-step trigger is therefore: (1) raise the
high-water-mark in chat A (scroll up `+= 15` per event, jump to an early
bookmark, expand a fold, or take a screenshot), then (2) switch to long chat B.
A freshly opened chat's strings are all `ChatBodyParseMemo` misses (the memo is
keyed on the message text and capped at 180), so the parse cost is paid from
scratch.

**Impact / trigger.** Routine two-step navigation sequence: raise the mark in
one long chat (one bookmark click drives `loadPages` to ~`totalMessages`; or
scroll back through history), then open any other long chat — a multi-second
main-thread freeze plus a large DOM/memory spike, recurring for every long-chat
open for the rest of the session. The cost is `min(loadPages, N2)` where `N2`
is the newly-opened chat length — bounded by the opened chat, not unbounded.
Long chats are the routine case for this app. The chat opens as a message-less
stub (`activeChatMessagesLoading`); the `z-40` loading overlay
(`DefaultChatScreen.svelte:592`) only shows while `messageCount === 0` and does
NOT gate the `<Chats>` mount — the mass mount fires right after
`/projection/chatMessages` hydration resolves and `currentChat` becomes the
full array.

**Verifier notes.** All three lenses independently re-derived the chain and
found no remount, no reset `$effect` keyed on chat id, no `{#key}` above
`DefaultChatScreen`, and exactly one writer to `ScrollToMessageStore`
(`BookmarkList.svelte:164`). The severity lens dissented to MEDIUM on two
grounds: (1) the most-common growth path — onscroll `+= 15` — is self-limiting
(only fires when `messages.length > loadPages`, grows gradually, and at most
reaches the current chat's own length), so the dangerous magnitude requires the
deliberate deep-jump (bookmark) or fold-load-more first; and (2) the cost is
bounded by `min(loadPages, N)`, not unbounded, and the markdown stage is async.
The canonical doc kept it high on the lethality and session-stickiness of the
post-trigger state. `canUseServerCommands()` is always true, so the bookmark
path is fully live.

**Fix.** Reset `loadPages = 30` when the active chat identity changes — an
`$effect` keyed on the chat id (e.g. `currentCharacter?.chats[chatPage]?.id`
and `$selectedCharID`), mirroring `Chats.svelte`'s existing
`previousChatRoomId` tracking — or wrap `<Chats>` in `{#key chatId}` so window
state is per-chat. Keep `scrollToMessage`'s growth transient to that jump. The
same reset bounds L20 (`screenShot`) collateral.

---

## H2 — Proxy `/fetch` forwards stale compressed `content-length` onto decompressed bodies

- Severity: High · Category: stab · Area: server
- Finder: `proxy-hub-streamjobs` (C55), claimed High, confidence high
- Verification: confirmed 3-0 (liveness: high, mechanism: high, severity:
  medium) — median high; both the mechanism and severity lenses ran empirical
  Node/Fastify experiments and narrowed the trigger.
- Novelty: new — not in the registry; `v3-K2` (proxy double-auth, DONE) and
  `v3-L5`/`v3-L56` (stream-job deadline/cancel) are unrelated.
- Location:
  - `server/fastify/src/proxy.ts:16-22` (`STRIP_RESPONSE_HEADERS` — strips
    `content-encoding` but NOT `content-length`)
  - `filterResponseHeaders` `:103-110`
  - consumer `server/fastify/src/routes/proxy.ts:71-82` (`reply.header()`
    loop + `reply.send(Readable.fromWeb(upstream.body))`)
  - client victim `src/ts/globalApi.svelte.ts:688` (`response.text()`),
    `:678` (`arrayBuffer()`), reached from `globalFetch` `:529` →
    `fetchWithProxy` `:669`
  - correct sibling: `server/fastify/src/routes/hub.ts:18`
    (`HUB_TRANSPORT_RESPONSE_HEADERS` strips `content-length` +
    `transfer-encoding`), `:161-164`
  - immune WS path: client builds `new Response(stream, {headers})` at
    `globalApi.svelte.ts:1241` (see I25)

**What.** undici's `fetch` advertises a default `accept-encoding: gzip,
deflate` (empirically verified: a fetch with only `content-type` set still made
the upstream see `accept-encoding: gzip, deflate`) and auto-decompresses the
body, but still exposes the upstream's `content-encoding: gzip` AND the
COMPRESSED `content-length` on `response.headers`. `filterResponseHeaders`
strips `content-encoding` (via `STRIP_RESPONSE_HEADERS`) but NOT
`content-length`; `routes/proxy.ts` copies the stale header via `reply.header()`
and then streams the decompressed bytes with
`reply.send(Readable.fromWeb(upstream.body))`. The mechanism lens established
the load-bearing distinction empirically against the repo's Fastify 5.8.5:
Fastify recomputes `content-length` for Buffer/string payloads but does NOT for
a stream — so the explicitly-set stale `content-length` survives onto the wire
followed by the full decompressed body. The mechanism and severity lenses
narrowed the trigger from the finder's "every gzip'd non-streaming response":
it fires ONLY when the upstream returns `content-encoding: gzip` (or deflate)
TOGETHER WITH a fixed `content-length`. When the upstream uses
`transfer-encoding: chunked` (many CDN-fronted providers, incl.
Cloudflare-fronted OpenAI/Anthropic for large JSON), undici reports
`content-length === null` and nothing stale is forwarded — Fastify re-frames the
stream as chunked and the full body is read. The mechanism lens also corrected
the finder's fix-scope: forwarding `transfer-encoding` is empirically HARMLESS
here (Fastify is itself chunking the stream so the header matches reality); the
single load-bearing defect is the stale `content-length` (stripping
`transfer-encoding` too is good hygiene parity, not strictly required).

**Impact / trigger.** Every response through `globalFetch → fetchWithProxy →
/api/v1/proxy/fetch` whose upstream replies gzip with a fixed
`content-length`: truncated/garbled body → `ERR_CONTENT_LENGTH_MISMATCH` (or
JSON.parse failure → `fetchWithProxy` returns `ok:false` with garbage) on
routine non-streaming actions — title generation, translation, embeddings
(OpenAI/Voyage), classifier/instruct, image-gen polling JSON, Cohere/OpenAI
non-streaming completions, and rawResponse binary fetches through the proxy.
Affectedness is endpoint-dependent (chunked upstreams are immune), but any
affected endpoint fails on 100% of its non-streaming calls. Streaming sends
bypass this path entirely: they route through `fetchNative` (direct browser
fetch for external hosts; the local-network branch and the WS stream-job both
wrap the body in a synthetic `new Response(stream, {headers})` that ignores the
framing headers — verified immune, see I25).

**Verifier notes.** Empirical reproductions, quoted exactly:
- Finder C55: upstream sent `content-length: 73` for a 12,000-byte payload;
  `resp.headers.get('content-length') === '73'` while `resp.text()` yielded
  12,000 chars. Setting `content-length: 73` then streaming 12,000 bytes
  emitted `content-length: 73` on the wire and wrote all 12,000 bytes; a real
  Node http client threw `HPE_INVALID_CONSTANT`.
- Liveness lens: stale compressed `content-length` `583` over a 13,903-byte
  decompressed body; `resp.text()` returned the full 13,903 bytes;
  `Readable.fromWeb` forward emitted `content-length: 583` on the wire with no
  `transfer-encoding` substitution; raw Node http client threw
  `HPE_INVALID_CONSTANT` / "Expected HTTP/".
- Mechanism lens: 12,017-byte JSON reported `content-length: 67`; Fastify 5.8.5
  control case — a Buffer send of 21 bytes recomputed the header to 21, while a
  stream send of 21 bytes against a manually set `content-length: 5` kept the
  header at 5 (the stream is exactly what keeps the bug live).

The severity lens calibrated to medium: deterministic request FAILURE (not
crash/hang/data-loss/leak), conditionally triggered on non-streaming auxiliary
calls. The existing `proxy.test.ts` (`:238-269`) masks the bug — it uses
`content-encoding: identity` + a 14-byte body + `app.inject` (light-my-request,
in-memory, no socket framing), which cannot reproduce a content-length
truncation over a real socket. The hub route's existing
`HUB_TRANSPORT_RESPONSE_HEADERS` strip set proves the omission in `/fetch` is
an asymmetric miss, not intent.

**Fix.** Add `content-length` (and `transfer-encoding` for hygiene parity) to
`proxy.ts`'s `STRIP_RESPONSE_HEADERS`, exactly mirroring the hub route's
`HUB_TRANSPORT_RESPONSE_HEADERS`; Fastify then frames the streamed body itself.
Regression test with a real `zlib.gzipSync` body over a real socket asserting
the forwarded `content-length` is absent and the decoded body length is full
(`app.inject` cannot catch framing bugs).

---

## M1 — `Chat.svelte`'s `$effect.pre` re-parses every visible message on every guarded write

- Severity: Medium · Category: perf · Area: client
- Finder: `svelte-reactivity-round2` (C58), claimed Medium, confidence high,
  known_overlap `v3-I19`
- Verification: confirmed 3-0 (liveness: medium, mechanism: medium, severity:
  medium) — median medium; all three lenses confirmed.
- Novelty: extension of `v3-I19` (the render-level consumer the v3 sweep
  missed; the listed I19 consumers were L28/L29/L30, not this site).
- Location:
  - `src/lib/ChatScreens/Chat.svelte:373` (`$effect.pre`:
    `void $ReloadGUIPointer; displaya(message)`) → `displaya()` `:350` →
    `getCbsCondition()` `:309-318` (reads
    `DBState.db.characters[selId].chats[chatPage].message[idx].role`)
  - driver `src/ts/process/postGeneration/streamResponse.ts:85-117`
    (`applyLatestChunk` → guarded `reloadKeys` bump per animation frame)
  - re-mint mechanism `src/ts/server/projectionWriteGuard.svelte.ts:29-44`
    (and `:86-97`)
  - the fix template: sibling `src/lib/ChatScreens/ChatBody.svelte:55`
    (`getCbsCondition` reads only the `firstMessage`/`role` PROPS, not
    `DBState`)
  - unmemoized parser `src/ts/parser/risuChatParser.ts:546`

**What.** Each rendered message's `Chat.svelte` instance (one per visible row,
default `loadPages = 30`) has a single `$effect.pre` that does
`void $ReloadGUIPointer; displaya(message)`. `displaya()` calls
`risuChatParser(...)` with `cbsConditions: getCbsCondition()`. Because
`getCbsCondition()` synchronously reads `DBState.db.…`, the effect takes a
dependency on the whole projection. Every `withTrustedServerProjectionWrite`
re-mints `DBState.db` to a fresh proxy identity (the deliberate `v3-I19`
copy-on-write design), firing the `db` property signal and re-running EVERY
mounted `Chat`'s `$effect.pre` — regardless of whether that message changed.
During streaming, `consumeStreamResponse`'s coalescer calls `applyLatestChunk`
~once per animation frame (~60/s), each a guarded write that bumps `reloadKeys`,
so all ~30 visible messages re-run the FULL CBS parse ~60×/s — ~1,800 parses/sec
of CPU burn for the duration of every streamed reply.

Three verifier corrections sharpen the mechanism without weakening it:
- The finder called `DBState` `$state.raw`. It is actually plain
  `$state({ db })` (`stores.svelte.ts:103`) whose `db` slot holds a Proxy that
  Svelte does NOT deep-proxy (the guard's `getPrototypeOf` trap returns a
  non-Object/Array prototype). The reactive outcome is identical: any read of
  `DBState.db.*` registers the single top-level `db` signal, which the re-mint
  reassignment fires.
- The finder called `displaya`'s work "the full CBS/markdown-it/DOMPurify
  pipeline." That is overstated: `displaya` calls `risuChatParser` only — the
  CBS layer (`risuChatParser.ts:546`, an O(len) char state-machine, fully
  unmemoized). The markdown-it/DOMPurify stage is `ParseMarkdown` inside
  `ChatBody`'s MEMOIZED `markParsing` (`$derived.by` keyed on `msgDisplay`);
  because `msgDisplay` is `$state` and the re-parse yields an equal string, the
  markdown stage and the DOM do NOT re-run. The wasted work is the unmemoized
  CBS pass only — real CPU burn, narrower than stated, and explicitly NOT
  `v3-L30` (which is the memoized markdown layer's KEY-construction cost, a
  different/cached layer; the two are additive).
- The re-run driver during streaming is specifically the `DBState.db` read in
  `getCbsCondition()`, NOT `$ReloadGUIPointer`: `streamResponse.ts` bumps only
  `reloadKeys` inside guarded writes and never touches `ReloadGUIPointer`. The
  severity lens further noted the coupling was introduced by commit
  `705dafd7f` ("narrow variable-only gui refreshes"), which replaced a
  manual non-tracked `ReloadGUIPointer.subscribe` callback with the in-effect
  `void $ReloadGUIPointer; displaya(message)` read.

**Impact / trigger.** Routine action (every chat-send that streams). Main-thread
cost ≈ (visible message count) × ~60 frames/sec × cost(`risuChatParser` per
message) for the full streaming duration — ~1,800 CBS-parse calls/sec at the
default 30 visible messages, scaling with `loadPages` (user-expandable by
scrolling up / "load more", up to `Infinity`) and per-message content size. The
`msgDisplay` `$state` equality check prevents downstream DOM/markdown churn when
the parse output is unchanged, so this is CPU burn rather than a re-render storm
— jank, not a hang — bounded by the visible window. Above low (most-routine
action, scales with transcript), below high (no hang/unbounded cost at
defaults).

**Verifier notes.** The smoking gun is the sibling asymmetry: `ChatBody.svelte`'s
own `getCbsCondition` (`:55-67`) reads only the `firstMessage`/`role` PROPS and
NOT `DBState` — and `role` is already passed to `Chat` as a prop
(`Chats.svelte:160` `role={row.message.role}`), so `Chat.svelte`'s `DBState.db`
read is gratuitous. The H3 stream-coalescer comment
(`streamResponse.ts:93`) only addresses the streaming message's own re-parse
frequency; it does not account for the collateral re-parse of the other visible
messages via the re-mint. The guard is enabled in the live web boot
(`bootstrap.ts:164`, inside `loadWebInitialDatabase`).

**Fix.** Decouple the effect from the whole projection: compute
`getCbsCondition()` via `untrack(() => getCbsCondition())` inside `displaya`, or
restructure `getCbsCondition` to take `role`/`firstMessage` as the
already-available props (mirroring `ChatBody.svelte:55`). The `$effect.pre` then
re-runs only on `$ReloadGUIPointer` and the `message` prop, so non-streaming
messages are not re-parsed on every guarded write and only the actually-changed
streaming row re-parses (already rate-limited by the H3 coalescer). Pair with
L22 (`BackgroundDom`) in the same slice.

---

## M2 — Chat/character delete never reclaims Hypa V3 memory rows

- Severity: Medium · Category: both · Area: server
- Finder: three independent finders converged — C8, C19, C46 (verified as
  cluster U-C8); claimed Medium, confidence high.
- Verification: confirmed (three independent finders converged on the same
  defect; the third finder C46 contributed the sharper embed-handler edge).
- Novelty: new lifecycle gap. Adjacent to `v3-M2` (the memory-tokens fix) and
  the memory-table redundant-index notes (I4).
- Location:
  - delete mutates `server/fastify/src/routes/commands.ts`: `chatDeleted`
    ~`:3003-3022`, `characterDeleted` ~`:2737-2760` — both run
    `deleteChatMessages` + `deleteChatHypaV3` only
  - schema `server/fastify/src/db.ts:280-342`
    (`memory_chunks` / `memory_summaries` / `memory_embeddings`, keyed by
    free-form `chat_id TEXT`; FK only chunk → summary/embedding, nothing to
    `chats(id)`)
  - only existing sweep: `pruneTerminalMemoryJobs`
    (`server/fastify/src/memoryWorker.ts`)

**What.** Deleting a chat or character removes the chat rows, message rows, and
the LEGACY `chat_hypa_v3` row (`deleteChatHypaV3`) — the route comment claims
hypa cleanup — but NO `DELETE FROM memory_*` by chat id exists anywhere on the
lifecycle. The only memory deletes in the codebase are the legacy-import wipe
and the terminal-jobs prune; neither is keyed off chat/character deletion. The
`memory_chunks`/`memory_summaries`/`memory_embeddings` rows (multi-KB float32
embedding blobs) therefore accumulate forever for memory-enabled users. Because
chat ids are UUIDs, the orphans are inert (never matched by a new chat) — a pure
monotonic disk leak.

The third converging finder (C46) sharpened the runtime edge folded into the
canonical text: pending `memory_jobs` for the deleted chat survive. Summarize
jobs fail through `assertChatExists` retries (bounded), but the embed handler
has NO chat-existence guard: it reads the orphaned chunk, calls the embedding
provider (a wasted PAID request), and persists a fresh embedding for a deleted
chat. So the leak is not purely passive — orphaned pending jobs waste worker
turns and paid embed calls.

**Impact / trigger.** Trigger: enable memory on a chat, let it summarize, then
delete the chat (or its character). Frequency: every delete of a
memory-enabled chat/character. Scaling: monotonic with the number of deleted
memory-enabled chats and their embedding-blob volume — unbounded disk growth
over the lifetime of the install. The orphan rows are inert (UUID keys) so
there is no correctness corruption; the active cost is the embed handler's
wasted provider calls for any pending embed job that outlives its chat.
Verification reproduction:
`SELECT COUNT(*) FROM memory_embeddings WHERE chat_id = ?` stays nonzero after
the chat is deleted.

**Verifier notes.** The schema has no FK from `memory_*` to `chats(id)`, so
there is no cascade to lean on; the FK that does exist is only
chunk → summary/embedding. The convergence of three independent finders on the
same missing-DELETE plus the absence of any chat-keyed memory delete in the
tree is the evidence base. The route comment asserting hypa cleanup is
misleading because `deleteChatHypaV3` only touches the LEGACY `chat_hypa_v3`
row, not the live V3 tables.

**Fix.** Add a `deleteAllMemoryForChat(db, chatId)` helper that deletes
jobs → embeddings → summaries → chunks (mirroring the legacy-import wipe order),
called from BOTH delete mutates inside the same transaction; and add
`assertChatExists` to the embed handler so a pending embed job for a
since-deleted chat short-circuits instead of issuing a paid embed call.

---

## M3 — Streamed completions: no total-size cap + sliding deadline refreshed forever

- Severity: Medium · Category: stab · Area: server
- Finder: `input-bounds-server` (C60), claimed Medium, confidence high
- Verification: confirmed 3-0 (liveness: medium, mechanism: low, severity:
  medium) — median medium; the mechanism lens dissented to low.
- Novelty: new — `v3-L5` is the inverse (a proxy job LACKING a sliding
  deadline); `v2-L1`/`v3-L2` ADDED sliding deadlines; `v2-I7` covered the SSE
  per-block growth within the 8 MB cap. None bounded the total accumulation or
  added an absolute ceiling on the slide.
- Location:
  - `server/fastify/src/prompt/providerTransport.ts:47/:81`
    (`emitProviderChunks`, `result += content`, no ceiling)
  - `server/fastify/src/generation/sse.ts:13-20` (`MAX_STREAM_BUFFER_CHARS` —
    bounds only the per-event-block parser residual `buf`)
  - deadline refresh `server/fastify/src/streamJobs.ts:187-195` and `:315-321`
    (`isStreamDeadlineActivityFrame` — any non-empty `token` frame refreshes
    the 600 s deadline); `refreshDeadline` ~`:295-300`; `tickGc` ~`:412-430`;
    `createdAt` recorded ~`:278` but never compared
  - `server/fastify/src/routes/generationChat.ts:1804-1809`
    (`registry.create({ slidingDeadline: true })`, `timeoutMs: undefined` →
    600 s default); persist via `buildDurablePostGeneration({completionText})`
    and `persistRawCancelledResult({text})`

**What.** In `emitProviderChunks`, every streamed token frame does
`result += content` with no ceiling on the accumulated string. The v2 phase-4
"8 MB stream cap" (`streamBufferExceedsCap`, `MAX_STREAM_BUFFER_CHARS`) bounds
ONLY the partial buffer between SSE delimiters — its own docstring: "The buffer
should only ever hold one partial event block." Each adapter checks the cap on
`buf` AFTER `popSseEventBlock` drains complete events (e.g. `openai.ts:354`,
`anthropic.ts`), so a well-formed upstream emitting an unbounded number of
small, properly-delimited delta frames never trips it, while `result` grows
without bound. The non-streaming path IS capped
(`generation/body.ts` `readBoundedBodyText`, 32 MB `MAX_BUFFERED_BODY_BYTES`);
the streaming path has no analogue — confirmed asymmetry.

Compounding it, the durable job runs `slidingDeadline: true` with a 600 s
window, and `pushRaw` refreshes the deadline on each non-empty `token` frame
(`isStreamDeadlineActivityFrame` returns true for token frames with non-empty
`content`). The mechanism lens added that BOTH GC backstops are defeated
together: `tickGc` has two non-done checks — `t >= deadlineAt` AND
`t - updatedAt > max(DEFAULT, timeoutMs*2)` — and `pushRaw` sets
`job.updatedAt = t` on EVERY frame (unconditionally, before the
`slidingDeadline` guard), so the stale-cleanup path is also continuously
refreshed by token traffic, independent of `slidingDeadline`. `createdAt` is
stored but never compared, so there is no max-total-duration backstop. The
provider fetch uses only `job.abortController.signal`, so the never-firing
deadline also never aborts the upstream read. The accumulated `result` is then
persisted verbatim into the chat row, where it becomes a permanent per-send
re-tokenization cost (`tokenizeChat`/`tokenize` → `getEncoder().encode(text)`,
O(message length) per send).

**Impact / trigger.** Trigger: one ordinary chat send (the default durable
path) against a misbehaving or hostile streaming endpoint — the supported
`reverse_proxy` (`chatDispatch.ts:225`) or self-hosted `ollamaURL`
(`chatDispatch.ts:280`) configured-endpoint vector flagged in scope as proxied
third-party model output. Such an endpoint streaming tokens faster than the
user reads grows one in-memory completion string toward OOM, crashing the
single-user server; the sliding deadline removes the 600 s time bound that would
otherwise terminate the runaway. Scaling: unbounded in both size (no char cap)
and time (deadline refreshed per token). A well-behaved provider honoring
`max_tokens` never triggers it.

**Verifier notes.** The severity lens quantified the OOM threshold: `result` is
a UTF-16 JS string (2 bytes/char) and the host heap is ~4.3 GB, so ~2 billion
characters to exhaust heap — at legitimate token rates (hundreds of chars/sec)
this takes many hours, and only a hostile loopback endpoint maximizing per-frame
content reaches it in minutes. It therefore framed the real teeth of the
sliding-deadline half as "turning 'would abort at 600s' into 'never aborts'"
rather than instant crash. The mechanism lens dissented to LOW: the trigger
requires a hostile/badly-broken streaming upstream ignoring `max_tokens` and
emitting gigabytes of well-formed frames; it called this latent/conditional
rather than a routine-action cost. The liveness lens noted the
deadline-refresh half (sub-claim b) is itself the accepted `v2-L1` design
("A runaway provider that produces no usable activity cannot live forever" —
active streams surviving arbitrarily long is the accepted tradeoff), so it is
the ENABLING condition for the unbounded accumulation, not an independent
finding. The non-durable `streamAssembly` path shares `emitProviderChunks` and
also refreshes per token, so it has the same accumulation gap. The canonical
doc kept it medium (single send → OOM-crash of the single-user server is
in-rubric; trigger needs a misbehaving endpoint).

**Fix.** Track `result.length` (or a UTF-8 byte counter) in `emitProviderChunks`
and once it exceeds a generous ceiling (a few MB, comfortably above any
legitimate completion — mirror `generation/body.ts`'s `MAX_BUFFERED_BODY_BYTES`
and reuse the `generation/sse.ts` constant-module pattern), emit a terminal
`error` + `done` (or a truncated `done`) and return `status: 'error'`. Add an
absolute max-total-duration backstop to the sliding deadline (compare against
`createdAt`) so token activity cannot indefinitely defer cleanup; ensure the
`updatedAt` stale path cannot be gamed by the same fix.

---

## M4 — Disabled-temperature sentinel reaches providers as `temperature: -10`

- Severity: Medium · Category: stab · Area: server
- Finder: `hostile-send-server` (C36), claimed High, confidence high
- Verification: confirmed 3-0 (liveness: high, mechanism: medium, severity:
  medium) — median medium; the canonical severity is Medium, downgraded from
  the finder's High because the disabled slider is non-default.
- Novelty: new — no temperature/`-1000`/sentinel item in the v1/v2/v3
  registry.
- Location:
  - `server/fastify/src/prompt/chatDispatch.ts:692`
    (`const temperature = typeof db.temperature === 'number' ?
    db.temperature / 100 : undefined` — no sentinel check)
  - body write e.g. `server/fastify/src/generation/openai.ts:118`
    (`if (req.temperature !== undefined) body.temperature = req.temperature`);
    identical no-clamp `Number.isFinite`-only pattern in `anthropic.ts:89`,
    `mistral.ts:172`, `gemini.ts:161`, etc.
  - SPA convention `src/ts/process/request/shared.ts:270` (`db.temperature ===
    -1000 ? -1000 : db.temperature/100`), `:315-317` (`if (value === -1000)
    continue` — the SPA omits it); `openAI/requests.ts:524` (`applyParameters`)
  - live trigger (verifier-corrected): the BotSettings → Parameters global
    temperature slider — `src/ts/setting/botSettingsParamsData.ts:51-67`
    (`samplingParameterItems`, `bindKey: 'temperature'`,
    `options.disableable: true`), rendered via
    `SettingRenderer.svelte` → `Wrappers/SettingSlider.svelte`, the disable
    checkbox at `SliderInput.svelte:93` sets `value = -1000`, written by
    `setSettingValue` (`src/ts/setting/utils.ts:56-85`) to
    `DBState.db.temperature` and persisted to the server unclamped
  - horde twin: `chatDispatch.ts:1030-1031` (raw `db.top_k`/`db.top_p`
    passthrough — same `-1000` hazard, differently shaped)

**What.** `-1000` is RisuAI's SPA-wide sentinel for a disabled slider
parameter; the SPA omits such parameters from request bodies entirely
(`applyParameters` → `if (value === -1000) continue`). The server's
`chatDispatch.ts` unconditionally computes `db.temperature / 100`, producing
`-1000 / 100 = -10`, and the adapters set that as the request body
`temperature` after only a `Number.isFinite` check (`-10` passes). OpenAI and
most OpenAI-compatible providers require temperature in `[0,2]` and reject `-10`
with HTTP 400; providers that clamp instead silently sample at the wrong
temperature.

All three lenses corrected the finder's trigger attribution. The finder cited
the per-model `AllSeperateParameters` disableable slider, which binds
`value.temperature` (a `db.seperateParameters[...]` member). The server
dispatch NEVER reads `db.seperateParameters` — it uses only the top-level
`db.temperature` from the raw persisted db — so that slider is irrelevant to
the server path. The ACTUAL live control is the GLOBAL BotSettings → Parameters
temperature slider (data-driven in `botSettingsParamsData.ts`, migrated from the
old direct `bind:value={DBState.db.temperature} disableable` slider in commit
`77ea56a5d`). Its disable checkbox writes `db.temperature = -1000` through
`setSettingValue` and persists it to the server unclamped. The disableable item
is gated on `modelInfo.parameters.includes('temperature')`, so it is shown only
for temperature-supporting providers (OpenAI/Anthropic/Gemini/Mistral) — exactly
the ones that 400 on `-10`, making the path self-consistent.

**Impact / trigger.** Trigger: the user disables the global temperature slider
(a one-click, supported UI affordance; `db.temperature` defaults to 80/enabled).
Frequency: 100% of subsequent server-dispatched sends/continues/regenerates for
that configuration. On OpenAI/OpenRouter/NanoGPT/`reverse_proxy`
OpenAI-compatible/Mistral/Gemini this is a hard HTTP 400 on every message until
the user re-enables and sets a temperature; tolerant local servers
(ooba/kobold/llama.cpp) may clamp/ignore `-10` and silently sample wrong
instead. Does not scale with corpus; recoverable by re-enabling, no data loss —
hence medium, not high. A second content-borne vector seeds the same value:
importing a native `.risupreset` carrying `temperature: -1000`
(`setPreset`, `database.svelte.ts:2544`
`db.temperature = newPres.temperature ?? db.temperature`).

**Verifier notes.** The mechanism lens confirmed no clamp anywhere in
`chatDispatch` or the adapters (grep for `clamp`/`Math.max`/`Math.min` on
temperature: none) and that the SPA's correct `applyParameters` omission path is
DEAD for live chat sends, confirming the divergence is real on the runtime. The
liveness lens also flagged lower-impact sibling instances of the same missing
guard on the dead/auxiliary browser-local path
(`src/ts/process/request/request.ts:726/964/1449` — `db.temperature/100` with no
sentinel, used by translation/memory/Lua `LLM()` via `requestChatData`). The
severity lens noted the horde passthrough sends raw `db.top_k`/`db.top_p` (NOT
`/100`), so their `-1000` sentinel passes through as raw `-1000` — a related but
differently-shaped hazard. Reproduction: disable the BotSettings temperature
slider; any OpenAI-compatible send 400s with `temperature: -10` in the request
body.

**Fix.** Mirror the SPA sentinel convention in `chatDispatch.ts`:
`const temperature = (typeof db.temperature === 'number' && db.temperature !==
-1000) ? db.temperature / 100 : undefined`. Apply the same guard to any future
top_p/penalty forwarding and to the horde `topK`/`topP` passthrough
(`chatDispatch.ts:1030-1031`).

---

## M5 — `banCharacterset` is an unbounded full-generation retry loop

- Severity: Medium · Category: both · Area: client
- Finder: `sweep:flag-multiplier-matrix` (S17), claimed Low, confidence high
- Verification: confirmed 1-0 (skeptic lens) — UPGRADED Low → Medium; this
  round-3 sweep candidate went through the lone-skeptic pass (round-3 sweeps
  used the single-skeptic scheme), which refuted the candidate's own
  retry-bound claim by control-flow simulation.
- Novelty: new — grep of the known-items registry for
  `banCharacterset`/`characterset`/`requestRetrys` returned nothing; `v3-L9`/
  `v3-L38`/`v3-L39` concern RegExp backtracking and trigger/Lua budgets, not
  this retry loop.
- Location:
  - `src/ts/process/request/request.ts:322-338` (success-path banned-script
    check → `trys += 1; continue`)
  - guard at `:368` (`if (trys > db.requestRetrys)`) — on the FAIL path only,
    below the success `return` at `:350`
  - loop top `:260` (`while(true)`); abort checks at `:261`/`:305`
  - `da.failByServerError` branch at `:360` with `trys -= 0.5` at `:363`
  - live caller `src/ts/process/request/dispatchRequest.ts:100` (the canonical
    send path, passes `abortSignal`)
  - `requestChatDataMain` `:469-528`; live completion
    `serverCompletion.ts` `requestServerCompletion:139-209`
  - setting surface `BanCharacterSetSettings.svelte` (advanced — categorized
    `'advanced'` at `server/commands.ts:44`; default empty)
  - defaults `src/ts/storage/database.svelte.ts:286-287` (`requestRetrys`
    default 2), `:699-702` (`antiServerOverloads` set true only via the legacy
    `antiClaudeOverload` migration)

**What.** On a SUCCESSFUL response (`da.type === 'success'`) containing any
banned Unicode-script character, the loop compiles `new RegExp(\`\\p{Script=
${set}}\`, 'gu')` per banned set and, on any `.test` match (a single stray
codepoint matches), does `trys += 1; continue`. The skeptic refuted the
candidate's severity-defining claim that this "repeats until `trys` exceeds
`requestRetrys` (default 2), i.e. up to 3 full generations." In fact the
`continue` at `:336` jumps straight back to the top of `while(true)` at `:260`
and NEVER reaches the `if (trys > db.requestRetrys)` guard at `:368` — that
guard is only reached on the `da.type === 'fail'` fall-through PAST the success
`return` at `:350`. On a success-with-banned-output, `da.type === 'success'`,
so `trys` is incremented but never consulted. The skeptic verified this by a
control-flow simulation (a Node reproduction of the loop): with a model that
always emits a banned script and default (empty) `fallbackModels`, the loop runs
UNBOUNDED full server generations, hitting a 1,000-iteration safety cap rather
than stopping at 3. The only exits are user abort (the `abortSignal` checks at
`:261`/`:305`) or the model eventually returning clean output. Each iteration
re-issues the whole `requestChatDataMain` call (for the live path,
`requestServerCompletion` — a fresh server prompt assembly + full provider
generation), re-runs the `'request'` trigger pass, recompiles the per-set
`RegExp`, and `console.log`s the set.

The skeptic also corrected a second candidate claim: `antiServerOverloads`'s
`trys -= 0.5` (`:363`) lives inside the `if (da.failByServerError)` branch
(`:360`), reachable only on the FAIL path, never on the success/banned
`continue` path — so it has no bearing on this multiplier, and
`antiServerOverloads` defaults falsy (set true only via the legacy
`antiClaudeOverload` migration), so it is not commonly on.

**Impact / trigger.** Trigger: every chat send while `banCharacterset` is
configured and the model output contains the banned script. Frequency: routine
send action. Scaling: UNBOUNDED full server generations (prompt assembly +
provider call + token spend per iteration) plus per-iteration `runTrigger`
('request') cost — not the bounded 3× the finder claimed. What bounds the
damage: the opt-in advanced setting (default empty), the need for the model to
persistently disobey, and user-abortability. Realistic scenario: banning a
common script (Hani/Latn) on a multilingual model that keeps emitting it.

**Verifier notes.** The skeptic read the full `requestChatData` loop
(`:231-383`), `requestChatDataMain` (`:469-528`), `requestServerCompletion`
(`serverCompletion.ts:139-209`), the database defaults
(`requestRetrys = 2`, `antiServerOverloads` migration-only, `fallbackModels`
default `[]`), the live caller chain (`dispatchRequest.ts:100`), and the UI
surface, then simulated the loop control flow in Node to prove the
`banCharacterset` `continue` bypasses the `requestRetrys` guard — making the
retry unbounded rather than capped at 3. Severity raised Low → Medium:
unbounded provider cost with no internal cap on a routine action, triggered by a
single stray banned-script codepoint, exceeds the low bar; gated behind the
opt-in advanced setting and user-abortable, so not high. Items the candidate
got right and the skeptic confirmed: `requestRetrys` default = 2;
`banCharacterset` categorized `'advanced'`; per-iteration `new RegExp` recompile
+ `console.log(set)`; each retry re-fires the full server round-trip and the
`'request'` trigger.

**Fix.** Add a dedicated small re-roll cap checked ON the `banCharacterset` path
itself — the existing `requestRetrys` check at `:368` is structurally
unreachable from the success/banned `continue`, so it cannot bound this loop.
Hoist the per-set `RegExp` out of the loop (compile once) and drop the
`console.log(set)`. Optionally surface the regenerate count to the user.
