# Stability And Performance Audit V4

Date: 2026-06-07.

Archived: 2026-06-08 in
`.archived-docs/audit-stability-and-performance-v4/`.

This is the fourth broad stability/performance audit of the Fastify-only
RisuAI codebase. It follows v1 (2026-06-04), v2 (2026-06-05) — both archived
with their completed remediation waves — and v3 (2026-06-06), whose
remediation plan is archived at
`.archived-docs/audit-stability-and-performance-v3/` and was mid-execution while this
audit ran: phases 0-3 (H1, M1-M5 partial, L11-L16, K1, K2) landed during the
audit window. The app still shows performance and stability issues in real
use, so this audit hunted specifically for what v1-v3 **missed**: new
modalities no prior round ran (concurrency interleavings, SQLite query plans,
crash windows, floating promises, transport state machines, DOM scale,
settings-flag amplification), regressions and residue in the freshly landed
v3 fixes, and whole live subsystems that no prior finder had read end-to-end
(the translator, the stage-4 post-generation pipeline, the internal MCP
clients, the image-ingest path, the editors).

The code is the source of truth. Every finding was located in current code
and adversarially re-verified against the live tree. This document is the
summary registry; the full per-finding record (corrected mechanisms,
verification votes, empirical measurements, fix amendments) lives in
[`audit-v4-findings/`](audit-v4-findings/README.md). The tree MOVED during
the audit (v3 plan execution in a concurrent session): round-1 finders read
`4ccc15194`; every verification verdict was re-checked against the working
tree between `18cc05099` and `b355586a6` (the v3 Phase-3 closeout, the HEAD
at writing time). Memory-subsystem candidates were explicitly re-verified
against the post-Phase-3 code. Line numbers will drift; symbol names are the
durable anchors. IDs in this document (H/M/L/I/R) are v4-scoped; prior-audit
items are referenced as `v1-*` / `v2-*` / `v3-*`.

## Scope And Context

- Deployment model: single-user self-host. Crashes, data loss/corruption,
  hangs (UI or server event loop), unbounded growth, and hot-path work that
  scales with corpus size are serious; multi-tenant-only concerns are not.
  Imported third-party content (cards, presets, lorebooks, Realm downloads,
  proxied model output) is a real hostile vector.
- Not released, no real users. DB migrations out of scope; normal-use data
  loss/corruption in scope.
- The full v1/v2/v3 registries — 89 v3 findings (later closed in
  `.archived-docs/audit-stability-and-performance-v3/active-risk-analysis.md`),
  the gated items (`v2-L12`, v1-L4/L7/L26/U2, the
  `.archived-docs/leftover.md` evidence gates), the no-action
  inventories, and all dismissed sets — were embedded in every finder and
  verifier prompt. Candidates matching them were classified as overlaps, not
  findings. v3 PENDING items rediscovered in the code were NOT re-reported.
- Tree health: clean tree; both project-reference TypeScript checks pass at
  the audit window (`tsc -p tsconfig.client-lib.json`;
  `tsc -p server/fastify/tsconfig.json --noEmit`).

## Method

Multi-agent audit, 162 agents across four orchestrated rounds:

- Round 1: 24 parallel finders in three strands. (A) one v3 fix-wave
  regression reviewer over every non-docs file changed in
  `ad07004ba..4ccc15194` against the plan's target-fix specs. (B) fifteen
  new-modality sweeps no prior audit ran: server concurrency/TOCTOU, SQLite
  schema/query-plan vs live query shapes, crash-window data integrity,
  floating promises/unhandled rejections, server unbounded state, timer
  inventory (both sides), SSE/WS transport state machine, durable-job state
  machine, disk/file lifecycle, error/retry storms, boot/startup cost,
  server input-shape bounds, client listener leaks, client DOM scale, client
  network waterfalls, plus algorithmic-complexity scans on both sides.
  (C) eight hostile fresh-eyes re-reviews of the most-mined subsystems
  (server send path, client send/stream/render, memory, import/export,
  proxy/hub/stream-jobs, Svelte reactivity round 2). 63 raw candidates.
- Round 2: cross-finder dedup (63 → 57 unique) then adversarial
  verification: high/medium claims by three independent lenses
  (liveness/reachability, mechanism+novelty, severity calibration), low/info
  claims by a lone skeptic instructed to refute. Majority verdicts; severity
  is the calibrated median. Several verifiers ran empirical Node/SQLite
  experiments (undici decompression header behavior, Fastify content-length
  re-framing, `Math.min` spread limits, `String.fromCharCode` stack limits,
  EXPLAIN QUERY PLAN against `node:sqlite`, control-flow simulation of the
  retry loop).
- Round 3: a completeness critic compared realized coverage against the full
  repo file inventory and proposed eight blind-spot sweeps that round-1
  finders structurally could not see — the stage-4 post-generation pipeline
  (NOT gated by `serverOwnsPostGeneration`, a fact the send-path finders
  missed), the entire translator subsystem (read by zero prior finders in
  any audit), the client IndexedDB/quota matrix, the client-side CBS display
  interpreter, a settings-flag hot-path multiplier matrix, the internal MCP
  tool clients, the image ingest/decode path, and the editor keystroke path.
  30 raw candidates, including 4 explicit verified-clean results.
- Round 4: sweep candidates deduped (30 → 22 clusters + 4 clean notes) and
  verified with the same lens scheme. Two info-grade sweep results (I26,
  I29) were accepted on the sweep's own code-level verification without a
  separate skeptic pass; they are marked accordingly.

Raw counts: 93 candidates → 79 adversarially verified clusters (73
confirmed, 6 refuted — one of them an attempted re-open of a v2 dismissal,
re-affirmed instead) + 2 info-grade sweep results accepted on the sweep's
own verification = **75 confirmed** (2 high, 5 medium, 38 low, 30
informational). ~6.5M tokens of agent reading; ~2,300 tool calls.

## Cross-Cutting Themes

Most findings are instances of eight patterns. Fix the pattern when
practical.

1. **The render pipeline still has whole-window amplifiers behind the
   projection re-mint.** The v3 audit established that every guarded write
   re-mints `DBState.db` (v3-I19, by design) and catalogued watcher-level
   consumers; v4 found the render-level ones: `Chat.svelte`'s per-message
   `$effect.pre` re-runs the full `risuChatParser` for EVERY visible message
   on every guarded write — ~30 parses × ~60/s during streaming — because
   `getCbsCondition()` reads broad `DBState.db` (M1); `BackgroundDom`
   re-parses the background HTML at the same cadence (L22); and the
   transcript window itself (`loadPages`) is a monotonic high-water-mark
   that mass-mounts entire transcripts after a deep jump (H1, L20).

2. **The server dispatch layer drops SPA parameter conventions.** The SPA
   has a `-1000 = disabled, omit from body` sentinel convention; the server
   dispatch divides the sentinel by 100 and sends `temperature: -10` to
   providers — every send fails on range-checking providers for users who
   disabled the slider (M4). The same layer computes logit biases during
   assembly and never sends them (L6), and the horde topK/topP passthrough
   carries the identical sentinel hazard.

3. **Unbounded loops and accumulation fed by third-party endpoints.** The
   streamed completion accumulates with no total cap while token activity
   refreshes the sliding deadline indefinitely (M3); the `banCharacterset`
   filter retries the ENTIRE server generation in an unbounded loop because
   its `continue` structurally bypasses the `requestRetrys` guard (M5); the
   imggen post-gen poll loops cannot be aborted (L31); deeplX chunk
   mismatches amplify into N+1 rate-gated calls (L27).

