# V4 Audit — Informational Findings (Detail)

Full-detail companion to `../audit-stability-and-performance-v4.md` (I1-I30):
the verified inventory that sits below the low bar after calibration — bounded
cost, narrow or dead trigger, or design-note status. The canonical IDs,
titles, and severities live in the main doc; this file expands the corrected
mechanism and the calibration rationale for each. Line anchors were captured
at the audit window (round-1 finders at `4ccc15194`, verification re-checked
between `18cc05099` and `b355586a6`); symbol names are the durable anchors.

---

## I1 — No process-level `unhandledRejection`/`uncaughtException` handler

- Finder: `floating-promises`, claimed medium · Verification: confirmed,
  calibrated medium→info (liveness info / mechanism info / severity low) ·
  Novelty: extension of v3-M9 (process-handler gap class)
- Location: `server/fastify/src/index.ts:13` (only `main().catch()`);
  `server/fastify/src/app.ts:86` (`buildApp` registers no `process.on`);
  tree-wide `rg 'process\.(on|once)\('` finds only the dev flag tool
  (`util/api-flag-dev.ts` SIGINT/SIGTERM) and a test fixture string.

**What / why info.** Node 24's default `unhandledRejection` mode is `throw`,
and production runs bare `tsx server/fastify/src/index.ts` (Dockerfile CMD
`pnpm api:start`) with no `--unhandled-rejections`/`NODE_OPTIONS` override, so
a stray rejection would terminate the single-user server (empirically: a bare
`Promise.reject` exits 1 on v24.15.0; an unref'd `setInterval` callback
rejection still exits 1). The mechanism is real, but the adversarial liveness
trace found **no** concrete escaped-rejection path: every detached/timer/
broadcast async site is defended — `trackRunner` wraps the detached runner in
`.catch`, `runStreamJob`/`writeBundleZipStream` are fully try/catch'd,
`MemoryWorker.schedule` chains `.catch`, command/memory event sinks swallow
per-subscriber throws, the GC/asset-GC/finalization-retry interval bodies are
guarded, and writes to a destroyed response socket return `false` without
throwing. A missing backstop with no live trigger is info; the blast radius is
real (in-memory-only `generationJobs` would lose every in-flight generation),
which is why two lenses still rated it info and one low rather than dismissing.

**If touched.** Ride v3-M9: register `process.on('unhandledRejection')` /
`uncaughtException` (log-and-continue for a single-user host) in `index.ts`
alongside the SIGTERM/SIGINT graceful-shutdown handler v3-M9 already schedules.

## I2 — `gcTimer` interval callback lacks the try/catch its siblings have

- Finder: `floating-promises`, claimed info · Verification: confirmed, info
  (lone skeptic) · Novelty: new
- Location: `server/fastify/src/app.ts:177-181` (`gcTimer` →
  `streamJobRegistry.tickGc()` + `generationJobRegistry.tickGc()`, no guard)
  vs `:190-196` (`assetGcTimer`) and `:260-287` (finalization-retry sweep),
  both wrapped in try/catch + `app.log.error`.

**What / why info.** Of the three app-level intervals, only the GC timer's
callback is unguarded. The skeptic confirmed there is **no** realistic throw
path inside either `tickGc` in current code: both do Map iteration, `Date.now`,
`AbortController.abort()` (empirically non-throwing, no user abort-listener
attached), and `cleanup()` whose `client.close()` is itself try/catch'd;
delete-during-iteration is safe in JS. So the latent crash only materializes if
a future change introduces a throwing op into `tickGc` — and only because I1's
missing process backstop would turn that timer-callback throw into a process
crash. Pure hardening-consistency gap, no user-facing trigger.

**If touched.** Wrap the `gcTimer` body in try/catch + `app.log.error`,
mirroring the two adjacent timers.

## I3 — Finalization-retry stale replay (no cap + stale re-append)

- Finder: `error-retry-storms` (C44) + `durable-job-state-machine` (C17) +
  `concurrency-server` (C3), merged cluster, claimed low · Verification:
  confirmed, info (lone skeptic) · Novelty: extension of v3-I4
- Location: `server/fastify/src/routes/generationChat.ts:1327-1424`
  (`queueAndPersistGenerationFinalization` / `retryQueuedGenerationFinalizations`,
  terminal classifier `isTerminalGenerationFinalizationError` ~`:1293`);
  driven by `app.ts:260` `runGenerationFinalizationRetrySweep` (5 s sweep,
  ≤25/sweep); replay write `messageStore.ts` `writeGenerationChatMessage`
  (append-by-`generationId` for a send).

**What / why info.** The pure-perf half (C44) is verbatim v3-I4: only
`EntityNotFoundError`/`ValidationError` are terminal, there is no attempt cap
or backoff, and the prune deletes only `status='terminal'`, so a stuck-pending
row re-attempts ~5/s forever. The new correctness claims (C17 out-of-order
re-append, C3 resurrection of a since-deleted row) are real **as code** but the
skeptic refuted every concrete trigger: there is exactly one synchronous
`DatabaseSync` handle with no concurrent writer, so `SQLITE_BUSY` from
contention cannot occur; `baseRevision` (`getSchemaState`) is read synchronously
immediately before `BEGIN IMMEDIATE` with no await between, so
`RevisionMismatch` is impossible here; and the production `InMemoryCommandEventSink.emit`
swallows all listener errors (the test's injected post-COMMIT throw cannot
occur live). The only way to leave a pending row with no committed message row
is a pre-COMMIT non-terminal throw — i.e. a genuine disk I/O error
(ENOSPC/SQLITE_IOERR), a catastrophic environment failure, not a routine
condition. So the correctness consequence stays inventory-only.

