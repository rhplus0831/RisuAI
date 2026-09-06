# Fix plan: perf-transfer (remaining transfer findings)

This plan covers only L13, L14, L15, L16, L18, L20, L2, and L5 from
`docs/audit/perf-transfer.md` and
`docs/audit/transfer-size-reverification-2026-07-23.md`. It does not reopen a
dismissed or remediated ID, and it does not include the postponed knot-core
work. Cost estimates below are UTF-8 JSON/SSE sizes derived from the current
wire shapes. Variable text/body bytes are left as variables instead of being
guessed.

Verdict meanings:

- **FIX-CHEAP**: the value and implementation risk justify doing it now.
- **FIX-IF-METRICS**: collect opt-in production evidence first; do not build the
  protocol change unless that evidence shows material cost.
- **RECOMMEND-ACCEPT**: close the transfer finding as an intentional contract or
  an uneconomic optimization. Reopen only on new evidence or a wider protocol
  project.

## Decisions required (user input)

The table is ordered by expected value of action now, not by worst-case raw
bytes. The bold entry is this plan's recommendation; the user should approve or
decline each row before implementation.

| Rank | Finding | Recommendation | Decision requested |
|---:|---|---|---|
| 1 | L18 — unbounded bulk hydration IDs | **FIX-CHEAP** | Approve a 32-ID server cap, a 64 KiB route body cap, and sequential 32-ID client batches. |
| 2 | L14 — unbounded memory reads | **FIX-CHEAP** | Approve cursor pagination (200 rows/page) plus a bounded 1,000-row legacy compatibility ceiling. |
| 3 | L20 — repeated Realm progress context | **FIX-CHEAP** | Approve a negotiated `realmProgressDelta` capability; retain full frames for clients that do not advertise it. |
| 4 | L13 — memory event fanout | **FIX-IF-METRICS** | Approve measurement only. Keep global fanout unless real sessions show multiple SSE listeners and material avoidable bytes. |
| 5 | L15 — uncompressed general SSE | **FIX-IF-METRICS** | Approve measurement and a proxy latency experiment only. Do not enable compression from unit-test results alone. |
| 6 | L2 — replay-gap full refresh | **RECOMMEND-ACCEPT** | Accept the four-resource recovery snapshot until existing metrics prove replay gaps are frequent and costly. |
| 7 | L5 — durable `done.result` | **RECOMMEND-ACCEPT** | Accept the duplicate as the self-contained replay/reattach result. |
| 8 | L16 — command origin | **RECOMMEND-ACCEPT** | Accept the typical 68-byte origin field; replacing it requires a connection-specific own-echo protocol. |

Implement the three FIX-CHEAP rows independently. L18 has the highest
stability value; L14 and L20 do not depend on it or each other.

## Per-finding triage (L13, L14, L15, L16, L18, L20, L2, L5)

### L13 — memory events broadcast to every SSE client

**Current behavior and cost.** `createMemoryEventBus()` in
`server/fastify/src/memoryEvents.ts` calls every listener, and every authenticated
`/api/v1/events` connection subscribes in `registerEventsRoutes()`
(`server/fastify/src/routes/events.ts`). With UUID-sized chat/job IDs, the current
pending summarize event including its Hypa V3 side effect is about 389 bytes as
a complete SSE frame. A terminal frame with the maximum sanitized 1,000-byte
error is about 1.4 KiB. Thus an event of size `F` sent to `C` connected clients
costs `F * C`; the multi-client increment is `F * (C - 1)`.

The extra copies are not currently dead data. `applyServerMemoryEvent()` in
`src/ts/bootstrap.ts` applies the global `hypaV3_progress` side effect and
publishes job state. The job modal filters by chat only after receipt. Filtering
on the server therefore needs an explicit definition of client interest and a
decision about whether the global progress overlay remains global.

**Fix sketch and size.** First add one opt-in `memory_event_fanout` metric under
`RISU_PROTOCOL_METRICS` containing frame/payload bytes, listener count,
calculated delivered bytes, job kind/status, and whether a side effect exists.
The metric belongs at the bus/fanout boundary in `memoryEvents.ts`, with the
logger/callback wired from `server/fastify/src/app.ts`; cover it in
`server/fastify/__tests__/events.test.ts`. This is roughly 30–50 production LOC
plus tests and must be a no-op when the flag is off.