4. **Hypa V3 memory rows have no lifecycle owner.** Chat/character delete
   reclaims messages and legacy hypa rows but never the live
   `memory_chunks`/`memory_summaries`/`memory_embeddings` tables — multi-KB
   embedding blobs leak forever, and orphaned pending jobs waste worker
   turns and paid embed calls (M2). Adjacent: legacy-imported summaries are
   silently invisible to selection (model-filter mismatch, L12); every
   import wipes and re-derives the memory tables, discarding server-built
   embeddings (I8); and the v3-M2 fix is incomplete — new summaries still
   persist `tokens: 0`, so the tiktoken fallback re-runs per send (L11).

5. **The translator subsystem was never audited and it shows.** First
   audit to read it: no output memo on `translateHTML` (the network cache
   shields the fetch but the DOMParser+walk re-runs per remount, L24);
   per-render `new RegExp` compiles (L25); an unbounded IndexedDB cache
   whose quota exhaustion surfaces an error modal per new segment (L26);
   `combineTranslation` inverts its advertised behavior into per-line
   fragments (L29); and the LLM-translate path THROWS on every call because
   a read-path getter writes the read-only projection (L30 — the v3-L34
   class, at a site the v3 sweep did not enumerate).

6. **Import/export still commits before it validates.** The charx path
   persists assets and then throws without the cleanup its JSON sibling got
   (L14, the un-swept half of v2-L24); bundle import flushes asset batches
   to SQLite+disk before the inner database decodes (L15); the legacy
   memory backfill can throw `RangeError` on a large imported chat via
   `Math.min(...spread)` (L13).

7. **Single-instance UI state survives navigation.** `DefaultChatScreen` is
   one persistent component instance — `loadPages` (H1), and any future
   per-chat state added there, survives every chat/character switch because
   nothing remounts or resets it.

8. **Transport correctness details.** The proxy forwards upstream's stale
   compressed `content-length` onto a body undici already decompressed —
   truncating/desyncing every gzip+content-length provider response through
   `/fetch` (H2, empirically verified); redirects re-send custom auth
   headers cross-origin (L16); the WS path carries the same stale framing
   headers harmlessly today (I25).

## Findings Index

| ID | Sev | Cat | Area | Title |
| -- | --- | --- | ---- | ----- |
| H1 | High | both | client | Transcript window (`loadPages`) is a monotonic high-water-mark that survives chat/character switch — one deep jump, then every later long-chat open mass-mounts the whole transcript and freezes the UI |
| H2 | High | stab | server | Proxy `/fetch` forwards upstream's stale compressed `content-length` onto the decompressed body — truncating/desyncing gzip'd fixed-length provider responses |
| M1 | Med | perf | client | `Chat.svelte`'s per-message `$effect.pre` re-runs `risuChatParser` for every visible message on every guarded projection write (~30 × ~60/s during streaming) via `getCbsCondition()`'s broad `DBState.db` read |
| M2 | Med | both | server | Chat/character delete never reclaims the Hypa V3 `memory_*` rows — embeddings leak on disk forever; orphaned pending jobs waste worker turns and paid embed calls |
| M3 | Med | stab | server | Streamed completions accumulate with no total-size cap while token activity refreshes the sliding deadline forever — a hostile/runaway endpoint grows one send until OOM |
| M4 | Med | stab | server | Disabled-temperature sentinel (`db.temperature === -1000`) is divided by 100 and sent as `temperature: -10` — every send fails on range-checking providers |
| M5 | Med | both | client | `banCharacterset` retries the ENTIRE server generation in an unbounded loop — the success-path `continue` structurally bypasses the `requestRetrys` guard |

