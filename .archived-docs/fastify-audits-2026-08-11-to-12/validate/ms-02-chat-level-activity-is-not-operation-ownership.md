# MS-02 validation: chat-level activity is not operation ownership

Investigated: 2026-08-11  
Consolidated finding: [MS-02](../fastify-multichat-mobile-stability-audit-2026-08-11.md#ms-02--chat-level-activity-is-not-operation-ownership)  
Audit revision: `9afde4658ea5b277493e9d7f6ef7aaf387544165`  
Validation revision: `e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`  
Severity: **High**  
Confidence: **Confirmed**

The relevant source files are unchanged between the audit and validation
revisions. The only intervening repository commit changes the Playwright
version.

## Executive conclusion

MS-02 is real and reachable. The accepted-send coordinator knows the exact
accepted user-message ID, but the generation protocol does not carry that ID
or a client operation ID. When generation returns `false`, the coordinator
therefore uses this invalid implication:

> some message-generation activity exists for chat C, therefore the job for
> this particular accepted message in chat C reached the server

That implication is false whenever two send operations for the same chat
overlap. A local Plugin V3 race can produce the overlap without reaching the
server twice. A stale or mobile network can also hide the typed body of a
correct server-side `409 generation_in_progress`, after which bootstrap exposes
the older job only by chat ID. In both cases the coordinator returns
`{ status: 'generated' }`, does not create a recovery record, and may leave a
durably accepted user row with no reply.

The transcript snapshot fence prevents an older job from writing a reply over
a newer transcript. That is an important data-integrity safeguard, but it
cannot tell the browser which accepted operation owns a job. In the affected
sequence it can cause the older generated response to be rejected while the
new accepted row is simultaneously misreported as handled.

The correct fix is end-to-end send lineage: a client-created operation ID and
the accepted user-message ID must be carried through append acceptance,
generation submission, the server job, `job_accepted`, bootstrap, reattach,
cancellation, finalization, and recovery. A chat ID can remain the concurrency
scope, but it must not be used as proof of operation ownership.

## Scope and method

The investigation traced:

- composer and Plugin V3 append entry points;
- durable append settlement and coordinator deduplication;
- local generation activity acquisition and release;
- generation request and SSE error classification;
- Fastify job creation, bootstrap projection, reattach, cancellation, and
  finalization fencing;
- existing frontend and Fastify tests;
- historical behavior in `/home/codex/Risuai`; and
- nearby same-chat recovery paths for additional undocumented issues.

The source trace was cross-checked with parallel read-only investigations of
the frontend race, server identity contract, tests, transport behavior, and
legacy implementation. The conclusions below were reconciled against the
current files rather than copied from worker output.

Focused current tests were also run:

- 91 frontend tests passed across the accepted-send coordinator/recovery,
  Plugin V3 bridge, and slash-command resource-guard suites.
- 45 Fastify tests passed across durable generation and bootstrap.

Those passing tests validate existing behavior; they do not cover the
operation-ownership interleavings that produce MS-02.

No physical mobile session or live provider call was used.

## What exactly is the bug?

### The client has exact append identity, then drops it at generation

`appendCurrentChatUserMessageForSend` ensures a stable message ID, pushes the
optimistic row, dispatches the durable message command, and returns the
accepted ID in either an immediate or queued result
([chatCommands.ts:5019-5118](../../../src/ts/chatCommands.ts#L5019)).

The coordinator preserves that ID in `AcceptedGenerationRequest` and keys its
in-memory operation map by chat target plus message ID
([acceptedSendCoordinator.svelte.ts:39-80](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L39)).
Two accepted rows in one chat are therefore correctly treated as two distinct
client operations.

However, `attemptGeneration` passes only the target and presentation options to
`sendChat`; it does not pass `messageId` or the coordinator operation ID
([acceptedSendCoordinator.svelte.ts:114-137](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L114)).
The server-backed request then derives `userMessage` from whichever user row is
last in the live chat at that later moment
([serverBackedSendChat.ts:430-455](../../../src/ts/process/serverBackedSendChat.ts#L430)).

This means the local activity owner and the accepted row used for prompt
assembly are not causally bound. Text is not a safe substitute for identity:
it is not unique, and concurrent appends can change the tail.

### The server protocol has no accepted-send lineage

The current identity contract is:

| Boundary | Identifiers carried | Missing ownership data |
| --- | --- | --- |
| Accepted append result | chat target, accepted `messageId` | independent durable operation record |
| `ServerChatInput` / POST body | `chatId`, `characterId`, mode, user-message text, optional regenerate target | accepted user-message ID, client operation ID |
| Server `StreamJob` | generated `jobId`, `chatId`, writer session, mode, optional regenerate target | accepted user-message ID, client operation ID |
| `job_accepted` / response header | `jobId` | source operation/message ID |
| Bootstrap `activeGenerationJobs` | `chatId`, `jobId`, mode, optional regenerate target | source operation/message ID |
| Final assistant row/retry record | generated job/generation ID and transcript snapshot | explicit source user-message/operation ID |

The client request type contains no source ID
([serverChat.ts:81-103](../../../src/ts/process/request/serverChat.ts#L81)),
and the Fastify request body, validation, and assembler mapping contain no such
field
([generationChat.ts:131-145](../../../server/fastify/src/routes/generationChat.ts#L131),
[generationChat.ts:601-709](../../../server/fastify/src/routes/generationChat.ts#L601)).

The job registry projects only chat/job identity, mode, and an optional
regenerate target
([generationJobs.ts:84-115](../../../server/fastify/src/generationJobs.ts#L84)).
The browser parser mirrors that same lossy shape
([bootstrap.ts:7-18](../../../src/ts/server/bootstrap.ts#L7),
[bootstrap.ts:231-249](../../../src/ts/server/bootstrap.ts#L231)).
`job_accepted` also contains only `jobId`
([serverChatEvents.ts:26-33](../../../src/ts/process/request/serverChatEvents.ts#L26),
[generationChat.ts:2557-2581](../../../server/fastify/src/routes/generationChat.ts#L2557)).

Consequently, no current client or server function can prove that an active
job belongs to a particular accepted user row.

### The unsafe proof is explicitly implemented

After `sendChat` returns `false`, `acceptedGenerationReachedServer` refreshes
bootstrap. It correctly refuses the shortcut when it received the exact typed
`generation_in_progress` cause, but otherwise returns success for any known
message job or activity in the chat
([acceptedSendCoordinator.svelte.ts:146-179](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L146)).

`isChatGenerationKnown` combines:

- any local message-generation activity with that `chatId`; and
- any bootstrap/remembered job with that `chatId`.

It compares neither an accepted message ID nor an operation ID
([reattach.ts:66-71](../../../src/ts/process/reattach.ts#L66)).

The local registry is intentionally chat-keyed. A second normal `sendChat(-1)`
for the same chat returns `false` before it reaches the server and does not
report a typed failure
([generationActivity.svelte.ts:22-63](../../../src/ts/process/generationActivity.svelte.ts#L22),
[index.svelte.ts:230-265](../../../src/ts/process/index.svelte.ts#L230)).
That generic local failure is therefore eligible for the unsafe proof.

### The typed 409 safeguard is narrower than the failure modes

The server correctly enforces one running job per chat and returns
`409 generation_in_progress` before creating a second job
([generationChat.ts:3899-3920](../../../server/fastify/src/routes/generationChat.ts#L3899)).

The browser preserves the machine code only when it receives a non-OK response
whose JSON body can be parsed. A fetch rejection yields only a generic network
error, and an unreadable/non-JSON response body yields only the HTTP fallback
([serverChat.ts:264-359](../../../src/ts/process/request/serverChat.ts#L264)).
Only the parsed code becomes a typed `SendChatFailure`
([sendChatFailure.ts:1-9](../../../src/ts/process/sendChatFailure.ts#L1),
[serverBackedSendChat.ts:496-512](../../../src/ts/process/serverBackedSendChat.ts#L496)).

The code therefore behaves safely for a fully received typed 409, but
unsafely when transport failure, body loss, proxy replacement, or parsing
failure hides the body. The unsafe conclusion is based on the error's transport
shape rather than ownership evidence.

## What is not broken

The following adjacent mechanisms should be retained:

- Different chats can generate concurrently while each chat remains
  single-flight locally and on the server.
- A fully parsed `generation_in_progress` response produces an explicit
  accepted-send recovery instead of being cleared by the older chat job.
- Stable target IDs prevent a navigation from redirecting an accepted send to
  another chat.
- The server transcript snapshot fence prevents a completed job from blindly
  overwriting a transcript that changed during generation.
- The authoritative transcript probe requires an assistant row immediately
  after the accepted user row; it does not accept any later assistant row as
  proof
  ([acceptedSendRecoveryState.ts:23-35](../../../src/ts/process/acceptedSendRecoveryState.ts#L23)).

These safeguards limit corruption, but none establishes job-to-send lineage.

## How does the bug affect users?

### Primary impact

A user's message can be durably present while no generation is responsible for
it. The coordinator nevertheless reports success and creates no retry record.
The chat can then show a user-only tail indefinitely.

For the normal composer, a false `generated` result runs successful-send side
effects such as reroll bookkeeping
([DefaultChatScreen.svelte:881-918](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L881)).
For Plugin V3, `sendChat(message)` resolves `true`, so plugin code is told the
send completed even though its accepted row may be orphaned
([v3.svelte.ts:1898-1908](../../../src/ts/plugins/apiV3/v3.svelte.ts#L1898)).

The recovery banner is driven only by an `acceptedSendRecoveries` entry. The
false success path never inserts one, so the user receives no **Retry reply**
affordance
([acceptedSendCoordinator.svelte.ts:167-179](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L167),
[DefaultChatScreen.svelte:2234-2254](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2234)).

### Secondary impact

- An older provider response may be generated and billed but rejected at
  finalization because the transcript changed.
- A plugin or UI workflow may proceed on a false success result.
- Later hydration can faithfully display the reply-less authoritative
  transcript, but it has no missing operation record from which to restart the
  reply.
- Mobile suspension and unstable networks make the hidden-409 variant more
  likely because response bodies can disappear while server state remains.
- Users can retry manually by sending more text, which creates another row
  rather than completing the original accepted operation.

The bug does not normally delete the accepted user row. It is an ownership and
availability failure: durable input survives, while the reply handoff and
recovery truth are lost.

## In what sequence does the bug occur?

### Sequence A: two concurrent Plugin V3 sends in one browser

1. Two Plugin V3 calls capture the same chat and independently await permission.
2. Both call `isChatGenerationKnown(chatId)` before either generation activity
   begins, so both prechecks pass
   ([v3.svelte.ts:1864-1896](../../../src/ts/plugins/apiV3/v3.svelte.ts#L1864)).
3. Each calls `appendCurrentChatUserMessageForSend`. Each row receives a distinct
   message ID and a distinct durable mutation. The durable dispatcher can
   serialize the commands, but it does not coalesce the operations.
4. Each accepted result enters `coordinateAcceptedChatSend`. Because the
   operation key includes `messageId`, the calls are correctly distinct
   ([acceptedSendCoordinator.svelte.ts:188-221](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L188)).
5. Each coordinator waits 10 ms before starting generation
   ([acceptedSendCoordinator.svelte.ts:114-123](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L114)).
6. One `sendChat` call acquires the chat activity. The other observes that
   activity and returns `false` locally without a typed
   `generation_in_progress` cause.
7. The losing coordinator refreshes bootstrap and calls
   `isChatGenerationKnown(chatId)`. The winning local activity alone is enough
   for `true`.
8. The losing coordinator returns `generated`, skips the transcript proof, and
   creates no recovery.
9. Only one generation can run. At least one accepted row has no independently
   owned generation.

There is an important nuance beyond the consolidated audit wording. The row
that becomes orphaned is not necessarily the call that lost the local activity
lease. The winning call does not carry its accepted message ID into `sendChat`;
it rereads the live tail later. If both rows are already visible, the server
request can target the newer tail even when the earlier coordinator acquired
the lease. If the second row arrives after the server captured its snapshot,
the finalization fence can reject the winning job instead. The exact stranded
row is scheduling-dependent; the ownership failure is not.

The historical app avoided this particular same-runtime Plugin V3 race with a
global `doingChat` check before append followed synchronously by setting that
global lock in `sendChat` (`/home/codex/Risuai/src/ts/plugins/apiV3/v3.svelte.ts:1276-1322`,
`/home/codex/Risuai/src/ts/process/index.svelte.ts:212-219`). That design also
blocked legitimate cross-chat concurrency. The Fastify port correctly replaced
the global lock with chat-scoped activity, but left the asynchronous append and
generation handoff outside one atomic ownership boundary.

### Sequence B: an older remote job plus a hidden 409 body

1. Job A is already running for chat C, commonly from another browser/session.
2. The current browser does not yet know about A, so a send precheck passes.
3. User message B is durably appended to chat C.
4. The browser POSTs a generation request for B.
5. Fastify sees A in `runningByChat` and correctly returns
   `409 generation_in_progress`.
6. The connection fails or the response body cannot be parsed. The request
   layer returns a generic error instead of the typed cause.
7. `sendChat` returns `false`; its own local activity is released.
8. The coordinator refreshes bootstrap. Bootstrap exposes A as
   `{ chatId: C, jobId: A, ... }`, with no accepted-message/operation lineage.
9. `isChatGenerationKnown(C)` returns `true`, so B is reported as generated and
   receives no recovery entry.
10. A cannot safely cover B if B was appended after A's snapshot. Finalization
    requires the live transcript length and tail/target to match the captured
    snapshot and rejects stale state
    ([generationChat.ts:1734-1792](../../../server/fastify/src/routes/generationChat.ts#L1734),
    [generationChat.ts:2727-2770](../../../server/fastify/src/routes/generationChat.ts#L2727)).

If the complete typed 409 body reaches the browser, step 9 does not happen:
the explicit exception at coordinator line 156 preserves a retryable warning.
That is why a happy-path 409 test cannot validate MS-02.

### Sequence C: authoritative transcript proof

When no job is known, the coordinator fetches the authoritative suffix from the
accepted message and checks for an adjacent assistant row
([acceptedSendCoordinator.svelte.ts:159-164](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L159)).
That proof is substantially stronger than the chat-activity shortcut and is
not the cause of MS-02. A safe interim patch can remove the chat-level shortcut
and keep this exact transcript check, accepting a conservative warning when job
lineage is unavailable.

## Root causes

MS-02 has five connected causes:

1. **Split durability boundary.** User append and generation launch are separate
   requests with a client-memory handoff between them.
2. **Missing protocol lineage.** Accepted message and client operation IDs do
   not cross the generation boundary.
3. **Late tail reread.** `sendChat` derives send content from the current chat
   tail instead of the coordinator's accepted row.
4. **Chat-level inference.** Recovery treats same-chat activity as per-operation
   proof.
5. **Transport-dependent semantics.** A parsed 409 is safe, while the same
   server decision with a lost/unparseable body is misclassified.

`expectedRevision`, writer-session identity, message text, and chat ID cannot
replace a send operation ID. They answer different questions: database
freshness, writer authority, content, and concurrency scope respectively.

## What changes are needed to fix it?

### Required correctness invariants

The implementation should enforce all of these:

1. Every accepted user row has one stable send operation ID.
2. A generation job records the exact accepted message and operation that
   caused it.
3. Only an exact matching job, or an authoritative reply proven for that
   accepted message, may settle the operation as generated.
4. An unrelated same-chat job may block or queue the operation, but may never
   clear it.
5. A local lease failure must be an explicit busy/recovery outcome, not generic
   `false` followed by chat-level inference.
6. Same-operation retries are idempotent and return the existing operation/job
   rather than starting a duplicate.
7. Older servers/jobs that lack lineage are treated conservatively as
   unrelated for accepted-send settlement.

### Preferred design: one idempotent append-and-launch operation

The strongest fix is a server-owned send endpoint/state machine:

1. The client creates `operationId` before any mutation and gives the user row
   an `acceptedMessageId`.
2. One idempotent server command validates the chat, same-chat policy, writer,
   operation receipt, and message ID; then atomically appends the user row and
   records a pending generation operation.
3. The server launches or queues the job from that durable record.
4. Repeating the same `operationId` returns the same accepted message and job
   state. A different operation for a busy chat is rejected before append or
   durably queued by explicit product policy.
5. The operation ends only as matching-job accepted, matching reply persisted,
   explicit recoverable failure, or explicit terminal rejection.

This design closes the process-loss gap in MS-01 at the same boundary and makes
same-chat serialization work across tabs and clients, not only inside one
JavaScript runtime.

A durable operation record could minimally contain operation ID, chat ID,
accepted message ID, writer/lineage scope, state, job ID, timestamps, and
terminal error/recovery metadata. The exact schema is an implementation choice;
the invariant is that append acceptance and reply intent cannot become
indistinguishable.

### Minimum safe protocol if append and launch remain separate

If the endpoint cannot be unified immediately:

- Generate `operationId` before append and persist it with the pending append
  intent.
- Add `acceptedMessageId` and `operationId` to `SendChatArgs`,
  `ServerChatInput`, `ChatRequestBody`, `AssembleInput`, and validation.
- For `mode: 'send'`, have the server verify that the identified row exists,
  belongs to the chat, is a user row, has the expected content, and is the
  eligible tail for this operation before provider work begins. Do not silently
  retarget to the current tail.
- Put both IDs on `StreamJob`, the per-chat running index value,
  `activeGenerationJobs`, `job_accepted`, and any job-ID response metadata.
- Retain both IDs in finalization and retry records and, preferably, record the
  source message ID on the generated assistant metadata.
- Make the browser's remembered job and bootstrap parser preserve the lineage.
- Replace `isChatGenerationKnown(chatId)` as an accepted-send proof with an
  exact predicate such as
  `findGenerationForAcceptedSend(chatId, operationId, acceptedMessageId)`.
- Classify the local activity-lease denial as a typed busy result. It should
  queue or record recovery, never be converted to success by another activity.
- Hold a same-chat preparation/handoff reservation until the accepted operation
  has a matching activity/job, an explicit recovery, or a terminal result.

The existing server one-job-per-chat lock may remain keyed by chat. Its value,
job record, and projections must carry operation lineage.

### Immediate containment

Before the full protocol lands, the safe failure mode is preferable to false
success:

1. Remove `if (isChatGenerationKnown(chatId)) return true` from accepted-send
   settlement.
2. Keep the exact adjacent-reply transcript probe.
3. Treat any active same-chat job without exact lineage as unrelated and retain
   a retryable recovery.
4. Add a same-chat client reservation before append for Plugin V3 and the
   composer, while recognizing that only a server operation solves cross-client
   races.

This may show a conservative warning when a matching detached job actually
exists but cannot yet prove its lineage. That is recoverable and honest; the
current false success is not.

### Related files that must change together

At minimum, implementation work should cover:

- `src/ts/chatCommands.ts`
- `src/ts/process/acceptedSendCoordinator.svelte.ts`
- `src/ts/process/acceptedSendRecoveryState.ts`
- `src/ts/process/generationActivity.svelte.ts`
- `src/ts/process/index.svelte.ts`
- `src/ts/process/serverBackedSendChat.ts`
- `src/ts/process/request/serverChat.ts`
- `src/ts/process/request/serverChatEvents.ts`
- `src/ts/process/reattach.ts`
- `src/ts/server/bootstrap.ts`
- `src/ts/plugins/apiV3/v3.svelte.ts`
- normal composer and auxiliary handoff callers
- `server/fastify/src/streamJobs.ts`
- `server/fastify/src/generationJobs.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/generationFinalizationRetry.ts`
- corresponding client, server, UI, and browser tests.

MS-07 warning reconciliation and MS-04 early cancellation should consume the
same operation identity rather than inventing parallel correlation schemes.

## How should the fix be validated?

### Existing tests and their limits

The current coordinator test named “does not record a failure when foreground
refresh finds the detached job still running” explicitly makes any same-chat
job sufficient and asserts that the transcript probe is skipped
([acceptedSendCoordinator.test.ts:180-194](../../../src/ts/process/acceptedSendCoordinator.test.ts#L180)).
That test codifies the bug and must be replaced with two cases: exact matching
lineage succeeds; unrelated same-chat lineage remains recoverable.

Current Plugin V3 tests cover stale navigation, queued append settlement,
append failure, and a single generation failure, but not two concurrent calls
with distinct accepted message IDs
([v3.svelte.test.ts:773-905](../../../src/ts/plugins/apiV3/v3.svelte.test.ts#L773)).

The request tests prove that a complete JSON 409 preserves
`generation_in_progress`
([serverChat.test.ts:1352-1374](../../../src/ts/process/request/tests/serverChat.test.ts#L1352)).
They do not combine a lost/unparseable 409 body with an older bootstrap job.

The Fastify suite proves that an accepted append survives a same-chat 409 and
that bootstrap reports the older job, but the projection has no lineage and the
test stops before asserting the older job's stale finalization outcome
([durableGeneration.test.ts:1170-1201](../../../server/fastify/__tests__/durableGeneration.test.ts#L1170)).

### Unit and component tests

Add deterministic tests for:

1. A failed send plus a **matching** local activity/job settles as generated.
2. A failed send plus an **unrelated same-chat** local activity does not settle;
   it records recovery and still performs the transcript proof.
3. The same distinction for bootstrap jobs.
4. A fully typed 409, malformed 409 body, fetch rejection, and missing response
   body all preserve the operation unless matching lineage or reply proof exists.
5. Two coordinator requests in one chat with different message/operation IDs
   never deduplicate and never settle from each other's activity.
6. Two identical calls with the same operation ID are idempotent.
7. `sendChat` constructs its request from the supplied accepted message, not a
   later live tail.
8. Bootstrap and `job_accepted` parsing retain both lineage IDs and reject
   invalid shapes conservatively.
9. Older lineage-less jobs do not clear a new accepted operation.
10. The recovery banner is removed only by a matching job/reply; an unrelated
    same-chat job can coexist with it.

Add one Plugin V3 test using two deferred appends and `Promise.all`:

- both prechecks start before either append resolves;
- the appends return different message IDs;
- one generation/activity is held open;
- the second operation must be explicitly busy/queued/recoverable, not `true`;
- when policy permits sequential sends, each accepted message receives exactly
  one adjacent assistant reply in order.

Add a composer component test where the first append returns `queued`, the
user sends again before settlement, and the implementation either blocks the
second append or durably queues two explicitly owned operations. No duplicate
or unowned row is acceptable.

### Fastify integration tests

Use a gated provider and real SQLite commands to verify:

1. A valid append-and-launch returns the same operation/message/job lineage in
   the response, `job_accepted`, bootstrap, reattach, and persisted result.
2. Replaying the same operation ID returns the original state and never appends
   or launches twice.
3. Two different same-chat operations submitted concurrently follow the chosen
   policy atomically: either the second is rejected before append or it is
   durably queued. It must not leave an accepted row with no operation state.
4. A generation request naming a missing, non-user, wrong-chat, non-tail, or
   content-mismatched accepted message is rejected before provider dispatch.
5. Appending another row after job A's snapshot makes A fail its fence and
   leaves the later operation explicitly recoverable; it never reports that A
   owns the later row.
6. A duplicate finalization retry remains idempotent with the source lineage
   intact.
7. Continue and regenerate retain their existing target semantics while adding
   operation identity; cross-chat concurrency remains allowed.
8. A server restart or abandoned pending operation produces the MS-01 recovery
   state if durable operation storage is added.

### Transport and lifecycle tests

Build a controllable transport/proxy harness for four distinct boundaries:

- before the generation POST reaches Fastify;
- after Fastify returns a typed 409 but before the browser receives/parses its
  body;
- after a matching job is accepted but before response headers/body reach the
  browser; and
- after `job_accepted`, during the stream, and after persistence before the
  terminal frame.

For each boundary, test `visibilitychange`, `pagehide/pageshow`, offline/online,
reload, and simulated process loss. A matching bootstrap job may recover the
operation; an unrelated same-chat job must not.

### Production-stack browser matrix

Run at least these Playwright scenarios against built Fastify/SQLite:

- two concurrent Plugin V3 sends in one page;
- two rapid ordinary composer sends with the first append retained in the
  outbox;
- two browser contexts where an older job exists and the newer writer appends a
  row, with the 409 body dropped;
- one matching detached job and one unrelated older same-chat job;
- lifecycle suspension/reload before and after job acceptance; and
- Stop/retry behavior while unrelated same-chat work exists.

Every scenario must assert all of these views, not merely the API return value:

1. visible transcript;
2. client projection and activity registry;
3. authoritative server transcript;
4. durable operation/receipt and finalization state;
5. bootstrap job lineage;
6. accepted-send recovery records; and
7. provider dispatch count.

The final invariant is:

> For every durably accepted user message, exactly one of a matching live job,
> an adjacent persisted assistant reply, or a durable explicit recovery state
> exists. No unrelated same-chat job satisfies this assertion.

### Regression commands

During implementation, run focused tests first and the full quality lane before
merge:

```sh
pnpm exec vitest run \
  src/ts/process/acceptedSendCoordinator.test.ts \
  src/ts/process/acceptedSendRecoveryState.test.ts \
  src/ts/process/request/tests/serverChat.test.ts \
  src/ts/plugins/apiV3/v3.svelte.test.ts \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/durableGeneration.test.ts \
  server/fastify/__tests__/bootstrap.test.ts \
  server/fastify/__tests__/generation.chat.test.ts

pnpm test:all
```

## Additional issues not documented in the consolidated audit

### A-01 — The ordinary composer releases its same-chat preparation lock before handoff ownership exists

Severity: **High**  
Confidence: **Confirmed from reachable control flow**

MS-02 documents the two-call Plugin V3 race, but the normal composer has an
additional overlap window, especially when an append is retained/queued.

`sendMain` claims a same-chat preparation key before append
([DefaultChatScreen.svelte:1478-1493](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1478)).
After append it calls the fire-and-forget `handoffAcceptedSend` and returns
([DefaultChatScreen.svelte:1583-1605](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1583)).
Its `finally` immediately clears the composer-operation guard and releases the
preparation key
([DefaultChatScreen.svelte:1620-1622](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1620)).

The handoff does not await the coordinator
([DefaultChatScreen.svelte:881-918](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L881)).
For a queued append, the coordinator may wait arbitrarily for settlement before
starting generation; even an immediate append waits the intentional 10 ms
delay
([acceptedSendCoordinator.svelte.ts:114-123](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L114),
[acceptedSendCoordinator.svelte.ts:201-217](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L201)).

During that gap there is neither a preparation reservation nor a generation
activity. With a queued append, the visible composer is not cleared until the
settlement is accepted, so a second click can append the same draft again with
a new message ID. The two operations can then enter the same MS-02 ownership
race.

The fix is to transfer, not release, the preparation reservation: keep the chat
reserved until the exact operation owns a local/server job, reaches explicit
recovery, or terminates. Add the queued-double-send component test described
above.

### A-02 — Slash/STScript `/multisend` is another accepted-send recovery bypass

Severity: **Medium**  
Confidence: **Confirmed**  
Classification: **Undocumented expansion of MS-10, not a new root cause**

The consolidated audit lists DevTool Autopilot and PO file multisend under
MS-10, but the separate slash/STScript `/multisend` command also bypasses the
coordinator.

For each segment it mutates the chat through a fire-and-forget compatible
command, calls raw `sendChat(-1)`, ignores the boolean result, and continues
when the target remains selected
([command.ts:169-201](../../../src/ts/process/command.ts#L169),
[command.ts:339-345](../../../src/ts/process/command.ts#L339),
[chatCommands.ts:3706-3739](../../../src/ts/chatCommands.ts#L3706)).

If an append is queued or later rejected, generation is not coordinated with
its settlement. If a same-chat job is already active, `sendChat(-1)` can return
`false` and the loop can append later segments anyway, with no recovery entry.
Existing tests assert append order and call count but mock all `sendChat`
results; they do not assert accepted-settlement or recovery ownership
([command.resourceGuard.test.ts:500-580](../../../src/ts/process/__tests__/command.resourceGuard.test.ts#L500)).

Route this command through the same accepted-send state machine as the normal
composer and Plugin V3, and make each iteration wait for the owned operation's
terminal or explicit recovery outcome.

### A-03 — A stale reattach retry can be restored beside a newer same-chat job and make Stop target the wrong job

Provisional severity: **High**  
Confidence: **Medium; source-reachable race, timing harness still required**

This is distinct from MS-02. It does not settle an accepted row from an
unrelated job; it can corrupt the client job list after a reattach race and
temporarily direct cancellation at a stale job.

Reachable sequence:

1. Client reattaches job A and removes A from `activeGenerationJobs`.
2. The reattach encounters a retryable transport failure.
3. While it is in flight, A completes, the server releases the chat lock, and
   job B starts for the same chat. A lifecycle bootstrap refresh replaces the
   client list with `[B]`.
4. A's failed reattach runs `restoreJob`. That helper deduplicates by A's job ID
   only, so it prepends A without removing the newer same-chat B, producing
   `[A, B]`
   ([reattach.ts:153-205](../../../src/ts/process/reattach.ts#L153)).
5. Reattach selection and the Stop fallback both use the first job matching the
   chat. They choose stale A
   ([reattach.ts:157-164](../../../src/ts/process/reattach.ts#L157),
   [index.svelte.ts:146-164](../../../src/ts/process/index.svelte.ts#L146)).
6. DELETE addresses only A. A may already be done or expired, while B continues
   generating
   ([generationChat.ts:4078-4096](../../../server/fastify/src/routes/generationChat.ts#L4078)).

The server explicitly releases a completed job's same-chat lock before its
30-second reattach grace ends, so A and a newer running B can legitimately
coexist in the server registry
([generationChat.ts:3854-3865](../../../server/fastify/src/routes/generationChat.ts#L3854)).

`restoreJob` should be projection-epoch-aware and must not restore A over a
newer authoritative same-chat job. At minimum it should apply the same chat-ID
deduplication as `rememberActiveGenerationJob`; a stronger fix compares the
bootstrap generation/refresh epoch captured before the reattach. Add a gated
A-completes/B-starts/bootstrap-refresh/A-retry-fails test and assert that Stop
cancels B.

## Final assessment

MS-02 should remain **High / Confirmed**. The current code has exact accepted
message identity on the browser side, but no end-to-end lineage through the
generation job. Chat-level activity is sufficient for concurrency exclusion;
it is not sufficient for success, recovery, reattach, or cancellation
ownership.

The immediate containment is to stop treating an uncorrelated same-chat job as
success. The durable fix is a single idempotent send operation whose identity
survives append, launch, stream, bootstrap, finalization, recovery, and reload.

Co-Authored-By: Codex <noreply@openai.com>