**If touched.** Folds into v3-I4: a `failure_count`-based attempt cap (the
column exists) + `next_run_at` backoff, prune long-stuck `pending` rows, and
verify the generation is still the live tail/target before re-applying.

## I4 — Redundant single-column memory-table indexes

- Finder: `sqlite-schema`, claimed low · Verification: confirmed, calibrated
  low→info (lone skeptic) · Novelty: new
- Location: `server/fastify/src/db.ts:293-339` —
  `idx_memory_{chunks,summaries,embeddings}_chat_id` alongside their
  leading-`chat_id` composites (`chat_status`/`chat_range`, `chat_model`,
  `chat_model`).

**What / why info.** Each memory table carries a single-column `(chat_id)`
index whose leading-column prefix is already served by an adjacent composite.
EXPLAIN QUERY PLAN against the real schema on `node:sqlite` (the production
engine) confirmed: with the single-column indexes dropped, every pure
`chat_id` lookup falls back to the composite leading-column prefix with an
identical `SEARCH ... USING INDEX (chat_id=?)` plan — no scan, no regression.
The three single-column indexes give zero read benefit and only add a
redundant b-tree to maintain per INSERT. Those inserts happen only in the
background memory worker (chunk planning, summarize, embed) and legacy import —
off the chat-send hot path — so the cost is bounded, background-only write-amp,
below the low bar. (`idx_memory_jobs_chat_id` is out of scope: the read-route
`listMemoryJobs({chatId})` may legitimately use it.)

**If touched.** Drop the three single-column `(chat_id)` indexes in
`createMemoryTables`.

## I5 — No prepared-statement caching

- Finder: `sqlite-schema`, claimed low · Verification: confirmed, calibrated
  low→info (lone skeptic) · Novelty: new
- Location: all `db.prepare(` sites — `repository.ts`/`messageStore.ts`/
  `memoryRepository.ts` (engine: `node:sqlite` `DatabaseSync`).

**What / why info.** `DatabaseSync.prepare()` does not cache (verified
`db.prepare(sql) !== db.prepare(sql)`), and every helper prepares inline per
call. A `loadPersisted` recompiles 14 statements; a targeted message command
~10-11. But the per-prepare cost is ~3.8 µs on Node 24.15, so a whole command
pays ~40-53 µs of compilation — dwarfed ~10x by the `JSON.parse` of the ~15 KB
settings blob on the same call, fired on user-action frequency (not a frame
loop), and the prepare count is a fixed constant that does not scale with
corpus/transcript/session. (The finder's "~60-150 µs" estimate is high by
~2-3x; same order of magnitude.) Real and trivially removable, but below the
low bar.

**If touched.** A module-level `WeakMap<DatabaseSync, Map<string, StatementSync>>`
keyed by SQL text (net-new code — the in-repo `PreparedScript` WeakMap memo is
client-side compiled-RegExp caching, an analogy only).

## I6 — `idx_chats_character_id` forces a temp b-tree sort

- Finder: `sqlite-schema`, claimed low · Verification: confirmed, calibrated
  low→info (lone skeptic) · Novelty: new
- Location: `server/fastify/src/repository.ts:264` (`CREATE INDEX
  idx_chats_character_id ON chats (character_id)`); consumers
  `loadSingleCharacterStubRow` ~`:1036`, `loadPersistedForChatMutation`
  ~`:1217` (`WHERE character_id=? ORDER BY position`), `loadCharactersFromSqlite`
  ~`:306` (`ORDER BY character_id, position`).

**What / why info.** The chats index is `character_id` only, so the
`ORDER BY position` is not satisfied by the index. EXPLAIN QUERY PLAN — run
against the real `node:sqlite` engine after the verifier corrected the finder's
`better-sqlite3` citation — shows both per-character reads resolve to
`SEARCH chats USING INDEX idx_chats_character_id` plus `USE TEMP B-TREE FOR
ORDER BY`, and the full-corpus read to a `LAST TERM` temp sort. The per-character
read fires on routine chat/message/scriptstate command mutations and on
character projection refreshes, but it sorts one character's chats (a handful
to tens of sessions; nothing creates unbounded chats per character), so the
sub-microsecond sort is dwarfed by the per-row `JSON.parse(data_json)`. Trivial
at single-user corpus sizes.

**If touched.** Make the index composite `(character_id, position)` — the
per-character reads become an ordered index scan with no temp b-tree, and the
full-corpus sort collapses or is eliminated. One-line schema change.

## I7 — Realm JSON-card import: asset persist and char append in two txns

- Finder: `integrity-crash-windows`, claimed low · Verification: confirmed,
  calibrated low→info (lone skeptic) · Novelty: extension of v2-L24
- Location: `server/fastify/src/routes/realmImport.ts:325-356`
  (`importRealmJsonCard`: `persistStagedFetchedAssets` then
  `appendRealmCharacter`); charx twin `:531-608`.

**What / why info.** Asset persistence (`addAssets`/`saveStagedCharxAssets`)
opens its own `BEGIN IMMEDIATE`, inserts metadata, bumps the revision, and
COMMITs; the referencing character is appended in a separate
`applyTargetedCommandMutation` transaction. A process crash between the two
COMMITs strands committed asset rows + content-addressed files with no
character. But this is precisely the residual the **v2-L24 slice deliberately
chose** — its doc
(`docs/archive/audit-stability-and-performance-v2/phases/slices/phase-8-server-bounds/realm-json-asset-batch-cleanup.md:34-38`)
explicitly kept compensating cleanup (delete-on-append-failure, still present
as `cleanupCreatedAssetResults`) rather than wrapping remote fetches + append
in one long transaction, and named the crash residual as "cleanup left to asset
GC's 60-min grace." The default-on asset GC (15-min sweep, 60-min mtime grace)
reclaims the orphans, so the leak is self-healing. Narrow + bounded +
self-healing + deliberately accepted = info.