38 low-severity findings follow in
[Low-Severity Findings](#low-severity-findings); 30 informational findings in
[Informational Findings](#informational-findings).

---

## High-Severity Findings

### H1 — `loadPages` is a monotonic high-water-mark that mass-mounts transcripts after a deep jump

- Category: both · Area: client
- Location: `src/lib/ChatScreens/DefaultChatScreen.svelte:107`
  (`let loadPages = $state(30)`), `:142-150` (`scrollToMessage` sets
  `loadPages = totalMessages - index + 5`), `:639` (onscroll `+= 15`),
  `:923` (fold load-more); window consumer
  `src/lib/ChatScreens/Chats.svelte:46-89` (`loadEnd = messages.length -
  loadPages`); no remount: `ChatScreen.svelte:62/81/105` mounts
  `<DefaultChatScreen>` with no `{#key}`; `changeChatTo`
  (`globalApi.svelte.ts:1815-1844`) flips `chatPage` only; jump driver
  `src/lib/Others/BookmarkList.svelte:163-164/:225-228`.

What. The transcript is windowed: `Chats.svelte` renders at most `loadPages`
rows from the tail. `loadPages` starts at 30 and only ever GROWS — scroll-up
`+= 15`, fold load-more, and crucially `scrollToMessage` (driven by the
bookmark "go to chat" jump) sets it to `totalMessages - index + 5`, i.e.
~the full length for an early bookmark. Exhaustive search confirms NO
assignment resets it, and `DefaultChatScreen` is a single persistent
instance (no `{#key selectedCharID/chatPage}` anywhere above it), so the
value survives every chat and character switch until page reload. The next
long chat opened then mounts `min(loadPages, N)` Chat+ChatBody subtrees in
one render flush, and each mounted Chat's `$effect.pre` synchronously runs
`risuChatParser` (full CBS pass) per message, followed by per-message
`ParseMarkdown` microtasks — a fresh chat's strings are all parse-memo
misses, and the memo is capped at 180 entries anyway.

Impact / trigger. Two-step routine sequence: (1) raise the mark in one long
chat (jump to an old bookmark in a single click, or scroll back through
history), (2) open any other long chat — multi-second main-thread freeze
plus a large DOM/memory spike, recurring for every long-chat open for the
rest of the session. Long chats are the routine case for this app. Verifier
calibration: two lenses rated high, one medium (the dangerous magnitude
needs the deliberate deep-jump first; the scroll-up path self-limits to the
chat's own length) — kept high on the lethality and session-stickiness of
the post-trigger state. Also note the chat opens as a message-less stub, so
the mass mount fires right after hydration resolves; the loading overlay
does not gate it.

Fix. Reset `loadPages = 30` when the active chat identity changes (an
`$effect` keyed on the chat id, mirroring `Chats.svelte`'s existing
`previousChatRoomId` tracking), or wrap `<Chats>` in `{#key chatId}` so
window state is per-chat. Keep `scrollToMessage`'s growth transient to that
jump. The same reset bounds L20 (screenshot) collateral.

### H2 — Proxy `/fetch` forwards stale compressed `content-length` onto decompressed bodies

- Category: stab · Area: server
- Location: `server/fastify/src/proxy.ts:16-22`
  (`STRIP_RESPONSE_HEADERS` — strips `content-encoding` but NOT
  `content-length`), `filterResponseHeaders:103-110`; consumer
  `server/fastify/src/routes/proxy.ts:71-82` (`reply.header` loop +
  `reply.send(Readable.fromWeb(upstream.body))`); client victim
  `src/ts/globalApi.svelte.ts:678/:688` (`fetchWithProxy` →
  `response.arrayBuffer()/text()`). Contrast: `routes/hub.ts:18`
  (`HUB_TRANSPORT_RESPONSE_HEADERS` strips content-length +
  transfer-encoding — the correct sibling).

What. undici's `fetch` advertises `accept-encoding: gzip, deflate` and
auto-decompresses the body, but still exposes the upstream's
`content-encoding` and the COMPRESSED `content-length` on
`response.headers` (empirically verified: upstream `content-length: 73` for
a 12,000-byte payload). `filterResponseHeaders` strips `content-encoding`
but not `content-length`; the route copies the stale header via
`reply.header()` and then streams the decompressed bytes. Verified against
the repo's Fastify 5.8.5: a stream payload does NOT cause Fastify to
recompute the explicitly-set `content-length`, so the wire response carries
`content-length: 73` followed by 12,000 body bytes — the browser truncates
at 73 and a keep-alive socket desyncs (Node client reproduces
`HPE_INVALID_CONSTANT`).

Impact / trigger. Every response through `globalFetch → fetchWithProxy →
/api/v1/proxy/fetch` whose upstream replies gzip **with a fixed
content-length**: truncated/garbled JSON → `ERR_CONTENT_LENGTH_MISMATCH` or
parse failure on routine actions (non-streaming provider calls, title
generation, translation, embeddings, image/asset fetches through the
proxy). Verifier calibration (med lens): upstreams that use chunked
transfer (many CDN-fronted providers) expose `content-length: null` and are
unaffected, so affectedness is endpoint-dependent — but any affected
endpoint fails on 100% of its non-streaming calls. Streaming sends bypass
this path (`fetchNative` → direct browser fetch / WS job whose synthetic
`Response` ignores framing headers — verified immune, see I25).

Fix. Add `content-length` and `transfer-encoding` to
`STRIP_RESPONSE_HEADERS`, exactly mirroring the hub route's existing
`HUB_TRANSPORT_RESPONSE_HEADERS`; Fastify then frames the streamed body
itself. Regression test with a real `zlib.gzipSync` body over a real socket
(the existing `proxy.test.ts` uses `content-encoding: identity` +
`app.inject`, which cannot catch framing bugs).

---

## Medium-Severity Findings

### M1 — `Chat.svelte`'s `$effect.pre` re-parses every visible message on every guarded write

- perf · client · `src/lib/ChatScreens/Chat.svelte:373` (`$effect.pre` →
  `displaya()` `:350` → `getCbsCondition()` `:309-318` reads
  `DBState.db.characters[selId].chats[chatPage].message[idx].role`); driver
  `src/ts/process/postGeneration/streamResponse.ts:85-117`
  (`applyLatestChunk` → guarded `reloadKeys` bump per animation frame);
  re-mint mechanism `src/ts/server/projectionWriteGuard.svelte.ts:29-44`.
  Extension of the v3-I19 consumer class (the render-level instance the v3
  sweep missed).

Each rendered message's `$effect.pre` calls `displaya()` →
`risuChatParser(...)` with `cbsConditions: getCbsCondition()`. Because
`getCbsCondition()` synchronously reads `DBState.db.…`, the effect takes a
dependency on the whole projection proxy, which is re-minted by EVERY
guarded write (v3-I19 design). During streaming the coalescer issues one
guarded write per animation frame, so all ~`loadPages` (default 30) visible
messages re-run the FULL CBS parse ~60×/s — ~1,800 parses/sec of pure CPU
burn for the duration of every streamed reply (the `msgDisplay` equality
check stops DOM churn, not the parser work). All three lenses confirmed at
medium; the sibling `ChatBody.svelte:55` `getCbsCondition` deliberately
reads only props — the template for the fix. Fix. Read the CBS condition
inputs from already-available props (role/firstMessage), or wrap the
`DBState` access in `untrack()` so the effect re-runs only on
`$ReloadGUIPointer` and the `message` prop. Pair with L22 (BackgroundDom)
in the same slice.

### M2 — Chat/character delete never reclaims Hypa V3 memory rows

- both · server · delete mutates `server/fastify/src/routes/commands.ts`
  (`chatDeleted` ~`:3003-3022`, `characterDeleted` ~`:2737-2760` — both run
  `deleteChatMessages` + `deleteChatHypaV3` only); schema
  `server/fastify/src/db.ts:280-342` (`memory_chunks/summaries/embeddings`
  keyed by free-form `chat_id TEXT`, FK only chunk→summary/embedding,
  nothing to `chats(id)`); only sweep is `pruneTerminalMemoryJobs`
  (`memoryWorker.ts`). Three independent finders converged on this.

Deleting a chat or character removes the chat rows, message rows, and the
LEGACY `chat_hypa_v3` row — the route comment claims hypa cleanup — but no
`DELETE FROM memory_*` by chat id exists anywhere on the lifecycle (the only
memory deletes are the legacy-import wipe and the terminal-jobs prune).
Orphaned chunk/summary/embedding rows (multi-KB float32 blobs) accumulate
forever for memory-enabled users; chat ids are UUIDs so the orphans are
inert, a pure monotonic disk leak. Sharper edge from the third finder:
pending `memory_jobs` for the deleted chat survive — summarize jobs fail
through `assertChatExists` retries (bounded), but the embed handler has NO
chat-existence guard: it reads the orphaned chunk, calls the embedding
provider (a wasted paid request), and persists a fresh embedding for a
deleted chat. Fix. A `deleteAllMemoryForChat(db, chatId)` helper
(jobs → embeddings → summaries → chunks, mirroring the legacy-import wipe
order) called from both delete mutates inside the same transaction; add
`assertChatExists` to the embed handler.

### M3 — Streamed completions: no total-size cap + sliding deadline refreshed forever

- stab · server · `server/fastify/src/prompt/providerTransport.ts:47/:81`
  (`emitProviderChunks`, `result += content`, no ceiling);
  `generation/sse.ts:13-20` (`MAX_STREAM_BUFFER_CHARS` bounds only the
  partial event block between delimiters); deadline refresh
  `streamJobs.ts:187-195/:315-321` (`isStreamDeadlineActivityFrame` — any
  non-empty token frame refreshes the 600 s deadline);
  `routes/generationChat.ts:1804-1809` (`slidingDeadline: true`).

The v2 phase-4 "8 MB stream cap" bounds the SSE parser's residual buffer
only (its own docstring: one partial event block); a well-formed upstream
emitting unlimited small delta frames never trips it, and `result` grows
without bound. The sliding deadline (v2-L1) has no absolute ceiling, so
continuous token activity defers the 600 s deadline indefinitely — the time
bound that would otherwise cap accumulation never fires. The accumulated
string is then persisted verbatim into the chat row, where it becomes a
permanent per-send re-tokenization cost. Source is third-party model output
(custom endpoints, reverse proxies) — a flagged hostile vector. Verifier
calibration: med/low/med — kept medium (single send → OOM-crash of the
single-user server is in-rubric; trigger needs a misbehaving endpoint).
Fix. Track `result.length` in `emitProviderChunks` and emit a terminal
error past a generous ceiling (mirror `MAX_BUFFERED_BODY_BYTES`); add an
absolute max-total-duration backstop to the sliding deadline.

### M4 — Disabled-temperature sentinel reaches providers as `temperature: -10`

- stab · server · `server/fastify/src/prompt/chatDispatch.ts:692`
  (`db.temperature / 100`, no sentinel check); body write e.g.
  `generation/openai.ts:118`; SPA convention
  `src/ts/process/request/shared.ts:270/:315-317` (`=== -1000` → omit).
  Live trigger (verifier-corrected): the BotSettings → Parameters global
  temperature slider (`src/ts/setting/botSettingsParamsData.ts:51-67`,
  `disableable: true` → `SliderInput.svelte:93` writes
  `db.temperature = -1000`, persisted to the server unclamped).

`-1000` is the SPA-wide "slider disabled" sentinel; the SPA omits such
parameters from request bodies. The server dispatch unconditionally divides
by 100 and ships `temperature: -10`; OpenAI-compatible providers reject it
(HTTP 400) — every send/continue/regenerate fails for that configuration
until the user re-enables the slider; clamping providers silently sample
wrong. Verifier corrections: the finder cited the per-model
`AllSeperateParameters` slider, which writes `db.seperateParameters` (never
read by server dispatch) — the live trigger is the GLOBAL parameters
slider; not default (default 80/enabled), hence medium not high. The horde
`topK/topP` passthrough (`chatDispatch.ts:1030-1031`) carries the identical
hazard. Fix. `db.temperature !== -1000 ? db.temperature / 100 : undefined`
(the shared.ts convention), same guard on any future parameter forwarding.

### M5 — `banCharacterset` is an unbounded full-generation retry loop

- both · client · `src/ts/process/request/request.ts:322-338` (success-path
  banned-script check → `trys += 1; continue`), guard at `:368`
  (`if (trys > db.requestRetrys)`) is on the FAIL path only; loop top
  `:260`; live caller `dispatchRequest.ts:100` (the canonical send path);
  setting surface `BanCharacterSetSettings.svelte` (advanced, default
  empty).

On a SUCCESSFUL response containing any banned Unicode-script character
(`\p{Script=X}` — a single stray codepoint matches), the loop increments
`trys` and `continue`s — jumping back to the top of `while(true)` WITHOUT
ever reaching the `requestRetrys` guard, which sits below the success
`return` on the fail path. Verified by control-flow simulation: with a
model that keeps emitting the banned script, the loop runs unbounded full
server generations (prompt assembly + provider call + token spend per
iteration); the only exits are user abort or the model eventually
complying. The skeptic UPGRADED this from the finder's low: unbounded
provider cost on the routine send action, realistic with a common-script
ban (Hani/Latn) on a multilingual model — gated only by the opt-in advanced
setting. Each iteration also recompiles the per-set `RegExp` and
`console.log`s the set. Fix. A dedicated small re-roll cap checked ON the
banCharacterset path itself (the existing `requestRetrys` check is
structurally unreachable from it); hoist the RegExp; drop the log.

---

## Low-Severity Findings

38 confirmed low-severity findings. Bounded, infrequent, or confined to
opt-in subsystems, but real and actionable. Grouped by area; the location is
the durable anchor. Titles incorporate verifier corrections.
`[v2-*]`/`[v3-*]` = residual or extension adjacent to a known prior item.

### Server — generation / durable lifecycle

| ID | Title | Location |
| -- | ----- | -------- |
| L1 | Durable `continue` persists assembly-time snapshot text + completion over a concurrent mid-generation edit of the target row — the revision guard cannot catch it because `baseRevision` is captured at PERSIST time (`getSchemaState` runs after the await window), not at assembly time | `routes/generationChat.ts` `resolvePostGenerationResult`/`buildRawModeMessage` (continue branch ~`:706-727`), `persistServerGenerationResult` `:1226` (baseRevision capture) |
| L2 | `continue`'s `done.finalText` carries the WRONG row (whatever the tail is after a start-trigger reshape, e.g. the impersonated user row) — `continueIndex = messages.length - 1` is computed after triggers mutate the transcript; durable and inline paths share the bug | `prompt/assemble.ts:1901-1971` (`runServerPostGeneration` continue branch); consumer `routes/generationChat.ts:1453/1519` |
| L3 | After a second tab takes writership, the original tab's cancel DELETE is 423-blocked by the active-writer gate AND the client never inspects the response — the Stop button silently no-ops with zero feedback | `routes/generationChat.ts` DELETE handler ~`:1896-1909`; `routeManifest.ts:546-559`; client `serverChat.ts:127-141` (`cancelServerChatGeneration`, no `response.ok` check) |
| L4 | Reattaching to a no-viewer durable stream truncates live text at the 512-EVENT replay cap (≈512 provider deltas ≈ a few KB of text — orders of magnitude below the nominal 2 MB byte cap); the suppressed `done.result` is only corrected by the projection refresh | `streamJobs.ts:203/:215-225` (`appendDurableReplayFrame`, `PROXY_STREAM_MAX_PENDING_EVENTS=512` fires first) |
| L5 | `makeMs` builds the reversed history window with `unshift` in a loop — O(N²) element moves per send, twice when a start trigger runs (real but small constant; verifier kept low) | `prompt/history.ts:462-475` (`mss.unshift(d)` at `:472`), called at `:476` and `:508` |
| L6 | Logit biases (`db.bias` ∪ char bias) are assembled into `state.biases` and shipped on the prompt SSE event but NEVER passed to any provider — the configured Bias feature silently does nothing on the live server-dispatch path (opt-in feature, default empty) | `prompt/assemble.ts:1195-1202/:1727-1728`; `chatDispatch.ts:41-46` (`ChatDispatchArgs` has no biases field) |

### Server — assembly / triggers

| ID | Title | Location |
| -- | ----- | -------- |
| L7 | User-supplied regexes from imported cards run unbudgeted on the server assembly path at sites OUTSIDE v3-L9's trigger-effect scope: lorebook `useRegex` keys and customscript `in` patterns — catastrophic backtracking blocks the event loop per send [v3-L9] | `prompt/lorebook.ts:339-359` (`getCompiledLoreKeyRegex`), `:391-404` (`searchMatch`); `prompt/scripts.ts:308-315/:361-389` (`prepareOne` + test/replace) |

### Server — persistence / schema / boot

| ID | Title | Location |
| -- | ----- | -------- |
| L8 | `idx_messages_chat_seq` exactly duplicates the messages `PRIMARY KEY (chat_id, seq)` b-tree — pure write amplification on every message insert/edit/delete (calibrated low: background, bounded) | `messageStore.ts:82-86` (`createMessageTable`) |
| L9 | Auth `__password`/known-keys files are written with plain truncating `writeFileSync` (no temp+rename/fsync) — a torn write 401-DENIES all data routes on next boot (not open-access; recovery = re-set password) while the atomic pattern already exists for legacy storage [v2-L26] | `auth.ts:68/:72`; contrast `routes/legacyStorage.ts:76-95` (`writeLegacyStorageFileAtomic`) |
| L10 | Server boot synchronously loads + JSON-parses the ENTIRE message corpus before `listen()` purely to feed the legacy hypaV3 backfill — a no-op on a converged DB, paid on every restart, scaling with corpus size | `app.ts:127` (`backfillLegacyHypaV3MemoryRows(db, loadPersistedWithMessages(...))`); `repository.ts:1132`; `messageStore.ts:512` |

### Server — memory subsystem

| ID | Title | Location |
| -- | ----- | -------- |
| L11 | v3-M2 fix residue: summarize/persist still writes `tokens: 0`, so the landed tiktoken fallback re-encodes every candidate summary's full text on EVERY memory-enabled send (the per-assembly cache dedupes within one send only; the planner's L15 memo covers prefix CHATS, not summary text — separate workload) [v3-M2] | `memorySummaryAdapter.ts:49` (`tokens: 0`), `memorySummarizeJobHandler.ts:400`; fallback `prompt/assemble.ts:1354` (`createPromptMemorySummaryTokenCost`) |
| L12 | Legacy-imported summaries are NEVER selected: selection filters `summary.model === settings.summarizationModel` but legacy rows carry the sentinel `'legacy-hypav3'` — migrated memory silently drops out of prompts and the planner re-chunks + re-summarizes the entire covered history (paid provider calls) | `memoryLegacyImport.ts:117` (`LEGACY_HYPA_V3_SUMMARY_MODEL`); `memorySelectionService.ts:105/:115`; `prompt/assemble.ts:1327` |
| L13 | Legacy backfill `Math.min(...resolvedSeqs)` spread throws `RangeError` (uncaught import 500) when a single summary's non-deduped `chatMemos` exceed ~126k entries — import-controlled input (empirically reproduced at 130k on Node 24) | `memoryLegacyImport.ts:160-162` (`collectLegacySummaryPlans`); reached via `routes/save.ts:421` on every import |

### Server — import / export / transport

| ID | Title | Location |
| -- | ----- | -------- |
| L14 | `importRealmCharx` commits package assets (rows + files + revision bump) and then throws WITHOUT the cleanup the JSON-card path got in v2-L24 — live post-commit throw sites include the embedded-card asset-resolution failure; orphans persist past GC grace because the rows are committed [v2-L24] | `routes/realmImport.ts:579-607` (unguarded `appendRealmCharacter`) vs `:334-356` (JSON path `cleanupCreatedAssetResults`) |
| L15 | `/import/bundle` flushes decoded asset batches to SQLite+disk BEFORE decoding the inner `database.risu` (the end-of-stream `batcher.flush()` precedes the decode even for small bundles) — a corrupt inner DB leaves all bundle assets committed with no rollback [v2-L24] | `routes/save.ts:148-204`; `localBackupImport.ts:119/:223` (`AssetBatcher`) |
| L16 | Proxy `/fetch` follows redirects with undici defaults: the spec strip-list covers `authorization`/`cookie` but NOT custom auth headers — `x-api-key`/`api-key` are re-sent cross-origin to a provider-chosen redirect target (third-party trust); hub already uses `redirect: 'manual'` | `routes/proxy.ts:64-69` (no `redirect` option); contrast `routes/hub.ts:137-141` |

### Client — send path

| ID | Title | Location |
| -- | ----- | -------- |
| L17 | Double-send window on the send path: the only gate (`$doingChat`) is set INSIDE `sendChat`, after the M4 append round-trip is awaited — a second Enter mid-await appends a second user message and starts a concurrent send. Verifier corrections: the window PRE-DATES the v3-M4 fix (the old path had no sync lock either — M4 widened it from microtask-scale to a full RTT), and the server's `baseRevision` check rejects the second append in most interleavings (liveness lens dissented on that basis) [v3-M4] | `DefaultChatScreen.svelte` `sendMain` (guard `:212`, await `:261`); `index.svelte.ts:158` (`doingChat.set(true)`) |
| L18 | Cancelling before the first streamed token leaves the optimistic empty assistant bubble in the projection — `persistRawCancelledResult` only runs when partial text exists, and the aborted return path exits before the terminal handling that would clean it up | `index.svelte.ts:398-400` (aborted return); `streamResponse.ts:73-83` (optimistic row push); server `generationChat.ts:1715-1727` |
| L19 | Every authenticated request re-mints an ES256 JWT — IndexedDB open + key read + ECDSA sign + sync localStorage write per call, no caching of the 5-minute-valid token or the opened DB handle (felt as per-command latency on slow storage; calibrated low) | `fastifyStorage.ts:81/:48/:90`; `util.ts:1210/:1244` (`openKeypairStoreDB` per call); consumers `server/commands.ts:2249`, `server/projection.ts` |

### Client — render / window

| ID | Title | Location |
| -- | ----- | -------- |
| L20 | `screenShot()` sets `loadPages = Infinity` and mounts + parses the FULL transcript synchronously, holding every rasterized canvas simultaneously through the merge — the parse-memo's 180-entry cap means >180-message chats re-parse everything (deliberate user action; pairs with H1's reset) | `DefaultChatScreen.svelte:434-494` (`:437` Infinity, `:444-448` canvases) |
| L21 | Drag-partial-edit attaches `selectionchange` + capture-`scroll` + `mousedown` document listeners PER in-viewport message (correctly detached on viewport exit — not a leak, but ~dozens of live document listeners while editing; the block-hover sibling was deliberately hoisted to one shared handler in v2-L41) [v2-L41] | `PartialEditController.svelte:660-727` (per-instance `$effect`), `:599-622` (per-message IntersectionObserver); contrast `:22-192` |
| L22 | `BackgroundDom` re-runs `risuChatParser` + `ParseMarkdown` on the character background HTML on every guarded projection write — up to ~60/s during streaming (coalescer-capped, not per-token), bounded to one blob, opt-in background-HTML surface [v3-I19] | `BackgroundDom.svelte:13` (`$derived(DBState.db…)` fresh proxy per re-mint), `:20` (`{#await ParseMarkdown(...)}`) |
| L23 | `{{date::fmt}}`/`{{time::fmt}}`/`{{datetimeformat::fmt}}` construct 4 `Intl.DateTimeFormat` instances (~0.2 ms) per call regardless of which tokens the format uses — amplified per message across the visible window on render AND per occurrence on server assembly (the no-arg `{{date}}`/`{{time}}` forms are exempt; content-conditional on imported cards) | `risuChatParserHelpers.ts:55-88` (`dateTimeFormat`); consumers `cbs.ts:1956/:1978`, server `prompt/cbsAdapter.ts` |

### Client — translator subsystem (first audit coverage)

| ID | Title | Location |
| -- | ----- | -------- |
| L24 | `translateHTML` has no output memo: every remount of an already-translated message (send → last ~6 remount, chat switch → whole window, trigger reloads) re-runs the full DOMParser + recursive `translateNode` walk + XMLSerializer (~0.2-10 ms per message by size) even on 100% network-cache hits — the detection key gates only the `translated` flag, not the walk; the LLM branch swaps the walk for an IndexedDB `getItem` per message per remount (autoTranslate opt-in) [v2-M16 adjacent] | `translator.ts:370/:428-610`; `ChatBody.svelte:145` (gate) vs `:182` (ungated call), `:394` (`$derived.by` markParsing) |
| L25 | `applyEdittransRegex` compiles `new RegExp(script.in)` for every edittrans script on every translated message render — no compiled-regex memo, while `processScriptCache`/`getCompiledRegex` siblings exist (autoTranslate + edittrans scripts) | `translator.ts:759/:769-775`, called at `:411/:422/:607` |
| L26 | LLM translation cache (IndexedDB `LLMTranslateCache`) grows monotonically keyed by full source text — no prune/LRU, only the manual Playground clear; on quota exhaustion every NEW segment's `setItem` rejection surfaces an error-modal chain while cached segments still render | `translator.ts:102/:622/:701`; clear only `languageSettingsData.svelte.ts:370` |
| L27 | deeplX super-chunked translate: a delimiter-split mismatch falls back to N sequential one-by-one `translate()` calls, each gated by the shared `waitTrans` rate-limiter once primed (~3 s spacing) — one mismatched long message ≈ N×3 s translation stall (opt-in deeplX) | `translator.ts:441/:466-471` (fallback), `:247-254` (`waitTrans`) |
| L28 | No `QuotaExceededError` handling on any client localforage `setItem` (9+ stores) — render-path translation writes silently lose the already-paid translation and re-request it per render; other sites differ in failure surface (the import path IS guarded per-item) | `translator.ts:701`; `ChatBody.svelte:97-117` (`reportParsingError` chain); store inventory in I-rows |
| L29 | `combineTranslation` inverts its advertised behavior: the per-`<br>`-line branch issues one network translate call AND one editdisplay script pass PER line fragment of a multi-line paragraph (doubly opt-in: autoTranslate + combineTranslation, both default false) | `translator.ts:549-581` (`translateNode` combine branch) → `:478-525` (`translateNodeText`, `reprocessDisplayScript=true`) |
| L30 | LLM-translate THROWS on every call: `getCurrentTranslatorPreset()` passes the read-only `DBState.db` projection into `getCurrentTranslatorPresetFromState`, which writes `state.translatorPrompt`/`translatorMaxResponse` (both the preset and normalize branches) — the guard's set trap throws unconditionally, surfacing an error modal; the LLM translator mode is effectively broken (v3-L34 projection-guard class, un-enumerated site) [v3-L34-class] | `translator/presets.ts:172-182`; `translator.ts:119` (`getDatabase()` — no snapshot); guard `projectionWriteGuard.svelte.ts:126-128` |

### Client — stage-4 post-generation / MCP / media

| ID | Title | Location |
| -- | ----- | -------- |
| L31 | Imggen post-gen ignores the abort signal (unlike the gated emotion sibling): after a COMPLETED stream, Stop/chat-switch cannot interrupt the submodel caption LLM call or the comfy/wavespeed poll loops (1 s/3 s polls up to timeout/10 min, no abort listener); mid-stream aborts never reach stage 4 (verifier correction) | `runStage4.ts:112-114` (no gate) vs `:89` (emotion gate); `stableDiff.ts:33` (signal omitted), `:563-579` (comfy), `:883-920` (wavespeed) |
| L32 | Every INTERNAL `requestChatData` call (LLM translate, emotion fallback, submodel caption, memory, Iris) fires the character's client-side `request` trigger pass — script iteration per auxiliary call (no transcript clone: `displayMode: true` skips it — verifier-corrected), a per-feature multiplier uncatalogued by the server-trigger items [v3-L8/I5 class] | `request.ts:275-290` (`runTrigger(currentChar,'request',{displayMode:true})`); callers: translator, emotionFallbackLlm, stableDiff submodel |
| L33 | Internal MCP clients (googlesearch unconfigured, fs handshake) THROW from `checkHandshake()` inside `initializeMCPs` with no try/catch — the first `getTools()` of every client-side LLM feature (translator, emotion, Iris, Lua `LLM()`) rejects while such a module is enabled, breaking those features until the module is disabled | `mcp.ts:85-124` (unguarded `await MCPs[mcp].checkHandshake()` at `:122`); `googlesearchclient.ts:154-158` |
| L34 | GraphMem `readMemory` re-embeds EVERY graph node on each call and then discards the embeddings' purpose (latent defect per verifier) — O(graph size) paid embedding calls per tool read, growing as the model accumulates `writeMemory` entries in the chat var (opt-in graphmem module) | `graphmem.ts:115-167` (`handleReadMemory` → `processer.embedDocuments(graph.map(g => g.name))`) |
| L35 | FileSystem MCP base64 read does `String.fromCharCode(...uint8Array)` — empirically throws `RangeError` at ~122 KB, far below its own 5 MB cap, so any real image read reliably fails; content search reads whole files with no per-file size cap (opt-in fs module) | `filesystemclient.ts:509-554` (`readFileAsBase64`), `:679-774` (search) |
| L36 | `writeInlayImage` decodes model/proxy-supplied images at full source resolution on the main thread before downscaling — a decompression-bomb image from a hostile endpoint hangs/OOMs the renderer (gated by `outputImageModal` opt-in or a `hasImageOutput` model flag) | `files/inlays.ts:206/:229/:123`; reached from `request/google.ts:794-802` (`inlineData`), gate `google.ts:440` |

### Client — plugins / auth

| ID | Title | Location |
| -- | ----- | -------- |
| L37 | V3 plugin GUEST-registered `document` listeners and `SafeMutationObserver`s are never removed on plugin unload/reload — `SafeMutationObserver` has NO disconnect method at all; same root lifecycle gap as v3-M7 but a separate cleanup surface (per-plugin-toggle accumulation) [v3-M7] | `plugins/apiV3/v3.svelte.ts:305-394` (`SafeElement.addEventListener`, document at `:376/:389`), `:494-535` (`SafeMutationObserver`, no disconnect) |
| L38 | DPoP keypair eviction (IndexedDB under quota pressure) silently regenerates a keypair the server has not approved — every request bare-401s for the rest of the session; recovery requires reload + password re-entry; nothing requests persistent storage (two independent storage singletons each carry their own `authChecked` — verifier-corrected) | `util.ts:1210-1265` (`DPoPDB`); `fastifyStorage.ts:90-109` (`getKeyPair` regenerate-on-miss), `:190-261` (`checkAuth`) |

---

## Informational Findings

Real, verified, and worth recording, but below the low bar after calibration
(bounded cost, narrow or dead trigger, or design-note status).

| ID | Title | Location |
| -- | ----- | -------- |
| I1 | No process-level `unhandledRejection`/`uncaughtException` handler (Node 24 default = crash) — but no realistic escaped-rejection path was found: Fastify wraps handlers, and both risky interval callbacks are try/catch-guarded except gcTimer (I2); preventive hardening only | `index.ts:13`; `app.ts:86`; tree-wide `rg 'process\.(on|once)'` = 0 hits |
| I2 | `gcTimer` interval callback lacks the try/catch its two sibling timers have — no realistic throw site inside either `tickGc` in current code; guard for symmetry when touched | `app.ts:177-181` vs `:190-196/:260-287` |
| I3 | Finalization-retry stale replay (re-appending a superseded assistant row after the transcript advanced) is real as code but its concrete triggers were refuted (single sync DB handle → no SQLITE_BUSY; RevisionMismatch is terminal here); stays inventory with v3-I4 [v3-I4] | `routes/generationChat.ts:1327-1424`; `app.ts:260` (5 s sweep) |
| I4 | Three single-column memory-table indexes are exactly redundant with their leading-column composites — background write-amp on worker writes only | `db.ts:293-339` (`idx_memory_{chunks,summaries,embeddings}_chat_id`) |
| I5 | No prepared-statement caching anywhere (`db.prepare` per call) — fixed ~10-14 prepares per command, dwarfed by JSON work; engine is `node:sqlite` `DatabaseSync` | repository.ts/messageStore.ts/memoryRepository.ts prepare sites |
| I6 | `idx_chats_character_id` lacks `position`, forcing a temp b-tree sort per per-character chat read — verified via EXPLAIN QUERY PLAN on `node:sqlite`; sorts one character's rows (tens), immaterial | `repository.ts:264`; consumers `:1034/:1216` |
| I7 | Realm JSON-card import: asset persist and character append are two separate committed transactions — a crash between them strands committed assets; the v2-L24 slice DELIBERATELY chose compensating cleanup over one transaction (crash-window residual of that decision) [v2-L24] | `routes/realmImport.ts:325-356` |
| I8 | Every risusave/bundle import wipes all four memory tables and re-derives from `hypaV3Data.summaries` — server-built embeddings are discarded but auto-rebuild on the next memory-enabled send (paid re-embed cost, no permanent loss — verifier-corrected) [v3-M2 adjacent] | `memoryLegacyImport.ts:78-89`; `routes/save.ts:419-427` |
| I9 | `TaskRateLimiter` schedules one redundant retry timer per over-limit task (aligned wake-ups) — consuming path dead on the live runtime (browser-local embed batches) | `process/memory/taskRateLimiter.ts:133/:59/:66` |
| I10 | A plain send pays 2 strictly-serial RTTs (append command, then generate) — NOT redundant persistence (the server does not persist the user message on plain sends; the append is the system of record); sequencing is contractual, potential future single-RTT send+message route | `DefaultChatScreen.svelte:261` → `:272`; `generationChat.ts:504-530` |
| I11 | SSE replay after reconnect serially fetches one projection resource per contiguous FOREIGN event — zero cost single-tab (own-echoes skip); bounded by the event-history window; second-writer scenarios only | `bootstrap.ts:329-355` |
| I12 | `buildMemoryWindow` splice(0,1)-in-loop is 0.03-0.19% of the trim loop's cost — the dominant cost is per-row tiktoken (measured 285× larger); fold into any L11 slice | `prompt/memory.ts:58-64` |
| I13 | V2 trigger array ops JSON-parse+stringify the whole array var per element op — bounded by the wall-clock budget + the 100-iteration lag guard (measured); pattern note for trigger authors [v3-L9 adjacent] | `prompt/triggerDataEffects.ts:320-386` |
| I14 | `applyMessageMutation` splices (inserts) instead of replacing when an upsert's content mismatches the row at that index — all claimed live triggers refuted (append failure aborts the send; ids are stamped pre-dispatch); latent defensive mismatch | `request/serverMessagePatch.ts:20-37` |
| I15 | HypaV3 'summarizing…' overlay can stick on a missed terminal SSE event — cosmetic only (pointer-events-none badge), self-heals on the next memory event or reload | `routes/events.ts:156-161` (live-only memory events); `HypaV3Progress.svelte:12/:31` |
| I16 | Bulk command/asset arrays: per-element work is indexed point lookups (`idx_messages_uid`), O(transcript) total — same order as the diff/write itself; bulk-assets neutralized by the 24-item client batcher [v3-I2] | `routes/commands.ts:3653-3671`; `messageStore.ts:230` |
| I17 | TextAreaInput popup-editor poll interval + await-sleep loop never cleared on unmount (double-gated: opt-in `longPressToPopupEditor` + contextmenu/hotkey; fires on desktop right-click too — verifier-corrected) | `lib/UI/GUI/TextAreaInput.svelte:394/:377-379` |
| I18 | No read-side liveness probing on any SSE/WS surface, and the client's manual SSE parse (`iterateSseEvents` — NOT a browser EventSource, no auto-reconnect) has no stall watchdog: a half-open connection hangs silently until the OS TCP timeout (~15 min) | `routes/events.ts:148-165`; `generationChat.ts:1117-1133`; client `server/events.ts` + `sseParse.ts` |
| I19 | Asset GET ignores HTTP Range (no `accept-ranges`/206) — degrades only forward-seeks past the buffered region for media; immutable cache absorbs repeat loads | `routes/assets.ts:229-251` |
| I20 | `longpress` action unmount mid-press orphans one timeout (one-shot stale callback against captured indices) — the window mousemove self-removes on next move; cosmetic | `gui/longtouch.ts:1-26` |
| I21 | The memory budget's 'important' category is dead server-side: client `toggleImportant` writes `chat.hypaV3Data` (the CLIENT store), server summaries never carry `metadata.isImportant`, selection passes no `isImportantSummary` — two divergent importance stores [v3-M2 adjacent] | `memoryBudgetAllocator.ts:336-338`; `memorySummarizeJobHandler.ts:401-410`; `HypaV3Modal/modal-summary-item.svelte:142-144` |
| I22 | Memory token costing undercounts each injected row by 4 (non-gpt) / 6 (gpt) tokens vs the SPA accounting (`tokenize(text)` vs `tokenizeChat` + separator) — systematic small overshoot of `memoryTokensRatio` [v3-M2 adjacent] | `prompt/assemble.ts:1364`; `prompt/tokens.ts:74-91` |
| I23 | WS stream-job `upstream_headers` frame carries upstream's stale `content-encoding`/`content-length`/`transfer-encoding` — benign today (synthetic `Response` ignores framing; empirically verified) but strip alongside the H2 fix | `streamJobs.ts:470-474`; client `globalApi.svelte.ts:1173-1176/:1241-1244` |
| I24 | `inlayStorage` accumulates one small metadata row per inlay attach with no prune (bytes live on the server; explicit remove path exists but no GC) | `files/inlays.ts:32/:94/:417` |
| I25 | `getModelInfo` does an uncached linear `LLMModels.find` (~52 entries) + `structuredClone` per call across 6 CBS metadata keys + the send path — immaterial per call; memo if touched | `model/modellist.ts:833-857`; `cbs.ts:2305-2325` |
| I26 | `reencodeImage`'s non-PNG branch allocates a canvas at raw source dimensions with no cap — reachable only from self-owned PNG-card export (no hostile import path reaches it; sweep-verified, no separate skeptic pass) | `files/inlays.ts:453-467` |
| I27 | `calcString`/`parseArray`/`parseDict` are linear per tag; array-CBS chained amplification is bounded by the `{{#each}}` expansion budget, EXCEPT manual flat nesting which only the 512-depth parser stack bounds (verifier-corrected) — pattern note | `process/infunctions.ts:178-193`; `risuChatParserHelpers.ts:114-143` |
| I28 | Iris chat-history MCP tool copies the entire transcript (spread+reverse) per call before slicing 20/100 — call-only registry, not in the normal send tool list (verifier-corrected); bounded | `mcp/risuaccess/chats.ts:65-68` |
| I29 | The CSS-Highlight editor highlighter (whole-text TreeWalker + CBS parse + 3 global regex scans + cross-editor rebuild per debounce tick) is DEAD: `disableHighlight` is true everywhere and nothing enables it — would be medium typing-lag if ever switched on; fix before reuse (sweep-verified, no separate skeptic pass) | `gui/highlight.ts:18/:112/:360`; gate `lib/UI/GUI/TextAreaInput.svelte:239/:337` |
| I30 | Dead `PngChunk.read` (sync variant of the live bounded generator) parses without the generator's bounds — delete or bound before reuse (v2-I17 class) | `pngChunk.ts:96` (dead) vs `:140` (live); sole reference commented out at `characterCards.ts:196` |

---

## Investigated And Dismissed

Adversarially refuted against current code. Listed so they are not re-opened
without new evidence.

1. **Durable submission lock wedges the chat when `attachGenerationViewer`
   throws after `register()`** — attempted re-open of v2's dismissed
   candidate #1; the dismissal was RE-AFFIRMED 3-0: no synchronous throw
   site exists between `register()` and `trackRunner()` in current code
   (attach on a dead socket does not throw there). The v2 dismissal stands.
2. **Ooba/textgen streaming WS abort-listener leak** — mechanism real in
   source, but the branch is dead on the Fastify runtime: every completion
   routes through `resolveServerCompletionRoute` → server; the client
   provider switch is unreachable.
3. **HypaV3 modal `isOrphan()` per-render transcript scan** — dead code on
   the live runtime: the only mount passes
   `readOnly = serverBackedMemoryMode`, which is unconditionally true
   (Fastify sole-platform), and `isOrphan` sits inside `{#if !readOnly}`.
4. **Stale `msgIndex` mid-stream corrupts edits/deletes** — no live path
   shifts the message array mid-stream: edit/delete handlers branch on
   `canUseServerCommands()` (always true) into fire-and-forget server
   commands with no local splice; own-echo SSE is suppressed; rollback
   restores a clone that still holds the row.
5. **Client OpenAI/Google `while(true)` tool loop spins forever** — dead on
   the live runtime (same server-route reasoning as #2); the live concern
   would be a server-side loop, which is bounded.
6. **`mcp-tool-calls` IndexedDB store grows per tool call forever** — the
   store mechanics are real (no prune, `rememberToolUsage` defaults true),
   but no live writer exists: tool-calling does not execute on the durable
   send path (server omits tools; the client `encodeToolCall` sites are
   unreachable). Extension context recorded with v3-L45.

## Verified-Clean Sweeps

Negative results worth recording (round-3 sweeps that refuted their own
target hypotheses):

- The image-ingest hostile vector is narrower than hypothesized:
  `compressImage`/`doLossyCompression` main-thread decode runs only on
  export of self-owned data; PNG card imports short-circuit; charx/JSON
  imports route images to server upload, never through canvas decode. (The
  residual live decode risk is L36's inlay path.)
- The editor highlighter Map does NOT leak (`removeHighlight` on destroy);
  highlight.js languages register once; the CBS autocomplete per-keystroke
  scan is on a never-rendered branch. The highlighter itself is dead (I29).
- `PngChunk.readGenerator` (the live import parser) is bounded by input
  size (I30 covers the dead sync variant).
- Emotion-fallback embedding does not re-embed the label set per message
  (cached in `hypaVector`); the single reused extractor leaks no
  AudioContexts.

## Relationship To Prior Workstreams

- This audit ran CONCURRENTLY with the v3 plan's execution: phases 0-3
  landed between round 1 and final verification (`4ccc15194` →
  `b355586a6`). The strand-A regression review verified every landed v3 fix
  against its target-fix spec — all correctly implemented; the one
  incomplete fix is L11 (v3-M2's persist half), and L17 documents that the
  v3-M4 fast-path widened a PRE-EXISTING double-send window rather than
  introducing one. Nothing else in the v3 wave regressed.
- The then-pending v3 rows (M6-M9, most of L1-L56, K3, K4) were owned by the
  v3 risk map now archived at
  `.archived-docs/audit-stability-and-performance-v3/active-risk-analysis.md`;
  they were treated as known items here and are NOT re-listed. Two v4
  findings sharpened scheduled v3 rows and folded into their slices: L11 →
  the v3 Phase-3 M2 row (persist-time tokens); L30/L33 → the v3 Phase-5
  projection-guard repair batch (translator-preset and MCP-handshake sites,
  plus a tree-wide `getDatabase()`-write-back sweep rather than an
  enumerated-site fix).
- Gated items were respected and none is re-opened: `v2-L12`,
  v1-L4/L7/L26/U2, and the `leftover.md` evidence gates. L14/L15/I7 are NOT
  the v2-L24 row (closed) — they are its un-swept siblings/residuals.
- The round-3 structural lesson repeats v2→v3→v4: per-file and per-modality
  finders miss whole subsystems that no assignment names. v4's equivalents
  of v3's "bridge state machine" were the translator subsystem (zero prior
  coverage, 7 findings incl. a feature-breaking guard throw) and the
  stage-4 post-generation pipeline (`runStage4` is NOT behind
  `serverOwnsPostGeneration` — two send-path finders in two audits assumed
  it was).

## Suggested Remediation Order

1. **H2** — add `content-length`/`transfer-encoding` to the proxy's
   `STRIP_RESPONSE_HEADERS` (mirror the hub set) + a real-socket gzip test.
   One-line fix for corrupted provider responses.
2. **M4** — the `-1000` sentinel guard in `chatDispatch` (+ the horde
   topK/topP twin). Restores sends for disabled-slider configs. Pair with
   the L6 decision (send biases or drop the dead assembly work).
3. **H1 + L20** — reset `loadPages` on chat-identity change; bound the
   screenshot path with the same lever.
4. **M1 + L22** — scope `getCbsCondition()` to props/untrack (ChatBody's
   own pattern); short-circuit BackgroundDom. Biggest streaming-CPU win.
5. **M5** — dedicated re-roll cap on the banCharacterset path (the
   `requestRetrys` guard is structurally unreachable from it).
6. **M3** — total-output ceiling in `emitProviderChunks` + absolute
   sliding-deadline backstop.
7. **M2 + the memory lifecycle batch** — `deleteAllMemoryForChat` in both
   delete mutates; `assertChatExists` in the embed handler; L12 (legacy
   model filter), L13 (spread → loop), L11 (persist real token counts —
   completes v3-M2), I21/I22 ride along.
8. **Translator batch** — L30 (stop writing in a getter / route through a
   trusted write; restores LLM translate), L24 (output memo keyed on the
   existing settings signature), L25 (regex memo), L26 (cache prune +
   quota handling, with L28), L27, L29.
9. **Send-path polish** — L17 (set the send gate before the awaited
   append), L18 (clean the empty bubble on pre-token cancel), L1
   (assembly-time baseRevision), L2 (continue finalText target), L3 (cancel
   423 surfacing + takeover UX).
10. **Import/lifecycle hygiene** — L14/L15 (cleanup symmetry: charx +
    bundle), L9 (atomic auth writes), L10 (gate the boot backfill on a
    cheap marker), L7 (extend the v3-L9 budget decision to lorebook/
    customscript regexes), L8 (drop the duplicate index), then the
    remaining client lows (L19, L21, L23, L31-L38) batched by area.

## How To Reproduce / Verify

- H2: `node` script — upstream replying `content-encoding: gzip` + fixed
  `content-length`; fetch through `/api/v1/proxy/fetch` over a real socket
  and compare body length to the header (app.inject cannot reproduce it).
- H1: in a >500-message chat, jump to an early bookmark; switch to another
  long chat; profile the freeze (Chat-mount + `risuChatParser` self-time).
  `loadPages` is inspectable via Svelte devtools state.
- M1: profile during any streamed reply — `risuChatParser` self-time fires
  per animation frame × visible messages; after the fix it should fire only
  for the streaming row.
- M2: enable memory on a chat, let it summarize, delete the chat;
  `SELECT COUNT(*) FROM memory_embeddings WHERE chat_id = ?` stays nonzero.
- M4: disable the BotSettings temperature slider; any OpenAI-compatible
  send 400s with `temperature: -10` in the request body.
- M5: set a banCharacterset that the model violates (e.g. ban the script
  the model replies in); watch unbounded sequential generations until
  abort.
- Server stage timings: `RISU_PROTOCOL_METRICS=1`; offline corpus cost:
  `pnpm analyze:db <input>`.
- Type/test gates after any fix: `pnpm test`, `pnpm api:test`,
  `pnpm client-thinning:audit`, and the two project-reference TypeScript
  checks (`tsc -p tsconfig.client-lib.json`;
  `tsc -p server/fastify/tsconfig.json --noEmit`).
