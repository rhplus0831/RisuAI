# MS-04 validation: Stop before job-ID delivery

Validated: 2026-08-11  
Consolidated audit revision: `9afde4658ea5b277493e9d7f6ef7aaf387544165`  
Validation revision: `e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`  
Disposition: **confirmed**  
Severity: **High**

## Executive conclusion

MS-04 is a real cancellation race in fresh durable `send`, `continue`, and
`regenerate` requests. The server makes the generation durable and detached
before the browser necessarily receives the server-assigned job ID. During
that interval, Stop aborts the browser's POST, but the abort handler has no ID
with which to call the job DELETE endpoint. The handler discards the Stop
intent, the viewer disconnect deliberately does not abort the server job, and
the server can finish normal post-generation work and persist the reply.

The response-header ID already fixes the narrower “headers arrived but the
first SSE frame did not” race. It cannot fix “the server accepted the job but
the response headers have not reached `fetch`.” A correct fix needs an identity
known before the POST, cancellation that remains effective when DELETE and POST
arrive in either order, and an acknowledged/retryable Stop lifecycle. Waiting
for or moving the existing `job_accepted` frame is not sufficient.

The investigation also found one separate confirmed issue not stated in the
consolidated audit: even after the job ID is known, the browser treats DELETE as
fire-and-forget, ignores non-2xx responses, swallows transport failure, and
clears local job state before cancellation is acknowledged. Preassigning an
operation ID alone would leave that failure mode open.

## What exactly is the bug?

### Required invariant

Once the user explicitly presses Stop for a visible durable generation, one of
the following must become authoritative:

1. the generation POST was conclusively rejected and no job exists; or
2. the matching operation was accepted and the server has recorded and acted
   on its cancellation.

A dropped SSE viewer is intentionally different: a passive disconnect should
detach so the durable job can survive mobile suspension. The bug is that the
same browser `AbortSignal` represents an explicit Stop, but the only durable
cancellation address is learned through the very response that Stop aborts.

### Actual invariant violation