**If touched.** Acceptable as-is given the GC backstop; if tightened, defer the
asset-metadata INSERT + revision bump into the character-append transaction.

## I8 — Import wipes the memory tables (auto-rebuilt, not lost)

- Finder: `integrity-crash-windows`, claimed low · Verification: confirmed,
  permanent-loss claim REFUTED, info (lone skeptic) · Novelty: extension of
  v3-M2
- Location: `server/fastify/src/memoryLegacyImport.ts:78-89`
  (`replaceLegacyHypaV3MemoryRowsInTransaction`: unconditional `DELETE FROM
  memory_*` then backfill from `hypaV3Data.summaries` only, `tokens:0`);
  `routes/save.ts:419-427` (wired as `applyImport`'s `beforeRevision` hook for
  both `/import/risusave` and `/import/bundle`).

**What / why info.** Every risusave/bundle import unconditionally deletes all
four memory tables and re-derives only from each chat's legacy
`hypaV3Data.summaries`; the export snapshot carries no SQLite memory tables, so
server-built embeddings are discarded. The finder claimed permanent loss with
no surviving summaries — **both refuted** for the Fastify runtime: the modern
server pipeline writes summaries/chunks/embeddings only to the SQLite tables
and never back to `hypaV3Data` (`chat.hypaV3Data` is empty/undefined in
server-backed mode, proven by `buildMemoryWindow.test.ts:257`), so import is a
total memory wipe that re-creates nothing — **and** the next memory-enabled send
auto-rebuilds from scratch: `memoryPlanner.ts determineStartIndex` returns 0
with no summaries, re-planning the whole transcript and cascading to embed jobs.
The only true cost is the paid re-summarize/re-embed calls + a transient empty-
memory window; no permanent loss. The operation is atomic inside the import
transaction (no crash window). The `tokens:0` reset overlaps v3-M2; the
wipe-on-import is the new facet.

**If touched.** Round-trip the SQLite memory tables through export/import (reuse
the `SQLITE_BACKUP_TABLES` list), or gate the unconditional DELETE so it only
runs when the import carries legacy summaries.

## I9 — `TaskRateLimiter` redundant retry timers

- Finder: `timers-inventory`, claimed low · Verification: confirmed, calibrated
  low→info (lone skeptic) · Novelty: new
- Location: `src/ts/process/memory/taskRateLimiter.ts:133` (rate-limit branch
  arms one `setTimeout(processNextFromQueue)` per over-limit task), `:59`/`:66`
  (`executeTask`/`executeBatch` fan-out).

**What / why info.** `executeBatch` fans out N tasks via `Promise.all`; each
calls `processNextFromQueue` once, so N tasks over `tasksPerMinute` (default 20)
each arm a retry timer off the same `Math.min(...timestamps)` and fire in the
same tick, persisting a redundant-timer set across windows (the concurrency
branch correctly arms none, relying on the `.finally()` requeue). Self-bounded,
no growth, no correctness bug. The decisive point is liveness: the **consuming
path is DEAD on the live runtime** — `resolveServerPromptAssembly` provably
returns only `'server'` or `'unsupported'`, never `'local'` (explicit code
comments), and the reattach path sets `assembledByServer=true` before the
`!assembledByServer` guard, so `assembleLocalSendChatPrompt` →
`buildMemoryWindow` → `hypaMemoryV3` → `TaskRateLimiter` is unreachable on every
live send; the server memory worker uses no `TaskRateLimiter`.

**If touched.** Gate the rate-limit `setTimeout` behind a single in-flight
retry handle. Only worth doing if the client memory assembly path is ever
re-enabled.

## I10 — A plain send pays 2 serial RTTs (not redundant persistence)

- Finder: `client-network-waterfall`, claimed low · Verification: confirmed,
  redundancy premise REFUTED, info (lone skeptic) · Novelty: new
- Location: `src/lib/ChatScreens/DefaultChatScreen.svelte:261`
  (`await appendCurrentChatUserMessageForSend`) → `:272` (`await sendChatMain`
  → POST `/generate/chat`); server reconcile
  `server/fastify/src/prompt/assemble.ts` `appendUserMessageRow`.

**What / why info.** The submit handler fully awaits the durable append command
(one RTT) and only then awaits the `/generate/chat` POST — A-awaits-B, two
serial client→server RTTs (plus two uncached ES256 JWT mints) before any
provider token. The finder framed this as redundant double-persistence with a
fire-and-forget fix; **both wrong**. For a plain send the server does **not**
persist the user message at all: `persistAssemblyMutations` only writes when
`submitTranscriptChanged` (input-trigger/editinput), and the route comment
states "Plain sends leave message persistence to the browser." The durable
append IS the sole system of record, and `/generate/chat` genuinely depends on
it being persisted first (it loads the persisted transcript and dedups the
trailing user row) — so they cannot overlap safely; the proposed fix would lose
the user message in the common case. The residual is exactly one extra
loopback/LAN RTT + one JWT mint per send, fixed cost, imperceptible.

**If touched.** A future single-RTT send+message route is possible (sequencing
is contractual, not redundant); pair with an auth-token cache so the remaining
RTTs do not each re-sign.

## I11 — Serial per-foreign-event projection sync on SSE replay

- Finder: `client-network-waterfall`, claimed low · Verification: confirmed,
  calibrated low→info (lone skeptic) · Novelty: new
- Location: `src/ts/bootstrap.ts:329-355` (`handleServerCommandEvent` →
  serial `enqueueServerProjectionSync` → `processServerCommandEvent` →
  `fetchServerProjectionResource`).

