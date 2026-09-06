# Fastify multi-chat and mobile stability audit

Audited: 2026-08-11

Revision: `9afde4658ea5b277493e9d7f6ef7aaf387544165`

Status: open findings; this document is an audit, not a fix ledger

## Executive summary

The current Fastify port has substantially better chat ownership than the old
single-chat design: foreground generation activity, progress, cancellation,
reroll state, suggestions, translations, and most asynchronous transcript
writes are now keyed by stable chat/message identifiers. The legacy
`doingChat` store remains only as an aggregate compatibility projection and is
not the live cross-chat lock when the activity registry is populated.

The two requested focus areas are not fully closed, however. This audit found
five high-severity and five medium-severity current defects. The highest-risk
cluster is the boundary between a durably accepted user-message append and a
durable generation job. That boundary is split across two requests and is
owned only by browser memory. The server's active-job projection identifies a
chat but not the accepted message or client operation that caused the job.
Those two design choices explain several apparently different symptoms:

- a mobile process can forget that an accepted row still needs a generation;
- an unrelated same-chat job can be mistaken for proof that a new send reached
  the server;
- a later reattach cannot determine whether it should clear or preserve an
  accepted-send warning; and
- auxiliary send paths can persist a user row without transferring it to the
  recovery coordinator.

The durable stream has a separate confirmed consistency defect. Once its
bounded replay buffer evicts early token frames, a returning client rebuilds
from the retained suffix and then ignores the complete terminal result. The
authoritative server row is normally correct, but the visible row and
client/plugin post-processing can observe a truncated response until an
independent hydration repairs it.

No critical destructive-import defect was reproduced in the sampled current
paths. Validation, staging/rollback, safety backups, ordered client outboxes,
and server idempotency receipts are present. The contextual spot checks did
find several explicit compatibility losses and two places where the UI reports
or implies more durability/completeness than it has actually established.

## Scope and method

Deep review covered:

- accepted append to generation handoff;
- durable job creation, streaming, replay, cancellation, finalization, and
  reattach;
- foreground/background/online/page-show lifecycle handling;
- per-chat activity, progress, reroll, suggestions, translations, input hooks,
  and auxiliary send entry points; and
- stable target/message ownership across asynchronous boundaries.

Targeted sampling covered import compatibility, prompt/script differences,
provider adapters, optimistic durability, backup/import reporting, and
destructive-operation protections. It was not an exhaustive provider-by-
provider or script-language parity certification.

The review used current-source tracing, independent read-only cross-checks,
focused comparison with `/home/codex/Risuai`, existing regression-test review,
and the following verification:

- eight focused frontend files: 138 tests passed;
- four focused Fastify files: 276 tests passed; and
- a direct replay-buffer probe with `prompt`, `info`, 600 `token` frames, and
  `done`: the 512-frame replay retained only token frames 91 through 599 while
  retaining the terminal event.

No physical-device session, browser process-kill harness, or live external
provider call was run. Findings labeled confirmed are directly implied by
reachable source control flow; timing-dependent visible duration is called out
where an independent resource refresh may eventually repair state.

## Severity model

- **High:** an accepted operation can be silently stranded or attributed to
  the wrong owner, a user-visible completed result can be materially wrong, an
  explicit cancellation can fail, or generated content can be reported as
  durably queued without a retry record.
- **Medium:** misleading recovery/progress state, a recoverable consistency
  gap, or a narrower auxiliary-path failure.
- **Low:** defense-in-depth or test-only weakness without a demonstrated
  current incorrect result.

## Primary findings

| ID | Severity | Confidence | Finding |
| --- | --- | --- | --- |
| MS-01 | High | Confirmed | Accepted-send ownership and recovery do not survive reload or mobile process eviction |
| MS-02 | High | Confirmed | Any same-chat active job can be mistaken for proof that a specific accepted send reached the server |
| MS-03 | High | Confirmed | Replay truncation produces a suffix response while the client ignores the complete terminal result |
| MS-04 | High | Confirmed | Stop before the initial job ID arrives can leave the durable job running |
| MS-05 | High | Confirmed | Failure to create a finalization retry record is still reported as `queued` |
| MS-06 | Medium | Confirmed | The authoritative completion probe reports success without applying the transcript it fetched |
| MS-07 | Medium | Confirmed | A failure banner can remain while a later lifecycle refresh reattaches the owning job |
| MS-08 | Medium | Confirmed | Exhausted reattach retries leave an active-looking job with no retry/error affordance |
| MS-09 | Medium | Confirmed | Hypa V3 progress is a global last-event-wins scalar across chats and jobs |
| MS-10 | Medium | Confirmed | DevTool Autopilot and PO multisend bypass accepted-send recovery |