For a fresh durable request, `requestServerChatGeneration` starts with
`durableJobId === ''`. Its abort callback immediately returns when the ID is
empty, and the DELETE is therefore not sent
([serverChat.ts:517-530](../../../src/ts/process/request/serverChat.ts#L517-L530)).
The POST uses that same signal. If Stop wins before `fetch` resolves, the fetch
catch returns `status: 'aborted'`
([serverChat.ts:280-313](../../../src/ts/process/request/serverChat.ts#L280-L313)),
after which the outer function removes the abort listener, clears progress,
and returns without reading any response header
([serverChat.ts:537-550](../../../src/ts/process/request/serverChat.ts#L537-L550)).

Meanwhile, server acceptance occurs earlier. `startDurableGeneration` creates
the UUID job, inserts it into the registry, assigns the chat/writer/mode,
claims the per-chat running slot, attaches the response viewer, and starts the
detached runner
([generationChat.ts:3883-3943](../../../server/fastify/src/routes/generationChat.ts#L3883-L3943),
[streamJobs.ts:291-311](../../../server/fastify/src/streamJobs.ts#L291-L311)).
Only after creation does the server write the job-ID response header and the
`job_accepted` body frame
([generationChat.ts:2557-2581](../../../server/fastify/src/routes/generationChat.ts#L2557-L2581)).

The two relevant points are therefore different:

| Point | Server state | Browser state |
| --- | --- | --- |
| Acceptance | The job UUID is in `JobRegistry` and the chat slot is claimed. | The POST may still be awaiting response headers; `durableJobId` is empty. |
| Addressability | The response head reaches `fetch`, or later `job_accepted` is parsed. | The browser can finally call `DELETE /generate/chat/:jobId`. |

MS-04 is the interval between those points. Network latency, proxy buffering,
radio changes, mobile suspension, and process scheduling can lengthen it; none
is required for the source-level race to exist.

### Exact scope

- It affects fresh durable generation requests. Normal message sends are
  especially visible because the user-message append is durably accepted
  before generation is handed off
  ([DefaultChatScreen.svelte:1583-1605](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1583-L1605)).
- Durable `continue` and `regenerate` use the same fresh POST and are vulnerable
  even though they do not append a new user row.
- A reattach is not vulnerable to this particular empty-ID race because its
  `reattachJobId` is known before the GET starts.
- A non-durable request is intentionally connection-scoped and does not use the
  durable DELETE path.
- Stop after the response header is available is outside the primary gap: the
  client reads `X-Risu-Generation-Job-ID`, remembers it, and rechecks an already
  aborted signal before consuming the body
  ([serverChat.ts:584-605](../../../src/ts/process/request/serverChat.ts#L584-L605)).
- Stop after `job_accepted` is also addressable through the body-frame fallback
  ([serverChat.ts:750-759](../../../src/ts/process/request/serverChat.ts#L750-L759)).

## How does the bug affect users?

1. **Stop can appear to work locally while it fails remotely.** The Stop button
   aborts the chat-owned controller
   ([index.svelte.ts:146-153](../../../src/ts/process/index.svelte.ts#L146-L153)).
   `sendChat` then removes the local generation activity in `finally`
   ([index.svelte.ts:655-659](../../../src/ts/process/index.svelte.ts#L655-L659)),
   so the composer can stop showing generation unless a later bootstrap has
   rediscovered the unknown job.
2. **The supposedly stopped job consumes provider time/tokens.** Its runner
   owns a separate `AbortController`; the request connection is only a viewer
   ([generationChat.ts:3593-3600](../../../server/fastify/src/routes/generationChat.ts#L3593-L3600)).
3. **A full unwanted reply can appear later.** Viewer close only detaches
   ([generationChat.ts:2595-2598](../../../server/fastify/src/routes/generationChat.ts#L2595-L2598)).
   Without DELETE, the runner follows the ordinary completion path, including
   post-generation derivation, final persistence, translation/notification
   follow-up where configured, and resource invalidation. The existing server
   test explicitly proves that a disconnected viewer can later receive a
   fully persisted assistant row
   ([durableGeneration.test.ts:679-704](../../../server/fastify/__tests__/durableGeneration.test.ts#L679-L704)).
4. **The behavior differs materially from a real Stop.** A successful streaming
   cancel skips normal post-generation and persists only the raw accumulated
   text, subject to the incomplete-response setting
   ([generationChat.ts:3543-3590](../../../server/fastify/src/routes/generationChat.ts#L3543-L3590),
   [generationChat.ts:3810-3831](../../../server/fastify/src/routes/generationChat.ts#L3810-L3831)).
   MS-04 instead allows normal completion.
5. **Immediate retry can be confusing.** Until the ghost job finishes, the
   server's one-running-job-per-chat rule remains claimed. A later send can be
   rejected with `generation_in_progress`; for normal sends, its user row may
   already have been accepted. The server suite preserves exactly that
   accepted-row/409 behavior
   ([durableGeneration.test.ts:1170-1201](../../../server/fastify/__tests__/durableGeneration.test.ts#L1170-L1201)).
6. **Recovery does not restore the lost Stop intent.** Bootstrap can rediscover
   the active job and reattach it on visibility, page-show, or online recovery
   ([reattach.ts:232-295](../../../src/ts/process/reattach.ts#L232-L295)). For an
   accepted normal send, the coordinator can even treat any known same-chat job
   as evidence that generation reached the server
   ([acceptedSendCoordinator.svelte.ts:140-175](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L140-L175)).
   Those are useful disconnect-recovery mechanisms, but without operation
   identity they cannot distinguish “continue this job” from “the user already
   stopped this job.”

Multi-chat ownership is not the cause: the visible Stop is correctly scoped to
the open chat. The gap exists inside that chat's server handoff.

## In what sequence does the bug occur?

The normal composer path makes the complete sequence easiest to see:

| Step | Browser | Server | Result |
| --- | --- | --- | --- |
| 1 | The user sends a message. The append command settles as accepted, and the composer hands the captured chat/message to the accepted-send coordinator. | The user row is durable. | A durable user row can outlive the following generation attempt. |
| 2 | The coordinator creates an `AbortController`; `sendChat` registers it on the chat-keyed activity. | — | The open chat renders Stop. See [acceptedSendCoordinator.svelte.ts:114-137](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L114-L137) and [generationActivity.svelte.ts:44-63](../../../src/ts/process/generationActivity.svelte.ts#L44-L63). |
| 3 | `requestServerChatGeneration` installs `cancelDurableOnAbort`, but `durableJobId` is empty. | — | Stop is being watched, but it is not yet addressable. |
| 4 | `openChatResponse` starts `POST /api/v1/generate/chat` using the same signal. | The route authenticates, validates, preflights, and selects the durable branch. | The request has reached the server. |
| 5 | `fetch` still awaits the response. | The server creates the UUID job, enables replay, records chat/writer/mode, and registers the chat slot. | The job is active and visible to server bootstrap, but unknown to this browser call. |
| 6 | — | The server writes the response header and first SSE frame, then starts/tracks the detached runner. | These bytes may not yet have reached browser JavaScript. |
| 7 | The user presses Stop. `abortActiveGeneration` aborts the activity controller. | The job may already be assembling or dispatching. | The abort listener runs synchronously. |
| 8 | `cancelDurableOnAbort` sees the empty ID and returns without DELETE. | — | The explicit cancellation intent is lost. |
| 9 | Aborting the signal rejects the POST fetch. `openChatResponse` returns `aborted`; its caller removes the listener and returns before header parsing. | The socket close is observed as viewer loss. | No later header or `job_accepted` frame can repair the cancelled browser call. |
| 10 | `sendChat` unwinds and removes the local activity. | Request-abort plumbing has been cleaned up after durable handoff. The runner uses the job controller, not the request signal. | Local and server lifecycle state diverge. |
| 11 | A bootstrap/lifecycle probe may later rediscover the job, or nothing is visible until resource hydration. | Disconnect detaches the viewer; it does not abort the job. | Recovery can resume/observe the job, but cannot infer the discarded Stop intent. |
| 12 | The user later sees a reply, a recovery/409 state, or the Stop control reappear after discovery. | The job finishes, persists, clears the chat slot, and is marked done. | Explicit Stop did not define the terminal outcome. |

There is a related edge around the optional Hypa truncation-confirmation
preflight: after its awaited assembly returns, the route does not recheck
`requestAbort.signal.aborted` before entering `startDurableGeneration`
([generationChat.ts:3983-4037](../../../server/fastify/src/routes/generationChat.ts#L3983-L4037)).
The operation-level cancellation check must therefore be made at the final
create/dispatch boundary as well as at request entry.

## Why existing mitigations are insufficient

- **The response header is valuable but too late.** It closes the
  post-header/pre-body window covered by the current client test, not the
  server-accepted/pre-header window.
- **`job_accepted` is later still.** An aborted SSE reader will not yield a
  buffered first frame after its abort.
- **Bootstrap is discovery, not cancellation.** It reports the job by chat/job
  ID after the browser has already thrown away which accepted operation was
  stopped.
- **One-job-per-chat is not identity.** It prevents concurrent jobs for one
  chat but cannot correlate a Stop with the specific POST while the client
  does not know the job UUID.
- **Durable finalization fencing protects transcript consistency, not user
  intent.** It can reject a stale write if a later transcript edit races the
  ghost job; it does not stop provider execution or guarantee cancellation.
- **The current tests begin too late.** Client tests abort after
  `job_accepted` or after the response header is observable
  ([serverChat.test.ts:1447-1520](../../../src/ts/process/request/tests/serverChat.test.ts#L1447-L1520)).
  Server tests prove that the ID precedes body consumption and that disconnect
  intentionally persists a result
  ([durableGeneration.test.ts:669-704](../../../server/fastify/__tests__/durableGeneration.test.ts#L669-L704)).
  Neither holds the initial response away from the browser after server
  acceptance.

## What changes are needed to fix it?

### 1. Introduce one preassigned generation-operation identity

Create a cryptographically random `clientOperationId` before the durable POST
and carry it through:

- accepted user-message handoff (including the accepted `messageId` for normal
  sends);
- `ServerChatInput` and `assembleServerBackedSendChat`;
- the POST body and server validation;
- job metadata, bootstrap projection, reattach, cancellation, and terminal
  frames; and
- recovery records and diagnostics.

The browser already creates a process-memory accepted-send key from chat and
message identity
([acceptedSendCoordinator.svelte.ts:39-68](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L39-L68)),
but it is neither a server protocol field nor durable cancellation identity.
Prefer extending the broader MS-01/MS-02 operation identity rather than adding
an unrelated cancellation-only UUID.

### 2. Make Stop order-independent on the server

Add an idempotent cancel-by-operation endpoint (or an equivalent operation
resource), and maintain a bounded operation record with at least:

```text
operationId, writer/lineage owner, chatId, acceptedMessageId?, mode,
state = reserved | running(jobId) | cancel_requested | cancelled | completed
```

The server must atomically handle both arrival orders:

- **POST first:** bind `operationId -> jobId` before provider dispatch; DELETE
  changes the operation to `cancel_requested` and aborts that job.
- **DELETE first:** retain a cancellation tombstone/reservation. A later POST
  with the same identity must not create or dispatch a job.

Merely including an operation ID in the POST is insufficient: on separate HTTP
connections, DELETE can overtake the POST and receive 404 unless cancellation
intent is retained. Duplicate POSTs for the same operation must be idempotent;
reuse with a different chat/message/mode/writer fingerprint must be rejected.
Records need bounded retention/GC. A SQLite receipt is preferable if Stop must
survive browser/server restart and POST retry; a process-local tombstone only
solves same-process reordering.

Keep the existing job-ID header/frame for streaming and backward-compatible
reattach. The job ID remains a server execution identifier; the operation ID
is the pre-handoff intent identifier.

### 3. Make cancellation an acknowledged lifecycle, not fire-and-forget

Return a typed disposition such as `cancelled`, `cancelling`,
`already_completed`, `rejected`, or `unknown`. A positive response must state
whether the job merely received an abort signal or the runner has settled and
released the chat slot. If settlement remains asynchronous, expose a status
read/terminal event keyed by operation ID.

The UI should retain a chat-scoped **Stopping** state until the server confirms
one of the required terminal outcomes. A 401/423/5xx response or transport
failure must remain retryable and visible; it must not be translated to local
success.

### 4. Retain Stop intent on the client

In `requestServerChatGeneration`:

- set an operation-level `stopRequested` flag before aborting/cancelling the
  viewer;
- issue cancel by the preassigned operation ID, independently of whether
  `durableJobId` is populated;
- do not bind the cancellation request to the already-aborted viewer signal;
- do not clear the operation merely because the initial POST returned
  `aborted`;
- if the job header/frame arrives later, reconcile it to the same operation and
  avoid starting or cancelling the wrong job; and
- retry cancellation with bounded backoff and lifecycle/online wakeups until
  cancellation is acknowledged or POST rejection/completion is authoritative.

For the mobile/process-eviction guarantee implied by this audit, persist an
unacknowledged Stop intent in the encrypted mutation outbox or a dedicated
bounded recovery store. On reload, cancellation intent must take precedence
over automatic reattach for the same operation.

### 5. Close server transition gaps

- Check operation cancellation immediately before job creation and again
  before provider dispatch, including after awaited preflight work.
- Extend `GenerationJobRegistry` from only `chatId -> jobId`
  ([generationJobs.ts:48-82](../../../server/fastify/src/generationJobs.ts#L48-L82))
  to operation lookup/state as well.
- Make create/register/viewer-attach/runner-track failure-safe. If response
  attachment throws after registration, abort and remove the job and release
  its chat/operation claims.
- Preserve the intended cancel semantics: no-token cancel persists no assistant
  row; streaming cancel persists only the allowed raw partial; a job that
  completed before Stop reports `already_completed` and triggers authoritative
  reconciliation rather than claiming it was cancelled.

### 6. Keep explicit Stop distinct from passive disconnect

Do not change the server's useful detach-on-network-loss behavior. The client
needs separate signals/state for:

- viewer transport loss (detach and reattach), and
- explicit user cancellation (durable operation cancel).

The original pre-Fastify core flow did not have MS-04 because Stop directly
aborted the provider request: the screen created an `AbortController`, passed
it to `sendChat`, and Stop aborted it
([legacy DefaultChatScreen.svelte:303-334](../../../../Risuai/src/lib/ChatScreens/DefaultChatScreen.svelte#L303-L334)).
The job-ID handoff gap was introduced by the detached durable-job architecture,
so preserving the old immediate Stop contract now requires the new operation
protocol rather than reverting detach durability.

## How should the fix be validated?

### Acceptance invariants

Every validation case should assert all of these views, not only that a DELETE
function was called:

1. visible transcript and Stop/Stopping UI;
2. browser generation activity, reattach state, and pending cancellation
   intent;
3. bootstrap active jobs/operation state and the per-chat submission lock;
4. authoritative server transcript and generation-finalization retry rows; and
5. provider abort/completion count plus relevant command events/side effects.

For Stop before the first provider token, the final invariant is: no full
assistant reply, no ordinary post-generation effects, no active job, no
pending cancellation record, and no stuck chat slot. For Stop after tokens,
the authoritative row must match the documented raw-partial policy exactly.

### Client unit tests

Add cases to
`src/ts/process/request/tests/serverChat.test.ts` with a deferred POST fetch:

1. Capture the outgoing operation ID, leave the POST promise unresolved, abort,
   and assert cancel-by-operation is issued even though no response/job header
   exists.
2. Resolve the POST only after Stop with a matching job header; assert the same
   operation is reconciled and no duplicate job or unrelated cancellation is
   produced.
3. Reject the POST conclusively before server acceptance; assert the pending
   Stop intent is cleared without a spurious cancellation failure.
4. Make cancel return 423, 500, and a network exception; assert state remains
   `stopping`, a retry is scheduled, and active job knowledge is not forgotten.
5. Return `already_completed`; assert an authoritative transcript read occurs
   and the UI does not claim cancellation.
6. Preserve existing behavior for known-ID reattach, non-durable requests, two
   simultaneous chats, and exactly-once cancellation callbacks.

Update the current test that explicitly expects cancellation fetch failures to
be swallowed
([serverChat.test.ts:1435-1444](../../../src/ts/process/request/tests/serverChat.test.ts#L1435-L1444)).

### Server unit/integration tests

Add deterministic interleavings around the operation registry and the real
Fastify route:

1. **Cancel wins:** DELETE the operation before POST registration; POST must
   return the same cancelled operation and never call the provider.
2. **Create wins:** pause after operation-to-job binding but before dispatch;
   DELETE must abort that exact job and release the chat slot after settlement.
3. **Initial response withheld:** let the server create/start the job while a
   test reverse proxy buffers the response head from the browser. Abort/cancel
   from a second request, then release the buffered response. Assert the
   provider cannot complete normally and no full reply is persisted.
4. **Duplicate POST:** replay the same operation/body and assert one job/one
   provider call. Reuse the ID with a changed chat/message/mode/writer and
   assert rejection.
5. **Cancel status:** test running, already-cancelled, completed, unknown,
   expired, stale-writer, and unauthenticated dispositions.
6. **Persistence failure:** inject raw-cancel finalization enqueue/persist
   failure and ensure it is represented in operation status rather than hidden.
7. **Attach failure:** throw during initial response attachment and assert no
   registry job, chat lock, runner, or operation reservation is stranded.
8. **Shutdown/GC:** cancellation and operation records settle before SQLite
   close and remain bounded after retention expiry.

Continue asserting the successful post-ID behavior already covered by the
server suite: DELETE emits a terminal frame to an observer
([durableGeneration.test.ts:1137-1168](../../../server/fastify/__tests__/durableGeneration.test.ts#L1137-L1168))
and streaming cancellation persists the intended partial text
([durableGeneration.test.ts:1273-1297](../../../server/fastify/__tests__/durableGeneration.test.ts#L1273-L1297)).

### Production-stack browser/mobile tests

Add a Playwright path with a controllable proxy or server test hook that delays
only the initial `/generate/chat` response head after server acceptance:

1. send a normal composer message;
2. wait for server-side operation/job acceptance without allowing the header to
   reach the page;
3. press Stop;
4. exercise online, offline/online, pagehide/pageshow, reload, and simulated
   process loss while cancellation is unacknowledged;
5. release the initial response; and
6. assert the five acceptance views above after all hydration/event traffic
   settles.

Repeat after the header, after `job_accepted`, before the first token, after a
partial token, and after persistence but before the terminal/resource event.
Run two chats concurrently and prove Stop for Chat A neither cancels nor blocks
Chat B.

### Baseline verification performed during this investigation

The current suites pass but do not exercise the failing interval:

- `pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts` — 57/57
  passed.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts
  server/fastify/__tests__/durableGeneration.test.ts -t "..."` — 5 selected
  post-ID/disconnect tests passed, 35 skipped by the filter.

Those results confirm the existing after-ID contract and the deliberate
disconnect/detach behavior; they do not weaken MS-04.

## Additional issues not documented in the consolidated audit

### Confirmed: post-ID cancellation is unacknowledged and silently lossy

This is separate from the pre-ID gap. Once `durableJobId` exists, the abort
handler marks it cancelled locally and invokes `cancelServerChatGeneration`
with `void`
([serverChat.ts:523-530](../../../src/ts/process/request/serverChat.ts#L523-L530)).
That helper:

- returns `Promise<void>` rather than a cancellation outcome;
- only logs `response.ok`, so 401/423/5xx is treated the same as success; and
- catches and suppresses fetch failure
  ([serverChat.ts:235-261](../../../src/ts/process/request/serverChat.ts#L235-L261)).

Abort settlement then forgets the active job and resolves the local lifecycle
without waiting
([serverChat.ts:673-682](../../../src/ts/process/request/serverChat.ts#L673-L682)).
If DELETE was lost or rejected, the server job continues and persists just as
in MS-04. The test suite currently codifies the suppression of a network
failure rather than exposing/retrying it
([serverChat.test.ts:1435-1444](../../../src/ts/process/request/tests/serverChat.test.ts#L1435-L1444)).

The server response is also only an abort-request acknowledgement: it calls
`job.abortController.abort()` and immediately returns `{ success: true }`, while
the runner performs partial persistence and releases the per-chat lock later
([generationChat.ts:4078-4096](../../../server/fastify/src/routes/generationChat.ts#L4078-L4096),
[generationChat.ts:3857-3866](../../../server/fastify/src/routes/generationChat.ts#L3857-L3866)).
Moreover, raw-cancel persistence catches every exception without reporting it
([generationChat.ts:3573-3590](../../../server/fastify/src/routes/generationChat.ts#L3573-L3590)).

Under the consolidated audit's severity definition, this is **High**: an
explicit cancellation can fail after the ID is known. It should be fixed by the
same acknowledged operation lifecycle, but it should not be considered closed
merely by adding a preassigned ID.

### Related hardening observations, not promoted to confirmed findings

- The server registers the chat/job before attaching the initial viewer and
  tracks the runner only afterward
  ([generationChat.ts:3907-3924](../../../server/fastify/src/routes/generationChat.ts#L3907-L3924)).
  A synchronous response-write/attachment failure in between could leave a
  registered job with no tracked runner until GC. This is directly suggested
  by ordering but was not reproduced, so it should receive a fault-injection
  test rather than a severity assignment.
- The returned token stream's `cancel()` callback resolves terminal state and
  clears progress but does not cancel the durable job or remove the abort
  listener
  ([serverChat.ts:948-953](../../../src/ts/process/request/serverChat.ts#L948-L953)).
  The normal Stop path also aborts the owning signal and therefore reaches
  DELETE, but a consumer-only cancellation/error can detach local processing
  while the job continues. The intended policy for that non-Stop path needs an
  explicit test and contract.

No other additional issue was promoted: same-chat accepted-send attribution,
process-memory recovery, replay truncation, finalization retry truthfulness,
and reattach-state problems observed around this code are already represented
by MS-01, MS-02, MS-03, MS-05, MS-06, MS-07, or MS-08 in the consolidated
audit.