**What / why info.** On SSE reconnect with replay available, the server replays
each buffered command event as a distinct frame; the client funnels them
through a strictly serial chain and, for each contiguous **foreign** event,
issues one `fetchServerProjectionResource` GET (+ one uncached ES256 sign) with
no same-resource coalescing. But own-echo events short-circuit with zero fetch
(`isOwnCommandEvent`; each tab mints its own module-scoped writer session id),
so in the dominant single-tab case every replayed event costs nothing. The
fetch storm only fires when a **second concurrent writer session** wrote while
this tab's SSE was disconnected; the foreign count is bounded by the event
history window (`COMMAND_EVENT_HISTORY_LIMIT=1000`, beyond which one full
bootstrap runs instead). Added resume latency only, not a hot path.

**If touched.** Coalesce a run of consecutive foreign events targeting the same
resource/id into one trailing fetch at the highest revision.

## I12 — `buildMemoryWindow` splice-in-loop

- Finder: `complexity-server`, claimed low · Verification: confirmed,
  calibrated low→info (lone skeptic) · Novelty: new
- Location: `server/fastify/src/prompt/memory.ts:58-64` (the
  `while (currentTokens > maxContextTokens) { … chats.splice(0,1) }` trim loop).

**What / why info.** The non-Hypa budget trim drops the oldest row one
`splice(0,1)` at a time — O(K·N) array churn — and fires per send on any chat
whose assembled history exceeds `db.maxContext` (default 4000), independent of
the memory subsystem. But the verifier measured the splice churn at **0.03-0.19%
of the loop's own cost**: each iteration also calls `tokenizeChat`, a real
tiktoken `.encode()` (~163 µs/row), which dominates the splice by ~285x (at
N=1000/K=965: ~0.115 ms splice vs ~197 ms loop). The finder's own fix keeps the
tokenization, so it removes ~0.1% of the cost; V8 also optimizes `splice(0,1)`
below pure memmove. Negligible.

**If touched.** Fold into any L11 slice: compute the drop count by scanning
oldest-to-newest, then a single `chats.splice(0, dropCount)`.

## I13 — V2 trigger array ops JSON round-trip per element

- Finder: `complexity-server`, claimed low · Verification: confirmed,
  calibrated low→info (lone skeptic) · Novelty: extension of v3-L9
- Location: `server/fastify/src/prompt/triggerDataEffects.ts:320-386`
  (`v2PushArrayVar`/`v2Unshift`/`v2Splice`/… each `JSON.parse` then
  `JSON.stringify` the whole array var per element op).

**What / why info.** Vars are stored as plain strings in
`chat.scriptstate['$'+key]`, so building an N-element array element-by-element
in a trigger loop is genuine O(N²) JSON work, reachable via imported card
triggers (a third-party vector) on the live server input/output/start paths.
But each op is charged exactly one effect step, and the realistic
"build-in-a-`v2Loop`" vector hits the lag guard (`sleep(1)` every 100 loop-back
iterations), which chunks the synchronous run: the verifier measured the max
**contiguous** block at only ~66-363 ms (not seconds) for N up to 5000, and the
loop is capped at `min(maxLoopBackEdges=10000, 3000 ms wall-clock)`. A continuous
multi-hundred-ms-to-3 s block only occurs in the unusual FLAT-effect-list case
(thousands of literal pushes, no `v2Loop`, no lag-guard yield), capped by
`maxEffectSteps=100000`. Bounded one-time send-latency stall while a specific
card is active; no hang, no data loss. Same uncovered-per-op-cost class as
v3-L9 (its bounded/benign end).

**If touched.** Parity port — optionally charge array-op cost proportional to
current array length against `budget.effectSteps`; a deeper fix backs array vars
with a parsed cache keyed on the var string identity.

## I14 — `applyMessageMutation` splice-vs-replace mismatch

- Finder: `hostile-client-send-render`, claimed low · Verification: confirmed,
  all claimed live triggers REFUTED, info (lone skeptic) · Novelty: new
- Location: `src/ts/process/request/serverMessagePatch.ts:20-37`
  (`applyMessageMutation`); server emitter `assemble.ts` `appendUserMessageRow`
  (`type:'append'` with index).

**What / why info.** For a non-`replace_all` upsert whose content differs from
the row at that index, the client does `chat.message.splice(index, 0, next)` —
an INSERT that shifts following rows — instead of replacing. The sole live
`type:'append'` emitter is the server's index-keyed `appendUserMessageRow`
(both sites `source:'user_message'`), for which splice-insert is never the
correct primitive — so the finding correctly answers that question. But every
claimed live trigger is refuted: a failed append aborts before
`sendChatMain`; the optimistic and server user rows are byte-identical by
construction (both `name:null`, server preserves `.data` verbatim), so
`sameMessageContent` is always true → replace-at-index; there is no client SSE
path that rewrites the active transcript mid-send; and any trigger/editinput
reshape emits a trailing `replace_all` that overwrites the whole array anyway.
Latent defensive mismatch, self-healing on refresh.

**If touched.** For an index-keyed upsert whose content differs, match by
`chatId` first (mirroring `findGeneratedAssistantMessage`) then replace-at-
index rather than splice-insert.

## I15 — Stuck HypaV3 'summarizing…' overlay

- Finder: `memory-subsystem-hostile`, claimed low · Verification: confirmed,
  calibrated low→info (lone skeptic) · Novelty: new
- Location: `server/fastify/src/routes/events.ts:156-161` (memory events armed
  live-only, no replay buffer); client sole writer
  `serverMemory.ts` `applyServerHypaV3Progress`; overlay
  `HypaV3Progress.svelte:12/:31` + `App.svelte:292`.