Only if captures contain sustained `listenerCount > 1` and memory fanout is a
material portion of SSE bytes should a separate scoped memory subscription be
designed. A plausible implementation is an authenticated
`/api/v1/memory/events?chatId=...` stream opened by the Hypa modal, while the
general command stream stops carrying job-detail events. The global progress
side effect must either stay on the general stream as a smaller event or be
explicitly changed to chat-scoped UI behavior. That is a medium protocol change
(roughly 150–250 production LOC across `routes/events.ts`, a new/readjusted
memory route, `src/ts/server/events.ts`, `memoryJobEvents.ts`, bootstrap/modal
wiring, and tests), not a cheap predicate on the existing bus.

**Risk.** A chat filter can hide terminal events from the ordering fence, make
the global progress overlay lie, or miss events while the selected chat/modal
changes. Reconnecting the main command SSE stream on every chat change would
also create replay churn, so do not use that as the shortcut.

**Verdict: FIX-IF-METRICS.** Measure fanout, but preserve the current semantics
unless multi-client cost is observed.

### L14 — memory chunk and summary reads are unbounded

**Current behavior and cost.** `registerMemoryReadRoutes()` returns the complete
arrays from `listMemoryChunks()` and `listMemorySummaries()`. A chunk row contains
three IDs, two sequence numbers, full `text`, status, and two timestamps; with
UUID-sized IDs and ISO timestamps its JSON structure is about 294 bytes before
text. A summary row is about 242 bytes before text and non-null metadata. For
`N` rows, aggregate text bytes `T`, and serialized metadata bytes `M`, the
response is therefore on the order of `T + M + (0.25 KiB * N)` plus its envelope.
There is no upper bound.

The production Hypa modal now calls `listServerMemorySummaries()` and consumes
all summaries for the selected chat. `listServerMemoryChunks()` has no production
caller. Paging will bound each query/response and peak parsing memory, but it
will not reduce total summary bytes while the UI intentionally materializes the
whole list.

**Fix sketch and size.** Add stable keyset cursor pagination to the two list
routes and repository queries, then make the client adapter drain pages. Keep a
bounded compatibility path for an old caller that omits paging rather than
silently truncating its result. Files:

- `server/fastify/src/memoryRepository.ts`: paged queries and page result types.
- `server/fastify/src/routes/memoryReads.ts`: query validation, opaque cursor
  codec, limits, and response envelope.
- `src/ts/process/request/serverMemory.ts`: page draining with abort support and
  legacy-response compatibility.
- Existing route, adapter, and Hypa reliability tests listed in the test plan.

Expected production change is roughly 180–280 LOC. The exact design is in the
FIX-CHEAP section below.

**Risk.** Paging is not a transaction-spanning snapshot. A concurrently created
row whose sort key falls before the cursor will appear on the next modal refresh,
not the current drain. Keyset paging avoids the skip/duplicate behavior of
`OFFSET` after deletions. The modal already refreshes summaries when a summarize
job completes. Invalid/reused cursors must fail with 400 rather than falling back
to an unbounded read.

**Verdict: FIX-CHEAP.** This is bounded-response stability hardening with no new
domain protocol and preserves the UI's complete-list behavior.

### L15 — the general SSE stream is uncompressed

**Current behavior and cost.** `/api/v1/events` hijacks Fastify and writes to
`reply.raw`, bypassing the global `@fastify/compress` plugin. Current complete
frame sizes are small: a writer frame with a UUID session is about 84 bytes, a
heartbeat is 13 bytes every 25 seconds, a compact command frame is about
116 bytes without origin or 184 bytes with a UUID origin, and the inspected
memory frames are about 0.4 KiB normally and at most about 1.4 KiB from the
bounded error field. Total raw cost is therefore the sum of small frames over a
long-lived connection; the actual compression ratio cannot be inferred from a
single frame because a streaming codec keeps a dictionary across frames.

**Fix sketch and size.** Add opt-in per-connection metrics in
`server/fastify/src/routes/events.ts`: raw bytes and counts by frame type,
connection lifetime, and write-overflow/close reason. Emit once on cleanup via
`emitProtocolMetric`; do not log frame bodies. Rough size is 40–70 LOC plus
tests.