### MS-01 — Accepted-send recovery is process-memory only

**Impact:** A durable user row can survive while the knowledge that it still
needs a reply disappears. On a mobile OS eviction or reload, the chat can
silently contain a reply-less accepted row with no job and no retry banner.

The accepted-send operation registry is a module-local `Map`, and the recovery
list is a Svelte writable initialized to an empty array
([coordinator:51-80](../../src/ts/process/acceptedSendCoordinator.svelte.ts#L51-L80),
[recovery state:16](../../src/ts/process/acceptedSendRecoveryState.ts#L16)). A
queued append waits on an in-memory settlement promise before generation is
started
([coordinator:201-217](../../src/ts/process/acceptedSendCoordinator.svelte.ts#L201-L217)).
There is also an intentional 10 ms post-acceptance delay before `sendChat`
([coordinator:114-130](../../src/ts/process/acceptedSendCoordinator.svelte.ts#L114-L130)).

Bootstrap replays generic pending mutations and restores running generation
jobs, but it does not reconstruct an accepted-message-to-generation intent
([bootstrap:292-310](../../src/ts/bootstrap.ts#L292-L310),
[bootstrap:339-346](../../src/ts/bootstrap.ts#L339-L346)). The vulnerable
checkpoints are therefore:

1. a queued append is durably staged, then the process dies before its live
   settlement promise launches generation;
2. the append is accepted, then the process dies before the generation POST;
   or
3. a failure/retry record is displayed, then reload clears that in-memory
   record.

Running jobs and already-persisted replies are recoverable. The defect is the
append-to-job handoff interval.

**Recommendation:** Persist a lineage/writer-scoped accepted-send state machine
keyed by chat ID and accepted message ID before dispatching the append. The
stronger design is one idempotent server operation that atomically appends the
user row and records/launches its generation. Clear the intent only after exact
job acceptance or authoritative adjacent-assistant proof.

### MS-02 — Chat-level activity is not operation ownership

**Impact:** A new accepted row can be reported as generated even though the
known job belongs to an older send. The row is then stranded without an
explicit recovery state.

After `sendChat` fails, `acceptedGenerationReachedServer` refreshes bootstrap
and treats any known message generation for the chat as success unless the
client received the exact typed `generation_in_progress` response
([coordinator:146-175](../../src/ts/process/acceptedSendCoordinator.svelte.ts#L146-L175),
[reattach:66-71](../../src/ts/process/reattach.ts#L66-L71)). The server's active
job projection carries `chatId`, `jobId`, mode, and optional regenerate target,
but no accepted user-message ID or client operation ID
([generationJobs:84-115](../../server/fastify/src/generationJobs.ts#L84-L115)).

Two reachable sequences demonstrate the problem:

- Two concurrent Plugin V3 `sendChat` calls can both pass the generation
  precheck, append distinct messages, and enter separately keyed coordinators
  before either starts activity
  ([V3 API:1864-1905](../../src/ts/plugins/apiV3/v3.svelte.ts#L1864-L1905)).
  One `sendChat` wins the per-chat activity lease; the other returns `false`
  without a typed 409
  ([sendChat:230-240](../../src/ts/process/index.svelte.ts#L230-L240)). The
  coordinator sees the winner's chat activity and reports the losing accepted
  row as generated.
- If an older job exists in another client, the server correctly rejects a new
  generation with 409
  ([generation route:3900-3905](../../server/fastify/src/routes/generationChat.ts#L3900-L3905)).
  When unstable transport hides that response body, the cause remains generic.
  Bootstrap exposes the older job, and the coordinator reports success. That
  older job cannot cover a newly appended row: finalization rejects a changed
  transcript
  ([finalization fence:2743-2767](../../server/fastify/src/routes/generationChat.ts#L2743-L2767)).

The existing active-job recovery test explicitly asserts chat-level success
and skips the transcript probe; it does not establish ownership
([coordinator test:180-194](../../src/ts/process/acceptedSendCoordinator.test.ts#L180-L194)).

**Recommendation:** Give every send a client-generated idempotency/operation
ID, carry the accepted message ID in the generation request, job record,
`job_accepted`, and bootstrap projection, and serialize same-chat
preflight/append/handoff. Only an exact matching job or authoritative adjacent
reply should settle the operation as generated.

### MS-03 — Bounded replay and terminal reconciliation disagree

**Impact:** After a sufficiently long disconnected stream, the server persists
the full reply but the returning client can render and post-process only a
suffix while reporting successful completion. Plugin output listeners and IGP
can observe the incomplete text before a later hydration repairs it.

Durable replay is capped at 512 events or 2 MiB
([streamJobs:15-17](../../server/fastify/src/streamJobs.ts#L15-L17)). `token` is
not protected, so overflow removes the earliest token frames while retaining
prompt/info/terminal frames
([streamJobs:80-90](../../server/fastify/src/streamJobs.ts#L80-L90),
[streamJobs:221-241](../../server/fastify/src/streamJobs.ts#L221-L241)). Durable
provider dispatch correctly retains the full `done.result`; its transport
contract explicitly requires that for replayable streams
([provider transport:32-39](../../server/fastify/src/prompt/providerTransport.ts#L32-L39),
[durable dispatch:3765-3809](../../server/fastify/src/routes/generationChat.ts#L3765-L3809)).

On reconnect, the browser resets accumulated text to empty because it assumes
the replay is complete
([serverChat:696-724](../../src/ts/process/request/serverChat.ts#L696-L724)). It
then appends the retained token suffix and uses `done.result` only when no token
survived
([serverChat:826-838](../../src/ts/process/request/serverChat.ts#L826-L838),
[serverChat:884-894](../../src/ts/process/request/serverChat.ts#L884-L894)). A
normal post-generation frame does not repair this because `finalText` is sent
only when post-processing changed the text
([generation route:2041-2067](../../server/fastify/src/routes/generationChat.ts#L2041-L2067)).
The suffix has already been written into the owned assistant projection
([streamResponse:239-260](../../src/ts/process/postGeneration/streamResponse.ts#L239-L260)).

An independent `generation.persisted` resource event normally triggers
authoritative hydration, which mitigates server-side data loss. That path is a
separate connection/read and is not a reconciliation barrier before terminal
callbacks—precisely the path likely to be delayed during mobile suspension.

**Recommendation:** On every durable reattach, treat a present terminal result
as canonical and replace the accumulated replay text before closing and before
post-processing. Alternatively, add replay cursors plus an explicit gap/full
snapshot event. Add a cross-layer test exceeding both caps and assert the
visible row, output listeners, IGP input, and persisted row all receive the
same full text.

### MS-04 — Stop has a pre-job-ID cancellation gap

**Impact:** The user can press Stop, see the local request abort, and later find
that the server continued and persisted the reply. Unstable networks enlarge
the interval between server acceptance and delivery of the response header.

For a fresh durable send, the abort handler cannot issue DELETE until it knows
`durableJobId`; with an empty ID it returns
([serverChat:517-535](../../src/ts/process/request/serverChat.ts#L517-L535)). If
the fetch aborts before resolving the initial response, the function removes
the abort watcher and returns before reading the job-ID header
([serverChat:537-550](../../src/ts/process/request/serverChat.ts#L537-L550),
[serverChat:584-605](../../src/ts/process/request/serverChat.ts#L584-L605)).

The server may already have created, registered, and detached the job
([generation route:3907-3923](../../server/fastify/src/routes/generationChat.ts#L3907-L3923)).
Viewer disconnect deliberately detaches rather than aborting generation
([generation route:2557-2562](../../server/fastify/src/routes/generationChat.ts#L2557-L2562)).
Existing tests stop after `job_accepted` or after the response header is
available; there is no server-accepted/client-pre-header case
([serverChat test:1471-1520](../../src/ts/process/request/tests/serverChat.test.ts#L1471-L1520)).

**Recommendation:** Preassign a client operation ID and make cancellation
addressable by that ID before the server job ID is known. Retain the stop intent
until the POST is conclusively rejected or the matching job is cancelled. Test
with the server creating the job while the initial response is held from the
browser.

### MS-05 — A missing retry record is reported as queued

**Impact:** Generated content can be shown as provisional and “waiting to be
saved” even though no retry row exists. On refresh, the provisional client row
and marker can disappear permanently.

`queueAndPersistGenerationFinalization` inserts the SQLite retry row before the
`try` that covers final persistence
([generation route:3225-3246](../../server/fastify/src/routes/generationChat.ts#L3225-L3246)).
If the enqueue itself throws—for example because SQLite is closed, busy, or has
an I/O/serialization failure—the caller catches the error and labels every
non-validation/non-not-found failure as `persistenceDisposition: 'queued'`
([generation route:3416-3457](../../server/fastify/src/routes/generationChat.ts#L3416-L3457)).

The client trusts that disposition and marks the streamed row as provisionally
queued
([serverBackedSendChat:693-739](../../src/ts/process/serverBackedSendChat.ts#L693-L739)).
Tests cover persistence failure after a retry record exists, but not failure to
create the record.

**Recommendation:** Make enqueue outcome explicit and never emit `queued`
without confirming the retry record in the same durability boundary. Report a
distinct rejected/unknown disposition when journaling itself fails, reconcile
the optimistic projection immediately, and inject an enqueue failure in an
integration test.

### MS-06 — Completion proof is not transcript reconciliation

**Impact:** A mobile recovery can be classified as successful while the local
chat remains user-only or partially streamed. Normal success effects run before
the authoritative row is visible.

When no active job remains, the coordinator fetches the authoritative
generation suffix and checks only whether an adjacent assistant row exists
([coordinator:159-162](../../src/ts/process/acceptedSendCoordinator.svelte.ts#L159-L162),
[hydration read:216-225](../../src/ts/server/hydrationReads.ts#L216-L225)). It
discards the payload and returns `generated`; the composer then applies normal
successful-send effects
([coordinator:174-176](../../src/ts/process/acceptedSendCoordinator.svelte.ts#L174-L176),
[chat screen:908-917](../../src/lib/ChatScreens/DefaultChatScreen.svelte#L908-L917)).

The repository already has freshness/revision-aware machinery for applying an
already fetched suffix
([chat hydration:585-615](../../src/ts/server/chatMessageHydration.svelte.ts#L585-L615)).

**Recommendation:** Apply the fetched response through that guarded hydration
path—or force strict hydration—and report `generated` only after reconciliation
succeeds.

### MS-07 — Recovery warning and recovered job can coexist incorrectly

**Impact:** The UI can say “reply could not be started” and offer “Retry reply”
while the reply is visibly generating after an `online`, `pageshow`, or
foreground recovery.

Lifecycle handlers refresh bootstrap jobs and trigger reattach
([reattach:234-269](../../src/ts/process/reattach.ts#L234-L269)). Reattach does
not reconcile accepted-send recoveries
([reattach:153-225](../../src/ts/process/reattach.ts#L153-L225)). Recovery is
removed only by an explicit successful retry or authoritative transcript
hydration
([coordinator:233-252](../../src/ts/process/acceptedSendCoordinator.svelte.ts#L233-L252),
[recovery state:58-66](../../src/ts/process/acceptedSendRecoveryState.ts#L58-L66)).
The banner depends only on the target-keyed recovery entry, not a matching job
([chat screen:2234-2254](../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2234-L2254)).

Blindly clearing by chat would be wrong: a typed 409 warning must remain while
an unrelated older same-chat job runs. This is another consequence of MS-02's
missing operation/message ownership.

**Recommendation:** Reconcile or suppress a warning only when the discovered
job carries the exact accepted message/operation ID. Keep the current behavior
for an unrelated same-chat lock.

### MS-08 — Reattach exhaustion has no user-visible state

**Impact:** After the 250 ms, 1 s, and 4 s retry sequence is exhausted, the job
remains locally active-looking and the chat shows a Stop control, but there is
no reconnect failure, manual reattach, or refresh action. A later lifecycle
event can reset the retry state, but the current screen offers no recovery
path other than cancellation.

The bounded retry state blocks further attempts after its budget and schedules
nothing when no delay remains
([reattach:107-130](../../src/ts/process/reattach.ts#L107-L130)). Retryable
failures restore the job, while the reattach layer exposes no error store
([reattach:195-222](../../src/ts/process/reattach.ts#L195-L222)). The chat UI
renders active ownership only as the generation pulse/Stop button
([chat screen:2316-2324](../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2316-L2324)).

**Recommendation:** Add a per-job `reattach_failed` state with Retry and Refresh
actions, and keep it distinct from accepted-send recovery. Cover exhaustion,
manual retry, lifecycle reset, cancellation, and eventual authoritative
completion.

### MS-09 — Hypa V3 progress remains global

**Impact:** With memory work in Chats A and B, whichever event arrives last owns
the single global popup. A terminal event for A sets `open: false` and can hide
B's still-running work; labels can similarly oscillate between jobs.

The server broadcasts every memory event to every connected client
([events route:252-265](../../server/fastify/src/routes/events.ts#L252-L265)).
The browser validates chat/job ordering, but passes only the side-effect payload
to a setter, dropping the outer chat/job identity
([bootstrap:642-647](../../src/ts/bootstrap.ts#L642-L647)). That setter
unconditionally replaces one scalar store
([serverMemory:79-95](../../src/ts/process/request/serverMemory.ts#L79-L95),
[stores:72-78](../../src/ts/stores.svelte.ts#L72-L78)). Each completed/failed/
cancelled job emits `open: false` independently
([memoryEvents:114-130](../../server/fastify/src/memoryEvents.ts#L114-L130)).

**Recommendation:** Retain progress in a `chatId/jobId` map, remove only the
terminal job, and derive either open-chat progress or a truthful aggregate.
Add an A-running, B-running, A-completes, B-remains-running interleaving test.

### MS-10 — Auxiliary send paths bypass the recovery boundary

**Impact:** Niche but reachable tools can durably append a user row and then
return on navigation or queueing without generation or an accepted-send retry
record.

DevTool Autopilot appends first, returns if navigation occurred, returns for a
queued append, and otherwise calls raw `sendChat`
([DevTool:243-272](../../src/lib/SideBars/DevTool.svelte#L243-L272)). Its
navigation test currently asserts that generation is not called after the
accepted append, but has no rollback/recovery assertion
([DevTool test:239-260](../../src/lib/SideBars/DevTool.svelte.test.ts#L239-L260)).

PO multisend has the same split: it accepts only immediate `ok`, returns on
navigation, and invokes raw `sendChat(-1)` rather than handing the accepted row
to the coordinator
([multisend:26-68](../../src/ts/process/files/multisend.ts#L26-L68)).

**Recommendation:** Make the accepted-send coordinator the only legal
post-append handoff for standard UI, plugins, DevTool, and batch/file senders.
It must accept queued settlements and captured targets; batch iteration should
wait for the owned operation's terminal/recovery outcome.

## Explicit design limitation

### Server restart loses in-flight generation ownership

The durable generation registry is explicitly in-memory only
([generationJobs:3-18](../../server/fastify/src/generationJobs.ts#L3-L18)). A
browser reload can discover a job while the same server process is alive, but a
server crash/restart during assembly or provider streaming loses the runner,
replay, lock, and bootstrap projection. The SQLite finalization retry exists
only once finalization begins.

This is documented policy rather than an accidental regression, so it is not
counted among the ten findings. It should nevertheless be made explicit in the
product reliability contract. If restart-resumable generation is required,
job intent and state need a durable queue/worker boundary; otherwise the client
needs an authoritative abandoned-send state after restart.

## Verified safeguards and negative findings

The audit specifically verified the following protections rather than
assuming every historical single-chat issue still exists:

- `activeChatGenerations` is keyed by stable chat target, permits different
  chats to generate concurrently, and owns per-chat controllers/stages
  ([generationActivity:18-76](../../src/ts/process/generationActivity.svelte.ts#L18-L76)).
- The server enforces one running job per chat while allowing concurrent jobs in
  different chats. Existing durable-generation coverage exercises two chats.
- Main streaming writes, post-generation application, error restoration, and
  queued/rejected generation projections resolve stable character/chat/message
  identifiers instead of using the current selection.
- Reroll candidates are chat-scoped and use stable message IDs. Suggestions
  use chat/request ownership plus freshness guards. Message and greeting
  translation use chat/message/job IDs and terminal recovery. Input-hook
  activity is chat-keyed.
- Prompt preview's legacy scalar outputs have guarded producers and consumers;
  stale navigation results are discarded before assignment/display.
- A received typed same-chat 409 remains an explicit retryable warning rather
  than being incorrectly cleared by the known older job.
- Durable command outboxes serialize predecessors and reuse mutation receipt
  IDs for idempotent replay; no older-overwrites-newer defect was confirmed in
  the sampled current paths.
- Generation finalization has a transcript snapshot fence, and server-owned
  persistence normally precedes the terminal `done` event.

## Browser/mobile coverage gap

The passing unit/integration suites do not simulate the lifecycle matrix that
produces the primary findings. The current Playwright mobile coverage checks a
responsive composer and Pixel 7 touch reordering, not generation recovery
([browser smoke:331-420](../../server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts#L331-L420)).
The reroll reload journey calls `/generate/chat` directly, drains the completed
stream, and only then reloads
([reroll smoke:65-96](../../server/fastify/browser-smoke/rerollSwipePersistence.spec.ts#L65-L96)).

Add one production-stack browser matrix covering:

1. composer append and incremental token paint;
2. connection loss before job header, after job header, mid-token stream, and
   after server persistence but before terminal/resource delivery;
3. `visibilitychange`, `pagehide/pageshow`, offline/online, full reload, and
   simulated process loss at every append-to-job checkpoint;
4. replay beyond 512 events and 2 MiB;
5. two chats generating concurrently with independent progress and Stop;
6. two same-chat Plugin V3 sends and two browser clients;
7. reattach retry exhaustion and manual recovery;
8. finalization retry-journal insertion failure; and
9. two interleaved Hypa memory jobs where one finishes first.

Every case should assert four views of truth: visible transcript, local
projection, authoritative server transcript, and remaining job/recovery/outbox
records.

## Contextual migration spot checks

These were sampled because they were supplied as context. They are current,
high-confidence observations, but this section is not an exhaustive parity
audit.

| Area | Current observation | Evidence / implication |
| --- | --- | --- |
| Character prompt compatibility | Imported `additionalText` is preserved but deliberately omitted from Fastify prompts. | The server documents the omission and a test calls it an accepted retired divergence ([staticSections:18](../../server/fastify/src/prompt/staticSections.ts#L18), [generation test:1507-1533](../../server/fastify/__tests__/generation.chat.test.ts#L1507-L1533)); the original app called `additionalInformations` during description assembly. Existing characters relying on this field send a different prompt. |
| Save import compatibility | Standalone `CHAT` blocks are rejected. | Import throws “Standalone chat blocks are not supported yet” ([importSnapshot:184-200](../../server/fastify/src/risuSave/importSnapshot.ts#L184-L200)). Saves emitted in that block form cannot be imported. |
| Kobold provider | The repository's own default/legacy URL ends in `/api/v1`, but the Fastify adapter appends `/api/v1/generate` whenever that full suffix is absent. | The default is `http://localhost:5001/api/v1` ([templates:254-260](../../src/ts/process/templates/templates.ts#L254-L260)); the adapter produces `/api/v1/api/v1/generate` ([kobold:78-87](../../server/fastify/src/generation/kobold.ts#L78-L87)). Tests cover a bare host and the complete generate URL, not the default intermediate path. |
| Ooba Legacy provider | `useStreaming` is calculated but the Ooba Legacy branch always returns the buffered HTTP runner. | [chatDispatch:1245-1252](../../server/fastify/src/prompt/chatDispatch.ts#L1245-L1252), [chatDispatch:1580-1631](../../server/fastify/src/prompt/chatDispatch.ts#L1580-L1631). The original app selected a WebSocket stream when `useStreaming` was true, so the visible setting no longer has its old effect. |
| Trigger/CBS compatibility | Numerous trigger effects are explicit server no-ops; browser-context CBS callbacks can throw on Fastify. | The unsupported set includes LLM/image/command, persistent character/persona/lorebook, GUI, and wait operations ([trigger support:1-48](../../src/ts/process/triggerServerSupport.ts#L1-L48)). `screenwidth` and browser-language callbacks retain `window`/`navigator` bodies ([CBS adapter:16-19](../../server/fastify/src/prompt/cbsAdapter.ts#L16-L19)). These should be blocked/diagnosed at configuration time or implemented, not merely remain visible. |
| Optimistic creation durability | Non-selecting character creation and character import return an index/ID while durable dispatch is fire-and-forget. | `dispatchCreateCharacter` returns `void` and discards the durable settlement ([characterCommands:765-806](../../src/ts/characterCommands.ts#L765-L806)); callers immediately return optimistic success ([characters:133-158](../../src/ts/characters.ts#L133-L158), [characterCards:148-163](../../src/ts/characterCards.ts#L148-L163)). A later rollback can make an apparently created/imported character disappear. |
| Bundle import reporting | The server reports missing/orphaned assets, but the browser parser drops that report and announces success after resync. | The server returns `assetReport` ([save route:191-239](../../server/fastify/src/routes/save.ts#L191-L239)); the browser parses only revision/ownership/event ([backups:623-640](../../src/ts/server/backups.ts#L623-L640)). A tested import with a missing reference returns 200 and `missingCount: 1` ([import test:897-934](../../server/fastify/__tests__/risuSaveImportRoute.test.ts#L897-L934)). |

### Destructive-operation assessment

The sampled current restore/import paths validate/decode before applying the
replacement, stage assets, roll back copied files on import failure, and create
safety backups around destructive replacement. That materially reduces the
original corrupt-file/clear-first risk.

Two concurrency questions remain open and should be stress-tested before
declaring the area closed:

- active-writer checks establish identity but do not visibly provide one
  operation-wide mutex between ordinary commands and long restore/import
  replacement boundaries; and
- backup creation snapshots SQLite before copying asset/save directories, so a
  concurrent filesystem mutation could produce a mixed-time bundle.

These are architectural inferences, not elevated confirmed findings in this
audit. Add held-command/restore and concurrent-asset-write/backup tests before
choosing a locking or snapshot policy.

## Recommended remediation order

1. **Unify send identity and durability.** Introduce a client operation ID and
   accepted message ID across append, generation POST, job metadata, bootstrap,
   reattach, cancellation, and completion. Prefer an atomic idempotent
   append-and-launch server operation. Route Plugin V3, DevTool, and batch send
   through the same state machine. This closes MS-01, MS-02, MS-07, and MS-10
   at their root.
2. **Make mobile stream recovery canonical.** Fix terminal-result replacement
   after replay gaps, add an explicit replay-gap/full-snapshot contract, and
   make Stop addressable before job-ID delivery. This closes MS-03 and MS-04.
3. **Make durability claims truthful.** Confirm the finalization retry row
   before reporting `queued`, and apply authoritative completion probes before
   reporting success. This closes MS-05 and MS-06.
4. **Expose recoverable lifecycle state.** Add per-job reattach failure/retry
   state and key Hypa progress by chat/job. This closes MS-08 and MS-09.
5. **Land the browser lifecycle matrix.** Treat it as an acceptance gate for
   the preceding changes, not as a substitute for the unit and server tests.
6. **Resolve quick compatibility wins.** Normalize the legacy Kobold URL,
   implement or explicitly disable Ooba Legacy streaming, surface import asset
   reports, and mark intentionally unsupported script/prompt features in the
   UI and import diagnostics.

## Exit criteria

The focused mobile/multi-chat area should not be considered closed until all
of the following hold:

- every durably accepted user row has exactly one durable operation identity
  and ends in a matching job, matching adjacent reply, or persistent explicit
  recovery state across process reload;
- no job/progress/cancellation/recovery decision uses chat ID alone where two
  same-chat operations can exist;
- a reattached response is byte-for-byte consistent with the authoritative
  server row before client post-processing runs;
- Stop is honored even when the initial response never reaches the client;
- `queued` is emitted only when a durable retry record exists; and
- the production browser lifecycle/concurrency matrix passes on desktop and a
  mobile device profile.