**What / why info.** Unlike command events, memory events have no server replay
buffer and are armed fresh per connect, and `applyServerHypaV3Progress` (fed
only by live SSE memory frames) is the sole writer of `hypaV3ProgressStore.open`
in the live runtime; the polling backstop never writes it. So a terminal
(`open:false`) frame lost during an SSE reconnect window leaves the spinner up.
But it is purely cosmetic: both states use `pointer-events-none` on the wrapper,
so it is a small fixed top-right badge that intercepts no input. It is also
self-healing — because the store is a single global (not per-job), the next
completing memory job for any chat emits `open:false` and clears it; server
restart re-queues abandoned running jobs which re-emit terminal events. The
genuinely non-self-healing case is a transient SSE-drop-mid-job with no further
memory work, on an opt-in HypaV3 setup.

**If touched.** Reconcile the store from the polling controller (set
`open:false` when zero active jobs), or give memory events a last-state snapshot
on reconnect.

## I16 — Bulk command/asset arrays: per-element work

- Finder: `input-bounds-server`, claimed low · Verification: confirmed,
  calibrated low→info (lone skeptic) · Novelty: extension of v3-I2
- Location: `server/fastify/src/routes/commands.ts:3653-3671`
  (`PUT /chats/:chatId/messages` → per-message `activeMessageIdExistsOutsideChat`);
  `routes/assets.ts` (`POST /assets/bulk` → per-element decode + `addAssets`).

**What / why info.** Array routes size their work by element count, not just
total bytes, with only the 100 MB body limit as a ceiling — a genuinely new
write-side surface vs v3-I2's read-side bulk endpoints. But two corrections drop
it to info: the per-message `activeMessageIdExistsOutsideChat` is an **indexed
point lookup** (`idx_messages_uid`, `messageStore.ts:230`), microseconds each,
so the total is O(transcript length) — the same order as the
`replaceActiveChatMessages` diff/write it already performs; and the bulk-assets
vector is neutralized by the only live caller (`uploadServerAssetsBatch`)
self-chunking at 32 items / 32 MiB with a 413-split fallback. The live
message-replace callers always pass a single chat's live transcript, so the
unbounded-array shape only manifests for a hand-crafted non-client request —
self-inflicted under single-user calibration.

**If touched.** Add an explicit element-count ceiling to the array validators
(`readReplacementMessages`, `readBulkAssets`, the lorebook/prompt-array readers)
— reject past a sane maximum, mirroring the byte caps elsewhere.

## I17 — `TextAreaInput` popup-editor poll interval leak

- Finder: `timers-inventory`, claimed info · Verification: confirmed, info
  (lone skeptic) · Novelty: new
- Location: `src/lib/UI/GUI/TextAreaInput.svelte:394` (`oncontextmenu`
  `setInterval(…,100)` cleared only inside its own callback), `:377-379`
  (`onkeydown` `while (popUpEditorStore.open) await sleep(100)` loop); `onDestroy`
  at `:229-235` clears only `highlightTimer`.

**What / why info.** When the popup editor opens, a 100 ms poll is armed and the
component's `onDestroy` does not clear it, so unmounting the `TextAreaInput`
while the editor is still open leaks the poll until the user closes the editor,
then fires a stale `value = …; onInput()` write against a torn-down closure. The
verifier corrected the trigger: the handler is `oncontextmenu`, so it fires on
**desktop right-click too** (the more likely path on this deployment), not just
mobile long-press — but it is double-gated behind the opt-in
`longPressToPopupEditor` setting (default false) plus the atypical
unmount-while-open sequence, the stale write touches no DOM and does not throw,
and there is no accumulation. Self-resolving on the next poll when the editor
closes.

**If touched.** Track `checkInterval` in a component-scoped variable and clear
it in the existing `onDestroy`; break the `onkeydown` loop on an unmount flag.

## I18 — No read-side SSE/WS liveness probing

- Finder: `sse-ws-state-machine`, claimed info · Verification: confirmed,
  central premise corrected, info (lone skeptic) · Novelty: new
- Location: `server/fastify/src/routes/events.ts:148-165` (write-only
  `: heartbeat`), `generationChat.ts:1117-1133` (viewer heartbeat),
  `streamJobs.ts:211-216` (WS `{type:'ping'}`); client `src/ts/server/events.ts`
  + `sseParse.ts`.

**What / why info.** Every keepalive in this strand is server→client write only;
none reads a client response, the WS never sends a protocol ping frame or tracks
pong/`terminate()`, and all teardown depends on the peer emitting close. The
verifier corrected the finder's premise: the client does **not** use a browser
`EventSource` — it uses `fetch()` + a manual SSE parse (`iterateSseEvents`),
which has no auto-reconnect and no read-side idle/stall watchdog (`reader.read()`
blocks until data/done/error/abort). So on a truly half-open peer (laptop sleep,
Wi-Fi drop, NAT eviction — no FIN/RST), the read hangs silently and recovery is
driven by the OS TCP retransmit timeout (~15 min), not by any application probe;
the client's `onError`/`onClose` reconnect only fires once that timeout errors
the stream. Cost is bounded (one FD + one unref'd interval per stalled
connection, the runner also reclaimed at the 600 s job `deadlineAt`); the 2 MB
`writeBoundedRaw` cap effectively never governs for a heartbeat-only stream
(~150k frames to fill it). Infrequent on a single-user LAN host.

**If touched.** Switch the WS app `ping` to a protocol `socket.ping()` + an
`isAlive`/`terminate()` sweep; optionally `setKeepAlive(true,…)` on the hijacked
SSE socket. Not required for correctness on a single-user host.

## I19 — Asset GET ignores HTTP Range

- Finder: `disk-file-lifecycle`, claimed info · Verification: confirmed, info
  (lone skeptic) · Novelty: new
- Location: `server/fastify/src/routes/assets.ts:229-251` (GET
  `/api/v1/assets/:id` → `reply.send(fs.createReadStream(file))`, only
  content-length/immutable cache headers, no `accept-ranges`/206).