If and only if captures show meaningful volume, prototype explicit gzip
negotiation from `Accept-Encoding` using `node:zlib`. The compressor must use
`Z_SYNC_FLUSH` after the initial connected frame and every logical event, set
`Content-Encoding: gzip` and `Vary: Accept-Encoding`, retain
`Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, and integrate
compressor-side buffering with the existing slow-consumer bound. Do not merely
pipe to gzip and wait for its natural buffer flush. This is roughly 150–250 LOC
including lifecycle/backpressure code and tests.

**Risk.** Compression can delay command invalidations and heartbeats if any
frame is not synchronously flushed. `Z_SYNC_FLUSH` adds bytes and CPU to tiny
frames and may make low-volume streams larger. The compressor has its own
buffer, so checking only `reply.raw.writableLength` no longer bounds memory.
Disconnect/error cleanup must close both sides exactly once. Reverse proxies can
buffer compressed chunked responses despite `X-Accel-Buffering: no`, and
`no-transform` prevents relying on a proxy to add compression. Validation must
cover direct Fastify, the Vite development proxy, and the user's real reverse
proxy; first-byte and command-frame latency matter more than ratio.

**Verdict: FIX-IF-METRICS.** Do not enable SSE compression based only on the
fact that the route bypasses the plugin.

### L16 — every originating command frame carries `origin.writerSessionId`

**Current behavior and cost.** The browser normally creates a 36-character
UUID session ID. The serialized `origin` object adds exactly 68 bytes to each
command JSON object at that length (160 bytes at the accepted 128-character
maximum). At the 1,000-event replay-history ceiling, UUID origins can therefore
account for about 68 KiB of a maximum replay. Live cost is one such increment
per originating command.

The field is consumed by `isOwnCommandEvent()` in `src/ts/bootstrap.ts`. It
prevents an SSE echo that wins the race with the command HTTP response from
being treated as a foreign invalidation and causing a redundant read. The
origin is persisted in `command_events` so reconnect replay preserves the same
decision.

**Fix sketch and size.** A real replacement would have the SSE GET identify its
writer session and negotiate a compact own-echo form. The server could retain
the persisted origin internally but serialize `own: true` only to the matching
connection and omit both fields for foreign connections. The client would check
`own`, with old clients continuing to receive `origin` unless they advertise the
new capability. Files would include `routes/events.ts`, `src/ts/server/events.ts`,
`src/ts/bootstrap.ts`, and command replay/event tests; roughly 80–140 production
LOC plus tests.

**Risk.** The server must classify both queued live events and persisted replay
against the requesting connection. Missing or stale session identity turns an
own echo into a resource refetch; falsely marking a foreign event as own leaves
the client stale. A bare removal is therefore incorrect.

**Verdict: RECOMMEND-ACCEPT.** Saving 68 bytes does not justify a second
connection-specific echo protocol.

### L18 — bulk resource endpoints accept an unbounded ID list

**Current behavior and cost.** `readBulkIds()` in
`server/fastify/src/routes/resourceReads.ts` validates and deduplicates but has
no item maximum. A JSON body of UUID-sized IDs is approximately `39 * N + 9`
bytes (about 1.23 KiB for 32 IDs and 38 KiB for 1,000), before HTTP headers. The
response is much larger: chat bulk rows contain every message and `hypaV3Data`
(but no alternates), and lorebook bulk rows contain every `globalLore` entry.
Its size is the sum of the requested full bodies and is currently whole-corpus
when `ensureAllChatsHydrated()` or `ensureAllCharacterLorebooksHydrated()` sends
all unhydrated IDs in one request.

These workflows consume all returned bytes, so the fix is peak request,
serialization, response, and parse-memory hardening; it does not reduce total
export/dataset bytes or the final live projection size.

**Fix sketch and size.** Cap both bulk routes at 32 raw IDs and 64 KiB request
bodies, then split the client work into sequential 32-ID batches that are
applied before the next fetch. Update diagnostics so one high-level bulk run
still records the total ID count while `requestsStarted` reflects actual
batches. Files:

- `server/fastify/src/routes/resourceReads.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/hydrationReads.ts` only if a clearer 413 error needs decoding
- `server/fastify/__tests__/resourceReads.test.ts`,
  `serverLoadCostHarness.test.ts`, `src/ts/server/hydrationReads.test.ts`, and
  `src/ts/server/chatMessageHydration.test.ts`

Expected production change is roughly 80–140 LOC. The exact design is below.

**Risk.** Sequential batches add round trips. They can observe different global
revisions if another command lands during a long run; the existing stale
revision and per-resource projection-epoch fences must remain active for every
batch. Strict export callers must reject on any missing/failed batch and never
continue with an apparently successful partial corpus. Do not launch every
batch concurrently, which would recreate the aggregate buffering spike.

**Verdict: FIX-CHEAP.** The server cap closes the adversarial input, while
client batching preserves all current consumers without a new endpoint.

### L20 — Realm import progress repeats phase, message, and percent

**Current behavior and cost.** Each progress frame is a complete
`{phase,message,percent}` object. The inspected “Downloading Realm character”
example is about 100 bytes including SSE framing. A percent-only frame would be
about 41 bytes, so repeated context costs about 50–65 bytes per intra-phase
frame. Total cost is approximately `F * 100 bytes` for `F` progress callbacks;
`F` grows with reported download chunks and staged/saved assets. It is one
stream per Realm import.

**Fix sketch and size.** Add a body capability alongside the existing Realm
fields:

```ts
clientCapabilities: { realmProgressDelta: true }
```

When advertised, `streamRealmImport()` remembers the last full progress value.
The first progress event carries all three fields. Later events always carry
`percent` and carry `phase` and/or `message` only when that value changed. The
client keeps the last accepted phase/message while reading one response and
reconstructs the existing `ServerRealmImportProgress` callback shape. Without
the capability, the server emits today's complete frames. A new client works
with an old server because full frames are valid input; an old client works with
a new server because it never requests deltas.

Files are `server/fastify/src/routes/realmImport.ts`,
`src/ts/server/realmImport.ts`, and their existing tests. Expected production
change is roughly 60–100 LOC.

**Risk.** Changing the server format unconditionally would make the current
client discard percent-only frames because `readProgressFrame()` requires all
three fields. Negotiation is mandatory. State must be per response, the first
frame must be full, a phase/message change must be sent before its percent is
reported, and malformed partial-first frames must not inherit state from a
previous import.

**Verdict: FIX-CHEAP.** Capability negotiation makes this a small, isolated
change even though its absolute byte value is low.

### L2 — replay-gap recovery refreshes all four root resource groups

**Current behavior and cost.** On `event_replay_unavailable`, bootstrap
reconciles database ownership and calls a full refresh. `refreshAllServerResources()`
requests settings, collections, message-free characters, and the inlay catalog
at one common revision, retrying the four-read set up to three times if revisions
do not converge. Completing the refresh also resets chat/lorebook hydration,
starts active-chat hydration, and forces the selected prompt-template owner.

There is no honest corpus-independent byte constant: the cost is the sum of
those resource bodies. Current cache negotiation bounds unchanged large values
without making them free. A singular unchanged resource returns a 64-byte hash;
an unchanged array entry returns a 75-byte `{hash}` object, and the client also
sends its 64-byte hash inventory (bounded at 8,192 hashes). Changed or uncached
entries carry their complete JSON bodies. Thus recovery is O(resource count)
on a hot cache and O(current root-resource bytes) on misses, not the former
database-bearing bootstrap.

**Fix sketch and size.** Do not implement a delta endpoint without evidence.
The existing `event_replay` metric already records unavailable recovery, and
`resource_response` records payload bytes/cache hits/misses for the four reads
under `RISU_PROTOCOL_METRICS=1`. Correlate those in a real session and use
`pnpm analyze:db <corpus> --json` for corpus shape. A fix is justified only if
unavailable replay is recurring and the correlated refresh bytes are material.

If justified, the server needs a durable changes-since contract that remains
correct after the 1,000 command events have been pruned—most likely persisted
per-resource last-changed revisions plus an endpoint that returns an atomic
changed-resource manifest. The client would request from its applied revision,
fetch only named resource groups/rows, retain a full-snapshot fallback, and
respect database-lineage replacement. This is a large schema/server/client
change (roughly 300–600 production LOC plus migration and broad recovery tests),
not a repackaging of the existing replay endpoint.

**Risk.** Missing one changed resource silently leaves stale state. Restore/
import can replace lineage and rewind revisions; concurrent reads still need a
common revision; pending optimistic projections and hydration fences must
survive the narrower apply. A delta that relies only on the already-pruned event
log cannot repair the exact case in which replay is unavailable.

**Verdict: RECOMMEND-ACCEPT.** This upholds the brief's evidence gate. The
current path is a rare correctness fallback with hash substitution, and the
necessary durable delta protocol is not cheap.

### L5 — durable streams retain the complete terminal `done.result`

**Current behavior and cost.** Inline capable streams set
`omitResultWhenStreamed` and already omit the duplicate. Durable generation
does not: if the UTF-8 completion is `B` bytes, `done.result` adds approximately
`B` plus the JSON field/escaping overhead after the same text has arrived in
token frames. The exact multiplier depends only on JSON escaping. The durable
replay buffer is capped at 512 events/2 MiB for droppable frames, but `done` is
replay-protected while token frames may be evicted. The full terminal result is
therefore the reconstruction source for a late or interrupted viewer.

**Fix sketch and size.** A safe compact protocol would need all of the
following: a capability flag, a digest and UTF-8 byte length on the live terminal
frame, client verification of its accumulated token text, and an authoritative
fallback fetch (or a split registry that sends a result-less frame live but
keeps a full result in replay). It must cover cancelled partial results,
post-generation final text, reattach after token eviction, empty/non-streaming
providers, and alternates. Likely files are `providerTransport.ts`,
`generationChat.ts`, `streamJobs.ts`, `serverChat.ts`/`serverChatEvents.ts`, and
durable generation/reattach tests; roughly 250–400 production LOC.

**Risk.** A digest detects loss but cannot reconstruct it. Omitting the result
before the fallback is proven loses output on exactly the disconnect case that
durable generation exists to handle. The raw provider result and
`postGeneration.finalText` also must not be confused.

**Verdict: RECOMMEND-ACCEPT.** Retaining one self-contained protected terminal
frame is a deliberate replay/reattach contract, not dead data.

## Concrete designs for FIX-CHEAP items

### L18 mini design — bounded bulk hydration

1. In `server/fastify/src/routes/resourceReads.ts`, add and export for tests:

   ```ts
   export const BULK_RESOURCE_MAX_IDS = 32
   export const BULK_RESOURCE_MAX_BODY_BYTES = 64 * 1024
   ```

   Apply the body limit to both POST route option objects. Replace
   `readBulkIds()`'s nullable return with a discriminated result:
   `ok(ids)`, `invalid`, or `too-many`. Check `body.ids.length` before allocating
   the output array or trimming/deduplicating values, so duplicates also count
   against the input bound. Keep the existing non-empty-string validation and
   stable de-duplication. Return 400 with the current route-specific invalid-ID
   error for `invalid`, and 413 with
   `{error: "bulk_resource_limit_exceeded", maxItems: 32}` for `too-many`.

2. In `src/ts/server/chatMessageHydration.svelte.ts`, add
   `BULK_HYDRATION_BATCH_SIZE = 32` and a simple slice helper. Keep
   `ensureAllChatsHydrated()` and `ensureAllCharacterLorebooksHydrated()` as the
   public whole-corpus contracts, but make their internal bulk helpers process
   slices sequentially. Each slice must run the existing generation, baseline
   revision, freshness/projection-epoch, missing-ID, and strict-error checks.
   Apply a successful slice before requesting the next. Do not collect all
   response bodies in an intermediate array.

3. Call `recordBulkHydration(kind, totalIds)` once per public all-resource run.
   Keep `beginHydrationRequest(kind)` around each HTTP request so diagnostics
   report `ceil(totalIds / 32)` requests and maximum concurrency one for this
   path.

4. On a non-strict failed batch, leave its IDs unhydrated so a later call retries
   them; already applied prior batches remain valid. On a strict missing/error/
   stale batch, throw and prevent the export/dataset caller from continuing.
   Preserve the existing per-ID local-projection fences, particularly for
   lorebooks edited while batching.

5. Do not add message windows to this bulk endpoint in this change. The known
   callers require complete transcripts. A streaming export is a separate
   evidence-gated redesign; the count/body caps close L18 as currently
   re-verified.

### L14 mini design — bounded memory list pages

1. Define route constants in `memoryReads.ts`:

   ```ts
   const MEMORY_READ_DEFAULT_LIMIT = 200
   const MEMORY_READ_MAX_LIMIT = 200
   const MEMORY_READ_LEGACY_MAX_ROWS = 1_000
   const MEMORY_READ_CURSOR_MAX_LENGTH = 512
   ```

2. Paged requests use `?limit=1..200&cursor=<opaque>`. `cursor` is optional only
   for the first page. Encode strict base64url JSON with version, route kind,
   chat ID, summary model filter, and the last emitted sort tuple. Bind it to
   the filters so a cursor cannot be reused for another chat/model. Reject bad,
   oversized, wrong-kind, or wrong-filter cursors with 400.

3. Preserve the current SQL ordering with keyset queries, fetching `limit + 1`
   rows:

   - chunk cursor key: `(range_start_seq, range_end_seq, created_at, id)`;
   - summary cursor key: `(orphan_sort, range_start_sort, range_end_sort,
     memory_summaries.created_at, memory_summaries.id)`, where `orphan_sort` is
     the current `CASE` result and the nullable joined sequence values are
     normalized to one documented safe-integer sentinel in both ORDER BY and
     seek predicates.

   Return the first `limit` rows and create `nextCursor` from the last returned
   row only when the extra row exists. Select/map the same public row fields as
   today; do not use `OFFSET` or `SELECT *` in the new page functions.

4. If `limit` is omitted, retain the old `{chunks}` / `{summaries}` envelope but
   query at most `MEMORY_READ_LEGACY_MAX_ROWS + 1`. Return the exact old envelope
   when it fits. If the extra row exists, return 413 with
   `{error: "memory_read_requires_pagination", maxRows: 1000}`. This avoids
   silently truncating an old client while keeping every route invocation
   bounded.

5. For a paged request return
   `{chunks, nextCursor}` or `{summaries, nextCursor}`, using `null` on the last
   page. In `serverMemory.ts`, have both public list functions request
   `limit=200`, append pages, reject a repeated cursor, honor the supplied
   `AbortSignal` on every page, and return their existing aggregate result type.
   Treat a successful old-server response with no `nextCursor` property as one
   terminal legacy page. The Hypa modal therefore needs no data-flow change.

6. Keep the existing optional summary `model` filter on every page. Do not add
   count-only or projected DTO variants without a caller; those would be a
   separate optimization rather than the bounded-read fix.

### L20 mini design — negotiated Realm progress deltas

1. Add `clientCapabilities?: { realmProgressDelta?: unknown }` to the server's
   Realm body type. Enable deltas only for literal `true`; ignore malformed or
   absent capability objects and keep complete frames.

2. The browser always includes
   `{clientCapabilities: {realmProgressDelta: true}}` in
   `importRealmCharacterFromServer()` requests, including the low-level-access
   retry.

3. Extend `streamRealmImport()` with a per-response serializer state. In delta
   mode, emit the first progress object in full; on later callbacks emit
   `{percent}`, adding `phase` when it differs and `message` when it differs.
   Update stored state after the frame is written. Terminal/error event shapes
   do not change.

4. In `readRealmImportProgressStream()`, keep `lastProgress` local to the
   response. A full progress frame replaces it. A partial frame is accepted only
   after a full frame and inherits only missing `phase`/`message`; `percent`
   remains required and clamped. Continue exposing a complete
   `ServerRealmImportProgress` to `onProgress`.

5. Do not overload `Accept: text/event-stream` as the delta signal: that header
   is already sent by clients that require today's full-frame protocol. The
   explicit body capability is what makes mixed client/server versions safe.

## Test plan

### L18 focused tests

- In `server/fastify/__tests__/resourceReads.test.ts`, prove both bulk routes
  accept exactly 32 raw IDs, reject 33 (including duplicates) with the stable
  413 body, still deduplicate within the bound, and retain auth/error behavior.
- Add a route body-limit case with a JSON body over 64 KiB and assert 413 before
  hydration work. In `serverLoadCostHarness.test.ts`, retain the zero
  whole-corpus-read assertion for every accepted batch.
- In `src/ts/server/chatMessageHydration.test.ts`, seed 65 chat stubs and 65
  lorebook stubs; assert request sizes `[32, 32, 1]`, sequential request order,
  complete application, correct diagnostics, and no single-resource fallback.
  Cover a failed middle batch, strict rejection, later retry of only unhydrated
  IDs, a generation reset, and a local lorebook edit between batches.
- In `src/ts/server/hydrationReads.test.ts`, keep response decoding coverage and
  add stable propagation of the server's 413 error if that decoder is changed.

### L14 focused tests

- Extend `server/fastify/__tests__/memoryReadRoutes.test.ts` with more than one
  page of chunks and summaries. Assert stable order, no duplicates, all rows
  reachable, model filtering across pages, `nextCursor: null` at the end, and
  page sizes never above 200.
- Reject zero/negative/non-integer/over-200 limits; malformed, oversized,
  cross-chat, cross-model, and cross-route cursors; and verify no repository
  list query runs for invalid input.
- Prove the no-query legacy envelope is unchanged at 1,000 rows and returns the
  explicit 413 at 1,001 rather than truncating.
- Extend `src/ts/process/request/tests/serverMemory.test.ts` to prove page
  accumulation, abort during a later page, error propagation, repeated-cursor
  rejection, model propagation on every page, and compatibility with an old
  one-page response that has no `nextCursor`.
- Retain `HypaV3Modal.serverReliability.test.ts` and
  `HypaV3Modal.resetRace.test.ts` coverage to prove paging does not let a stale
  refresh overwrite edits or a newly selected chat.

### L20 focused tests

- In `server/fastify/__tests__/realmImport.test.ts`, assert that a request with
  no capability has complete progress frames. With the capability, assert the
  first frame is complete, repeated phase/message frames contain percent only,
  phase transitions include changed context, percent stays monotonic, and the
  final done/error/low-level-access frames are unchanged.
- In `src/ts/server/realmImport.test.ts`, feed a full frame followed by multiple
  partial frames and assert complete reconstructed callbacks. Also cover an old
  server's all-full stream, a partial first frame (ignored/rejected without
  inherited state), independent state for a second import, and the capability
  on confirmation retries.

### Conditional measurement and compression checks

- L13 metric tests must set/unset `RISU_PROTOCOL_METRICS`, capture through the
  established protocol-metric mock pattern, and prove zero metric work/output
  when disabled. Verify one metric per emitted event, not per listener.
- L15 metric tests must cover cleanup after normal close, abort, replay-unavailable
  (no opened stream), and slow-consumer overflow. If a compression prototype is
  authorized, use a real listening Fastify server and streaming reader to prove
  the connected frame, command frame, and heartbeat are observable immediately
  under identity and gzip; verify `Vary`/`Content-Encoding`, decompressed SSE
  equivalence, backpressure cleanup, and no timer/listener leak.
- Test the L15 prototype through `pnpm dev:agent`'s Vite proxy and the actual
  deployment reverse proxy with a no-buffer streaming client. Record time to
  first connected frame and time from a command commit to its frame. Reject the
  change if either path buffers until another frame/end-of-stream, regardless of
  byte ratio.
- For L2, capture existing `event_replay` and the four following
  `resource_response` metrics under `RISU_PROTOCOL_METRICS=1`; no code change is
  authorized by this plan's default verdict.

### Commands for an implementation session

Run focused lanes first:

```sh
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/resourceReads.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/memoryReadRoutes.test.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/events.test.ts

pnpm exec vitest run \
  src/ts/server/hydrationReads.test.ts \
  src/ts/server/chatMessageHydration.test.ts \
  src/ts/process/request/tests/serverMemory.test.ts \
  src/lib/Others/HypaV3Modal.serverReliability.test.ts \
  src/lib/Others/HypaV3Modal.resetRace.test.ts \
  src/ts/server/realmImport.test.ts

pnpm check:server
pnpm check
```

Then run `pnpm test:server` and `pnpm test:frontend`. Run
`pnpm smoke:fastify-browser` for an authorized L15 transport change or any
change that affects the long-lived general event stream. Finish with
`pnpm format:check`; do not use the postponed knot-core work to address test
runtime.
