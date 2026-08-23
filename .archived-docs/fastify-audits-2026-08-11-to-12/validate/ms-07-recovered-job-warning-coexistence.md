# MS-07 validation: recovered job and accepted-send warning coexistence

Validated: 2026-08-11  
Consolidated finding: [MS-07](../fastify-multichat-mobile-stability-audit-2026-08-11.md#ms-07--recovery-warning-and-recovered-job-can-coexist-incorrectly)  
Audit baseline: `9afde4658ea5b277493e9d7f6ef7aaf387544165`  
Validation revision: `e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`  
Result: **confirmed; still present**  
Severity: **Medium**  
Confidence: **High**

## Executive conclusion

MS-07 is a real client-state reconciliation bug. After a user message has been
durably accepted, the browser can conclude that reply startup failed and record
an actionable accepted-send recovery. The server may nevertheless have accepted
and continued the generation. A later `online`, `pageshow`, foreground, or full
resource refresh can discover and reattach that job without updating the
accepted-send recovery. The chat then simultaneously presents:

- an error alert saying that the reply could not be started, with a **Retry
  reply** action; and
- an active generation/Stop control and, once replay arrives, a visibly
  streaming reply.

The two facts live in independent stores. The recovery has the accepted user
message ID, while the active-job projection has only the chat ID and job ID.
There is therefore no safe join that proves that a discovered job owns a
particular recovery. Clearing by chat ID would conceal a legitimate warning
when the running job belongs to an older send, which is the separate MS-02
failure.

This is primarily a false and unsafe recovery-state defect, not direct
server-side transcript loss. It is particularly likely during mobile
suspension and network transitions because the server deliberately detaches a
lost viewer while allowing the durable generation to continue.

The investigation also confirmed one additional, previously unstated
manifestation of the same missing-identity defect: **Retry reply is not bound to
the recovered message**. If the transcript advances before Retry is clicked,
the retry generates from the current tail and then removes the older recovery
on a generic `true` result. The originally accepted row can remain unreplied.
This is detailed under [Additional issue discovered](#additional-issue-discovered).

## What exactly is the bug?

### The recovery side

An accepted-send recovery contains an operation-shaped ID, a stable chat target,
the accepted `messageId`, the failure cause, and a `retrying` flag
([acceptedSendRecoveryState.ts:7-16](../../../src/ts/process/acceptedSendRecoveryState.ts#L7)).
The coordinator derives that operation ID from the target and message ID
([acceptedSendCoordinator.svelte.ts:51-56](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L51)),
and records a recovery after both generation and the immediate server probes
fail
([acceptedSendCoordinator.svelte.ts:146-179](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L146)).

The recovery is process-memory only. Once present, it is removed by:

1. a retry that reports success;
2. a retry whose post-failure probe reports that generation reached the server;
   or
3. authoritative chat hydration that finds an assistant row immediately after
   the accepted user row
   ([acceptedSendCoordinator.svelte.ts:233-257](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L233),
   [acceptedSendRecoveryState.ts:58-66](../../../src/ts/process/acceptedSendRecoveryState.ts#L58)).

Discovering or reattaching a live job is not one of those transitions.

### The job side

The browser's active-job shape contains `chatId`, `jobId`, mode, and an optional
regenerate target. It contains neither the accepted user-message ID nor a client
operation ID
([bootstrap.ts:7-18](../../../src/ts/server/bootstrap.ts#L7)). The server stores
the same limited identity on its transient job
([streamJobs.ts:56-69](../../../server/fastify/src/streamJobs.ts#L56)) and exposes
the same limited bootstrap projection
([generationJobs.ts:84-115](../../../server/fastify/src/generationJobs.ts#L84)).

Lifecycle refresh replaces `activeGenerationJobs` and then queues reattach
([reattach.ts:234-269](../../../src/ts/process/reattach.ts#L234)). Reattach finds
the open chat's job by `chatId`, consumes it while opening the stream, and
creates normal chat generation activity
([reattach.ts:153-209](../../../src/ts/process/reattach.ts#L153)). It never reads,
matches, updates, suppresses, or removes `acceptedSendRecoveries`.

### The UI combines both states without reconciling them

The chat derives `currentAcceptedSendRecovery` only by target key
([DefaultChatScreen.svelte:255-259](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L255)).
Separately, it treats either a local message-generation activity or any
bootstrap job for the chat as active generation
([DefaultChatScreen.svelte:347-357](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L347)).
The two independent selectors render the recovery alert and Retry button
([DefaultChatScreen.svelte:2234-2254](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2234))
alongside the generation pulse/Stop button
([DefaultChatScreen.svelte:2316-2324](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2316)).

That combination is the bug. Neither selector is individually inconsistent;
the missing ownership reconciliation between them is.

## Exact code sequence

The clearest confirmed sequence is a server-accepted generation whose initial
response never becomes visible to the browser.

1. **The user row is accepted first.** The composer appends the message and
   hands the returned stable message ID to `coordinateAcceptedChatSend`
   ([DefaultChatScreen.svelte:1583-1604](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1583)).
   The coordinator waits for a queued append to settle when necessary, calls
   the append-accepted callback, and starts generation for the captured chat
   target
   ([acceptedSendCoordinator.svelte.ts:188-221](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L188)).

2. **The server creates a durable job before the browser necessarily learns its
   ID.** The server creates the job, enables replay, records only chat/mode
   metadata, claims the per-chat slot, attaches the initial viewer, and starts
   the detached runner
   ([generationChat.ts:3876-3943](../../../server/fastify/src/routes/generationChat.ts#L3876)).
   The SSE response carries the job ID in both a header and `job_accepted`
   ([generationChat.ts:2557-2581](../../../server/fastify/src/routes/generationChat.ts#L2557)).

3. **A mobile/network transition loses the response before `fetch` exposes the
   response object.** A fresh request does not know `durableJobId` until after
   `openChatResponse` succeeds
   ([serverChat.ts:507-550](../../../src/ts/process/request/serverChat.ts#L507)).
   The browser only remembers the job after reading the response header or the
   first body frame
   ([serverChat.ts:584-605](../../../src/ts/process/request/serverChat.ts#L584),
   [serverChat.ts:741-759](../../../src/ts/process/request/serverChat.ts#L741)).
   A network exception before that point returns a generic request error
   ([serverChat.ts:282-314](../../../src/ts/process/request/serverChat.ts#L282)).
   Meanwhile, the server treats socket close as viewer detachment, not job
   cancellation
   ([generationChat.ts:2595-2598](../../../server/fastify/src/routes/generationChat.ts#L2595)).

4. **The immediate proof attempt also fails.** `sendChat` returns `false` and its
   local activity ends. The coordinator refreshes bootstrap, checks for a known
   same-chat job, and then checks for an adjacent persisted reply
   ([acceptedSendCoordinator.svelte.ts:146-165](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L146)).
   If the tab is still offline, bootstrap and transcript reads cannot prove
   either condition. The coordinator records `generation_failed`
   ([acceptedSendCoordinator.svelte.ts:167-179](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L167)).
   The red alert and enabled Retry action become visible.

5. **The server job continues.** This follows from the server's explicit
   detach-not-abort viewer contract and the detached runner in steps 2 and 3.

6. **A later lifecycle refresh discovers the job.** Returning online, a
   `pageshow`, or a visible document calls
   `refreshRuntimeJobsAndTriggerReattach`; a successful bootstrap replaces the
   active-job projection and queues reattach
   ([reattach.ts:234-269](../../../src/ts/process/reattach.ts#L234)). A full
   authoritative resource refresh has the same effect
   ([resourceRefresh.ts:203-227](../../../src/ts/server/resourceRefresh.ts#L203),
   [resourceRefresh.ts:251-257](../../../src/ts/server/resourceRefresh.ts#L251)).

7. **Reattach starts streaming but leaves the recovery untouched.** Reattach
   selects the job by chat ID, removes it from the pending projection while the
   stream is owned, and calls `sendChat` in reattach mode
   ([reattach.ts:153-209](../../../src/ts/process/reattach.ts#L153)). `sendChat`
   creates normal message-generation activity and routes to the durable replay
   path
   ([index.svelte.ts:251-266](../../../src/ts/process/index.svelte.ts#L251),
   [index.svelte.ts:328-370](../../../src/ts/process/index.svelte.ts#L328)). No
   step consults the accepted-send recovery.

8. **The UI presents mutually contradictory actions.** The existing target
   recovery still renders the failure/Retry alert while the reattached activity
   renders live tokens and Stop. The alert normally lasts until a successful
   terminal resource hydration supplies the adjacent assistant row and clears
   it
   ([chatMessageHydration.svelte.ts:176-182](../../../src/ts/server/chatMessageHydration.svelte.ts#L176),
   [chatMessageHydration.svelte.ts:591-615](../../../src/ts/server/chatMessageHydration.svelte.ts#L591)).

The pre-response/job-ID loss is the direct, source-confirmed path and is enough
to establish the defect. A slower bootstrap request that captured an earlier
runtime snapshot could plausibly widen the same window, but that timing was not
reproduced and is not required for this conclusion.

## User impact

### Visible and behavioral impact

- The product asserts that a reply “could not be started” while the reply is
  running or visibly streaming.
- The most prominent action is unsafe/misleading: Retry appears available even
  though the current job may already own that message.
- Before reattach installs local activity, clicking Retry can issue another
  generation request. The server's per-chat lock normally prevents duplicate
  work with a 409
  ([generationChat.ts:3900-3905](../../../server/fastify/src/routes/generationChat.ts#L3900)),
  but this is still a needless request and leaves the user unsure which state is
  authoritative.
- During reattach, Retry can return `false` at the local same-chat activity
  guard without issuing a request
  ([index.svelte.ts:230-240](../../../src/ts/process/index.svelte.ts#L230)); the
  coordinator's chat-level proof can then remove the warning even though it
  still cannot establish operation ownership. That is an MS-02 interaction.
- On a narrow mobile viewport, the red alert occupies scarce composer space
  beside the active Stop control. More importantly, the triggering lifecycle
  transitions—suspension, foregrounding, and network return—are normal mobile
  behavior, not unusual user actions.

### Data impact and limits

MS-07 alone does not cause the server to lose the accepted user row or the
running job. The server remains authoritative and will normally persist the
assistant result. The direct harm is false status, an invalid recovery action,
and loss of user trust.

The risk becomes more serious when combined with nearby findings:

- **MS-01:** the recovery itself disappears on process reload;
- **MS-02:** a different same-chat job can be mistaken for ownership;
- **MS-06:** an authoritative completion probe can report success without
  applying the fetched transcript;
- **MS-08:** failed reattach has no user-facing recovery state; and
- **MS-10:** some append/send callers bypass this coordinator entirely.

## Why a chat-level patch is incorrect

| State | Current identity | What it proves |
| --- | --- | --- |
| Accepted-send recovery | target + accepted `messageId` + local operation-shaped ID | A particular accepted user row still needs a reply or proof |
| Bootstrap generation job | `chatId` + `jobId` + mode | Some generation is running for the chat |
| Local generation activity | chat target + activity ID | This browser is currently doing message work for the chat |
| Hydrated completion proof | accepted user row immediately followed by a `char` row | The particular accepted row has an authoritative adjacent reply |

Only the last row is currently message-specific proof. A chat can contain an
older running job and a newly accepted user row at the same time; the server's
same-chat 409 coverage explicitly exercises that condition
([durableGeneration.test.ts:1170-1201](../../../server/fastify/__tests__/durableGeneration.test.ts#L1170)).
Therefore, clearing every recovery when `activeGenerationJobs` contains the
same `chatId` would turn MS-07 into MS-02: a real warning for the newer row would
be hidden by the older job.

## Changes needed to fix it

### 1. Add durable, end-to-end operation identity

At minimum, every send-mode generation must carry the accepted user-message ID.
The stronger design should also carry a client-generated idempotency/operation
ID from before the append-to-generation handoff.

The identity must flow through:

1. the accepted append result and coordinator request;
2. `sendChat` and `ServerChatInput`;
3. the generation POST body and server validation;
4. the `StreamJob` record;
5. `job_accepted` and locally remembered job metadata;
6. `GenerationJobRegistry.activeJobs()` and bootstrap parsing; and
7. reattach and terminal outcomes.

The client already has the stable accepted message ID before generation starts
([chatCommands.ts:5037-5047](../../../src/ts/chatCommands.ts#L5037)), but
`attemptGeneration` drops it and passes only the chat target and
`syntheticSayNothing` to `sendChat`
([acceptedSendCoordinator.svelte.ts:114-130](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L114)).
The current request body likewise has no ownership field
([serverChat.ts:81-93](../../../src/ts/process/request/serverChat.ts#L81),
[generationChat.ts:131-145](../../../server/fastify/src/routes/generationChat.ts#L131)).

The server must validate that the claimed accepted message:

- exists exactly once in the requested chat;
- is a user row eligible for this send;
- matches the transcript position/snapshot the job will finalize against; and
- is not already owned by a different operation/job.

Merely echoing an unvalidated client ID into bootstrap would make the UI look
fixed without establishing ownership.

For rolling upgrades, a job from an older server that omits the new identity
must be treated as ownership-unknown. It may still reattach by `jobId`, but it
must not suppress or clear a message-specific recovery until authoritative
transcript proof arrives.

### 2. Reconcile recoveries as a state machine, not by deleting on discovery

Use exact operation/message identity to transition a recovery from actionable
failure to an owned-running state. A practical model is:

`retryable -> owned_by_job(jobId) -> completed`

with terminal failure, missing job without completion proof, or reattach
exhaustion transitioning back to an appropriate actionable state.

While an exact matching job is running:

- suppress or replace the red Retry alert;
- keep enough underlying state to restore the alert if that job fails;
- expose the job's real generation/reattach status; and
- do not allow a fresh generation Retry.

Do not permanently delete the recovery merely because bootstrap listed a job.
Deletion should follow exact terminal reconciliation or authoritative adjacent
assistant proof. This avoids a warning flicker between `forgetActiveGenerationJob`
on `done`
([serverChat.ts:884-923](../../../src/ts/process/request/serverChat.ts#L884))
and the later resource hydration that applies the persisted row.

The reconciliation entry point should be shared by startup bootstrap, lifecycle
refresh, full resource refresh, local `job_accepted`, reattach terminal
outcomes, and authoritative transcript hydration. Otherwise the same state gap
will remain on a less common trigger.

### 3. Make Retry message-specific

Before Retry dispatch:

- verify that the accepted row still exists and is still eligible;
- send its exact `messageId`/operation ID;
- reject or explicitly resolve a stale/non-tail recovery rather than generating
  for the current transcript tail; and
- remove the recovery only after the matching job is accepted or the matching
  adjacent reply is authoritatively applied.

This is required both for the newly identified retry defect and to prevent an
MS-07 fix from treating a generic successful send as recovery success.

### 4. Prefer the root atomic handoff

The most robust solution is an idempotent server operation that atomically
records the accepted user row and the durable generation intent, or records
both in one server durability boundary before launch. That eliminates the
client-memory handoff gap behind MS-01 and gives MS-02/MS-07/MS-10 a shared
operation owner. If the split append and generation endpoints remain, the
operation record must itself be durable and replayable.

### Expected implementation surface

The likely implementation touches at least:

- `src/ts/process/acceptedSendCoordinator.svelte.ts`;
- `src/ts/process/acceptedSendRecoveryState.ts`;
- `src/ts/process/reattach.ts`;
- `src/ts/process/index.svelte.ts`;
- `src/ts/process/serverBackedSendChat.ts`;
- `src/ts/process/request/serverChat.ts` and its event types;
- `src/ts/server/bootstrap.ts`;
- `src/lib/ChatScreens/DefaultChatScreen.svelte`;
- `server/fastify/src/prompt/assemble.ts` and SSE event types;
- `server/fastify/src/streamJobs.ts`;
- `server/fastify/src/generationJobs.ts`; and
- `server/fastify/src/routes/generationChat.ts` and bootstrap route coverage.

## How the fix should be validated

### Unit and component tests

1. **Coordinator exact-match tests**

   - Seed a recovery for message A and a matching active job for message A;
     assert the recovery becomes non-actionable/owned and Retry is suppressed.
   - Seed a recovery for message B and an older same-chat job for message A;
     assert the 409-style warning remains actionable.
   - Seed two recoveries in one chat and prove that matching one job changes only
     its owning recovery.
   - Complete, fail, abort, expire, and exhaust reattach for the matching job;
     assert the defined transition for each outcome.

   Existing coordinator coverage separately proves generic failure/retry,
   adjacent transcript proof, and the unsafe chat-level active-job shortcut
   ([acceptedSendCoordinator.test.ts:127-194](../../../src/ts/process/acceptedSendCoordinator.test.ts#L127)).
   It needs an exact-identity replacement rather than another chat-level case.

2. **Lifecycle/reattach integration test in the frontend suite**

   - Create an accepted-send recovery.
   - Make a read-only bootstrap refresh return the exact owning job.
   - Dispatch each of `online`, `pageshow`, and visible
     `visibilitychange`.
   - Assert exact reconciliation occurs before or atomically with reattach, the
     stream attaches once, and no retryable alert coexists with active work.
   - Repeat with an unrelated same-chat job and assert the warning is retained.

   The current online test proves only that bootstrap is fetched and reattach is
   called
   ([reattach.test.ts:468-481](../../../src/ts/process/__tests__/reattach.test.ts#L468));
   it has no recovery state in the fixture.

3. **UI DOM/accessibility test**

   Mount the production chat screen with controlled recovery/job/activity
   stores. For a matching job, assert:

   - no actionable `accepted-send-recovery` alert;
   - no `accepted-send-retry` button;
   - the Stop control and generation status remain accessible; and
   - the alert does not briefly reappear between terminal job removal and
     authoritative transcript application.

   For an unrelated same-chat job, assert the warning remains and clearly
   explains that the user must wait. There is currently no DOM test for the
   accepted-send alert.

4. **Retry targeting regression test**

   Build `[user A (recovery), user B]`, invoke Retry A, and assert no generation
   is launched for B and A is not cleared. Repeat after A is edited/deleted and
   after B already has an assistant reply. Only an exact, valid A operation may
   settle A.

### Server contract and integration tests

1. Extend the durable-generation fixture so a send includes
   `acceptedMessageId` and `clientOperationId`; assert the exact values appear in
   the running job's bootstrap projection and `job_accepted` event.
2. Reject missing, cross-chat, non-user, non-tail/stale, and already-owned
   message IDs without starting a job.
3. Replay the same operation ID and prove idempotency: one accepted user row,
   one job, one assistant finalization.
4. Start an older job, append a newer user row, and prove the older job cannot
   claim the newer recovery. The existing 409 test supplies the foundation
   ([durableGeneration.test.ts:1170-1201](../../../server/fastify/__tests__/durableGeneration.test.ts#L1170)).
5. Retain the existing disconnect/reattach and bootstrap tests, but assert the
   new ownership fields as well
   ([durableGeneration.test.ts:1021-1099](../../../server/fastify/__tests__/durableGeneration.test.ts#L1021)).

### Production-stack browser/mobile regression

Use the real composer, command append, Fastify route, durable provider runner,
bootstrap, lifecycle handlers, reattach stream, and hydration path. A Pixel 7
profile should run this sequence:

1. send message A and wait until the append is durable;
2. let Fastify create A's job while withholding or dropping the initial response
   before the browser sees the job-ID header;
3. make the immediate bootstrap/transcript probes unavailable so the recovery
   alert is created;
4. dispatch offline/online, background/foreground, and page-cache `pageshow`
   variants;
5. allow bootstrap to reveal A's job and the reattach stream to replay tokens;
6. assert at every frame that an actionable Retry alert and A's matching active
   job never coexist;
7. complete the job and assert one user row, one adjacent assistant row, no
   recovery, no active job, and no pending append/outbox work; and
8. repeat with an unrelated older same-chat job, where the newer warning must
   remain.

Each scenario should assert four views of truth: rendered UI, browser
projection/stores, authoritative server transcript, and remaining
job/recovery/outbox records. The existing responsive browser smoke only checks
basic controls and screenshots at desktop/mobile sizes
([fastifyBrowserSmoke.spec.ts:331-378](../../../server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts#L331));
it does not exercise a generation lifecycle transition.

### Validation gates

At minimum, run:

```text
pnpm exec vitest run \
  src/ts/process/acceptedSendCoordinator.test.ts \
  src/ts/process/acceptedSendRecoveryState.test.ts \
  src/ts/process/__tests__/reattach.test.ts \
  src/ts/server/chatMessageHydration.test.ts \
  src/ts/server/bootstrap.test.ts

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/durableGeneration.test.ts

pnpm check
pnpm check:server
pnpm test:smoke
```

For this investigation, the five targeted frontend files passed **89 tests**
and `durableGeneration.test.ts` passed **40 tests**. Those green tests validate
the individual mechanisms, but they do not invalidate MS-07 because none
creates a recovery and then performs a lifecycle job refresh/reattach in one
test.

## Additional issue discovered

### Retry is not bound to the accepted message it claims to recover

**Status:** newly documented by this validation  
**Severity:** Medium; potentially High when the original accepted row is
silently left without its intended reply  
**Confidence:** High

The consolidated audit identifies missing operation ownership in MS-02, but it
does not document this concrete manual-retry failure sequence.

1. Message A is durably accepted and receives a recovery entry containing A's
   `messageId`.
2. The transcript advances—for example, the user sends message B, a plugin
   appends another row, or A is edited/deleted. The normal send guard checks
   active generation/preparation, not the existence of an accepted-send
   recovery
   ([DefaultChatScreen.svelte:1478-1493](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1478)).
3. The user clicks **Retry reply** for A.
4. `retryAcceptedChatSend` copies A's `messageId` into its local request, but
   `attemptGeneration` passes only the chat target and synthetic-empty flag to
   `sendChat`; A's ID is dropped
   ([acceptedSendCoordinator.svelte.ts:114-130](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L114),
   [acceptedSendCoordinator.svelte.ts:233-244](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L233)).
5. Server-backed send derives `userMessage` from the **current last message**,
   not A
   ([serverBackedSendChat.ts:430-446](../../../src/ts/process/serverBackedSendChat.ts#L430)).
6. If that generation succeeds for B/current tail, Retry removes A's recovery
   solely because `attempt.generated` is true
   ([acceptedSendCoordinator.svelte.ts:244-247](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L244)).

The result can be an unrelated extra assistant generation, a dismissed warning,
and no adjacent reply for A. This is not a separate architectural root cause:
it is another user-visible consequence of the operation/message identity gap
behind MS-02 and MS-07. It should be fixed and regression-tested in the same
change, and added to the consolidated audit or its fix ledger so it is not lost.

No other independent, confirmed defect was found in the MS-07-specific path.
Two scope refinements are worth retaining but do not deserve separate findings:

- full resource refresh can trigger the same stale-warning/reattach combination,
  so the bug is not limited to the three lifecycle DOM events; and
- an unrelated same-chat job and a `generation_in_progress` recovery are
  intentionally allowed to coexist. That negative case must remain after the
  fix.

## Historical comparison

The pre-Fastify app has no equivalent durable-job bootstrap/reattach projection
or accepted-send recovery store. Its chat screen directly awaits `sendChat` and
uses one local `doingChat`/abort controller
(`/home/codex/Risuai/src/lib/ChatScreens/DefaultChatScreen.svelte:303-335`),
while its process layer exposes a single global `doingChat` store
(`/home/codex/Risuai/src/ts/process/index.svelte.ts:92-106`). Therefore MS-07 is
specific to the Fastify migration's split append, durable detached job, and
lifecycle recovery architecture; the legacy code does not provide a safe design
to port back.

## Final assessment

MS-07 should remain **open, Medium, Confirmed**. The warning can be made truthful
only after the system can correlate a recovery with the exact accepted message
and durable job. A selector that hides warnings for any same-chat activity is
not a fix. The acceptance bar is an exact-identity state machine whose behavior
is proven across the pre-job-ID mobile loss window, lifecycle reattach, unrelated
same-chat locks, terminal hydration, and transcript advancement before Retry.