**What / why info.** The single-asset GET streams the whole file with a fixed
200 and never honors a `Range:` header; stored assets include audio/video types
reachable via `{{asset::}}`/`{{video::}}`/`{{audio::}}` CBS (an imported-content
vector). The verifier narrowed the impact: it is **not** a per-seek full
re-download — the sha256-keyed immutable cache serves fully-fetched assets from
disk cache on later loads, backward seeks and forward seeks within the buffered
region work, and only forward seeks past the buffered region degrade (the browser
continues the sequential download). The concrete real failure is WebKit/iOS
potentially refusing to start playback without advertised byte-range support.
Single-user LAN/loopback (bandwidth cheap), no leak (Fastify destroys the read
stream on reply close; the fd auto-closes on stream end), no crash or unbounded
cost.

**If touched.** Parse `Range` for asset GETs and emit 206 + `content-range` +
`accept-ranges` via `fs.createReadStream(file, { start, end })`.

## I20 — `longpress` unmount orphan

- Finder: `client-listener-leaks`, claimed info · Verification: confirmed, info
  (lone skeptic) · Novelty: new
- Location: `src/ts/gui/longtouch.ts:1-26` — `handleMouseDown` adds a window
  `mousemove` (`:5`) and a 500 ms `setTimeout` (`:6`); `destroy()` (`:21-24`)
  removes only the node's `mousedown`/`mouseup`.

**What / why info.** If the host node unmounts during the 500 ms press window
before any mouse move/release, `destroy()` leaves the window `mousemove`
listener and the pending timeout alive; the timeout then fires `callback` once
against a detached closure (for the live `Chat.svelte` Trash-button consumer,
`rm(e, true)` over stale captured indices). But the orphaned `mousemove`
**self-removes on the very next mouse movement anywhere on the window**, so it
is not even a persistent leak; the timeout is a one-shot stale callback, no
accumulation, no scaling. The precondition is a ~500 ms self-inflicted race the
lone self-host user can barely produce.

**If touched.** In `destroy()`, also `clearTimeout(timeoutPtr)` and
`removeEventListener('mousemove', handleMoveBeforeLong)`, matching the existing
inline cleanup.

## I21 — Memory 'important' category dead server-side

- Finder: `memory-subsystem-hostile`, claimed info · Verification: confirmed,
  info (lone skeptic) · Novelty: extension of v3-M2
- Location: `server/fastify/src/memoryBudgetAllocator.ts:336-338`
  (`defaultIsImportantSummary` checks `metadata.isImportant===true`);
  `memorySummarizeJobHandler.ts:401-410` (`persistSummary` writes no
  `isImportant`); `prompt/assemble.ts:1323-1337` (selection omits
  `isImportantSummary`); UI `HypaV3Modal/modal-summary-item.svelte:142-144`.

**What / why info.** The allocator selects 'important' summaries first, but no
summary in the live selection ever carries `metadata.isImportant`, so the
category and its budget-priority branch are dead. The verifier resolved the
persistence question: the UI `toggleImportant()` IS settable and persisted — but
into `chat.hypaV3Data` (round-tripped as the chat-row `n` column), a structure
**different** from the server SQLite `memory_summaries` table that selection
reads. Job-created summaries write no `isImportant`, and the only bridge that
copies the UI flag into the table (the legacy backfill) writes those rows under
model `'legacy-hypav3'`, which never matches the active `summarizationModel`
(default `'subModel'`), so they are excluded. Dead only when opt-in HypaV3
server memory is enabled; no crash/cost — a silently-disabled designed feature,
same disposition class as v3-M2.

**If touched.** Thread `isImportant` into `persistSummary` metadata and pass
`isImportantSummary` through `selectPromptMemory`, or document the category as
intentionally inert.

## I22 — Memory token costing undercount

- Finder: `memory-subsystem-hostile`, claimed info · Verification: confirmed,
  magnitude corrected, info (lone skeptic) · Novelty: extension of v3-M2
- Location: `server/fastify/src/prompt/assemble.ts:1364` (`tokens =
  tokenize(summary.text)`); injection cost is `tokenizeChat`
  (`prompt/tokens.ts:74-91`); SPA reference `hypav3.ts:464-467/505-508`.

**What / why info.** `createPromptMemorySummaryTokenCost` estimates a summary's
cost as bare `tokenize(summary.text)` (and the fallback path is always taken
because summaries persist `tokens:0`), but the summary is injected as a
`role:'system'` row whose real assembly cost is `tokenizeChat` = content + per-
message overhead. The verifier corrected the magnitude with tiktoken: the live
overhead is 3 (non-gpt) / 5 (gpt), and the SPA also charges a `'\n\n'` separator
(1 token), so the true per-row undercount is **4 (non-gpt) / 6 (gpt) tokens**,
not the finder's flat "~4". Total memory-budget overshoot ≈ N × 4-6 for N
selected summaries. Opt-in, bounded, no crash — the SPA re-tokenizes the final
prompt, so the only effect is a slightly looser memory reservation. (The
verifier noted two larger adjacent parity gaps in the same just-landed M2 fix —
no empty-memory subtraction, and per-row vs single-XML-block wrapping — worth
folding into the same slice.)

**If touched.** Estimate summary cost with the same `tokenizeChat` (+ overhead/
separator) used to assemble the row, reusing the already-loaded tokenizer
options.

## I23 — WS `upstream_headers` stale framing headers

- Finder: `proxy-hub-streamjobs`, claimed info · Verification: confirmed,
  benign verified, info (lone skeptic) · Novelty: new
- Location: `server/fastify/src/streamJobs.ts:470-474` (`pushEvent
  upstream_headers` with `filterResponseHeaders(upstream.headers)`); client
  `globalApi.svelte.ts:1173-1176/:1241-1244` (`new Response(pipedReadable,
  {headers})`).

**What / why info.** `filterResponseHeaders` strips `content-encoding` but not
`content-length` — and the verifier confirmed `transfer-encoding` **also**
survives onto the frame and into the reconstructed `Headers` — while the chunks
pushed over the WS are already decompressed, so the framing headers no longer
describe the re-framed body. This is the WS twin of the H2 proxy bug. Benign
today, empirically verified on Node 24: a synthetically-constructed
`new Response(stream, {headers})` ignores `content-length`,
`transfer-encoding`, AND `content-encoding` for body decode, and the sole live
consumer reads the body as a stream inspecting only Content-Type — no consumer
trusts the stale header. The path is also opt-in (`local_network` +
`openai_streaming`). A latent footgun only if refactored to a code path that
honors framing.

**If touched.** Fix alongside H2 — strip `content-length` and
`transfer-encoding` in the shared `filterResponseHeaders` (proxy.ts) rather than
per-route, so the WS frame stops carrying them too.

## I24 — `inlayStorage` metadata rows never pruned

- Finder: `sweep:indexeddb-quota` (S11), claimed info · Verification: confirmed,
  info (lone skeptic, round-3) · Novelty: new
- Location: `src/ts/process/files/inlays.ts:32`
  (`localforage.createInstance('inlay')`), `:94` (`rememberServerInlayAsset`,
  `data:undefined`), `:417` (`removeInlayAsset` — the only removal path).

**What / why info.** Every inlay attach persists a ~100-140 byte metadata row
(name/ext/dims/`serverAssetId`; the bytes go to the server), and a single attach
can write ~2 rows (one keyed by caller id, one by `serverAssetId`).
`removeInlayAsset` is the only removal API and has **no live (non-test) caller**;
there is no whole-store prune/GC in production, so growth is monotonic — but
bounded, tiny, and dwarfed by the server-held bytes, far below the genuinely
unbounded client stores. The verifier corrected the live attach paths: the
`google.ts` writers the finder listed are **DEAD** on the main send path
(`resolveServerCompletionRoute` routes chat-sends to the server, so client-side
Gemini signature/image writes never run); the genuinely live writers are
`multisend.ts:294 postInlayAsset` (manual file attach), `inlayScreen.ts:34
writeInlayImage` (opt-in imggen view-screen), and `triggers.ts`/`scriptings.ts`
`writeInlayImage` (opt-in Lua/trigger scripts).

**If touched.** Optional: prune rows whose `serverAssetId` is no longer
referenced (reuse the server-asset reference scan), or migrate the metadata
server-side. Not urgent.

## I25 — `getModelInfo` uncached find + clone

- Finder: `sweep:cbs-display-cost` (S13), claimed info · Verification: confirmed,
  info (lone skeptic, round-3) · Novelty: new
- Location: `src/ts/model/modellist.ts:833-857` (`LLMModels.find` +
  `safeStructuredClone`); CBS consumers `cbs.ts:2305-2325` (6 `metadata::model*`
  keys) + the send path.

**What / why info.** `getModelInfo` runs an uncached linear `LLMModels.find`
then `structuredClone` per call. The verifier counted the array at ~52 base
entries plus bounded dynamic expansions (OpenAI-compatible response-api +
Vertex duplicates + optional dynamic registry entries) — roughly 100-160
worst-case, not "the whole list," and the clone is of a single flat `LLMModel`
object (primitives + two small enum arrays), so per-call cost is ~4 µs (clone
dominates the find). The 6 `metadata::model*` CBS keys are matcher-gated (only
when content literally contains the tag), not a blanket per-render cost; the
per-send callers fire 1-2x. Even a generous 6 tags × 50-message window totals
~1.2 ms — sub-perceptible, and the cost is a bounded constant that does not scale
with corpus/transcript.

**If touched.** Optional: build a `Map<id, LLMModel>` index once at module init
for O(1) lookup; skip the clone when `db.enableCustomFlags` is false. Low value
at the measured magnitude.

## I26 — `reencodeImage` non-PNG full-res canvas

- Finder: `sweep:image-ingest-path` (S23), claimed info · Verification:
  accepted on the round-3 sweep's own code-level verification (no separate
  skeptic pass) · Novelty: new
- Location: `src/ts/process/files/inlays.ts:453-467` (`reencodeImage`:
  `canvas.width=imgObj.width`/`height` then `drawImage` + `toDataURL('image/png')`).

**What / why info.** `reencodeImage` short-circuits and returns bytes unchanged
when the input is already PNG, so PNG inputs are never decoded; for non-PNG it
does a full main-thread decode and allocates a canvas at the raw source
dimensions with **no downscale cap** (unlike `writeInlayImage`'s 1024² cap). The
sweep traced every caller: `exportCharacterCard` (own char image),
`persona.ts:221` (own persona export), and `persona.ts:261` (`importUserPersona`,
but `selectSingleFile(['png'])` restricts to PNG, which hits the short-circuit).
No third-party-supplied non-PNG image reaches this branch — charx/JSON imports
route images to server upload, never through canvas decode — so the missing cap
is **not** a live hostile vector; it is export-only on user-owned data. This
finding was accepted on the sweep's own verification without a separate skeptic
pass.

**If touched.** Add the same source-dimension guard / downscale cap used in
`writeInlayImage` if a future caller can pass untrusted non-PNG bytes. No change
needed for current callers.

## I27 — `calcString`/`parseArray`/`parseDict` linear per tag

- Finder: `sweep:cbs-display-cost` (S14), claimed info · Verification:
  confirmed, mechanism bound corrected, info (lone skeptic, round-3) · Novelty:
  extension of v2-I16
- Location: `src/ts/process/infunctions.ts:178-193` (`calcString`);
  `src/ts/parser/risuChatParserHelpers.ts:114-143` (`parseArray`/`parseDict`/
  `makeArray`); array CBS `cbs.ts:1571-1632`.

**What / why info.** `calcString` walks text once (O(total expression length)),
and each array CBS does exactly one `parseArray` + one `makeArray` per tag —
linear, no quadratic shape (benchmarked ~17 ms for a 50K flat expression, ~37 ms
nested). The verifier corrected the finder's amplification bound: chained
amplification is **not** governed only by the `{{#each}}` expansion budget —
manual FLAT nesting of array CBS (e.g. `{{arraypush::{{arraypush::…}}}}`) also
chains O(N²) in depth and is bounded only by the implicit 512-entry
`stackType = new Uint8Array(512)` parser stack (past depth ~511 the OOB write is
silently dropped and CBS matching breaks). Worst case at the 512-depth cap is
~350-440 ms — a real but bounded, one-time, sub-second event-loop stall
requiring a hand-crafted deeply nested payload; it also runs **server-side**
during assembly (`prompt/variables.ts:95`), so such a payload from an imported
card blocks the server event loop. Pattern note; same 512-depth bound as v2-I16.

**If touched.** None required. A `{{calc}}` arg-length cap (mirroring the
300-char `dateTimeFormat` cap) would bound the rare pathological case; the real
bound is the 512-depth stack, not the each-budget.

## I28 — Iris chat-history tool full-transcript copy

- Finder: `sweep:mcp-internal-clients` (S21), claimed info · Verification:
  confirmed, liveness narrowed, info (lone skeptic, round-3) · Novelty: new
- Location: `src/ts/process/mcp/risuaccess/chats.ts:65`
  (`[...char.chats[char.chatPage].message].reverse()`) then `:68` slice.

**What / why info.** `getChatHistory` builds a full shallow copy of the chat's
message array and reverses it just to take a ≤100-entry newest-first window —
cost scales with transcript length though only `offset+count` (default 20, cap
100) entries are returned, the same anti-pattern L39 removed from
`findGeneratedAssistantMessage`. The verifier narrowed liveness:
`internal:risuai` is in the **call-only** registry (`callOnlyMCPs`), so
`getMCPTools`/`getTools` do not include `risu-get-chat-history` in the normal
chat-send tool list — it is advertised to the model only via the built-in Iris
feature's system prompt. Trigger is a user in an Iris conversation AND the model
electing to call the tool; bounded one-shot O(transcript) shallow copy per rare
call, off the hot path.

**If touched.** Iterate the message array backwards in place for
`offset..offset+count` (the L39 in-place reverse-scan pattern in
`serverBackedSendChat.ts:76-83`) instead of copying+reversing the whole array.

## I29 — CSS-Highlight editor highlighter is DEAD

- Finder: `sweep:editor-keystroke-cost` (S26), claimed info · Verification:
  accepted on the round-3 sweep's own code-level verification (no separate
  skeptic pass) · Novelty: new
- Location: `src/ts/gui/highlight.ts:18` (`highlighter()`), `:112`
  (`runHighlight()`), `:360` (`simpleCBSHighlightParser()`); gate
  `src/lib/UI/GUI/TextAreaInput.svelte:239/:337`; store
  `src/ts/stores.svelte.ts:121` (`disableHighlight = writable(true)`).

**What / why info.** `highlighter()` does scale with editor text length — it
TreeWalks all text nodes, runs a whole-string CBS parse + 3 module-level global
RegExp `exec` loops, builds a `Range` per match (each `convertToDomRange` does an
O(nodes) `findIndex`), and `runHighlight()` rebuilds `new Highlight(...)` objects
across **every** live editor in the module-level Map per debounce tick. That
would be medium typing-lag on a ~50 KB prompt template. But it is **DEAD**:
`scheduleHighlight()` early-returns on `$disableHighlight`, and an exhaustive
repo-wide search confirms `disableHighlight` is declared `writable(true)` and is
only ever **read** (`TextAreaInput.svelte:239/:337`), never assigned false — no
settings UI, no DB field, no init code toggles it, so editors always render the
plain `<textarea>` branch. Recorded so future audits do not re-mine it as a live
perf risk. This finding was accepted on the sweep's own verification without a
separate skeptic pass.

**If touched.** No action while gated off. If `disableHighlight` is ever flipped
default-false, the per-tick whole-text recompute must be made incremental and
`runHighlight()` must rebuild only the changed id's contribution — fix before
reuse.

## I30 — Dead `PngChunk.read` unbounded variant

- Finder: `sweep:image-ingest-path` (S25), claimed info · Verification:
  confirmed, info (lone skeptic, round-3) · Novelty: new
- Location: `src/ts/pngChunk.ts:96` (`PngChunk.read`, dead) vs `:140`
  (`PngChunk.readGenerator`, live); sole reference commented out at
  `characterCards.ts:196`.

**What / why info.** The live PNG metadata path on imports is the bounded
`readGenerator`: fed a `Uint8Array`, `slice()` clamps `end` to the buffer so an
attacker-controlled 4-byte chunk length cannot over-allocate, `pos` advances by
≥12 per iteration so it always terminates, tEXt scanning is capped at the first
70 bytes, the `returnTrimed` accumulator is bounded by input size, and the
ReadableStream branch slides a window; callers additionally cap reads (5 MB
each, value-length skips). The sync `PngChunk.read` variant **does** have a loose
unbounded `pos += 12 + len` with no length sanity check, but the verifier
confirmed via repo-wide grep that its sole reference is commented out at
`characterCards.ts:196` — it is dead, not a live finding. (Same dead-code-with-
footgun class as v2-I17/v3-I17.)

**If touched.** Delete the dead sync `PngChunk.read`, or add a
`len <= remaining bytes` sanity check before slicing if it is ever revived.
