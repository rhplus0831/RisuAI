# MS-08 validation: exhausted generation reattach has no recoverable UI state

Validated: 2026-08-11

Consolidated finding: [MS-08 — Reattach exhaustion has no user-visible state](../fastify-multichat-mobile-stability-audit-2026-08-11.md#ms-08--reattach-exhaustion-has-no-user-visible-state)

Audit revision: `9afde4658ea5b277493e9d7f6ef7aaf387544165`

Validation revision: `e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`

Status: **confirmed**, medium severity. The relevant source files are unchanged
between the audit and validation revisions.

## Executive conclusion

MS-08 is a client lifecycle-state defect, not evidence that the Fastify job
itself has stopped. The browser keeps two different facts in private state:

- `activeGenerationJobs` says that a server job is, or was last known to be,
  running for a chat; and
- `reattachRetryStates` says that this browser has stopped trying to observe
  that job after exhausting its transport retry budget.

Only the first fact is exposed to the UI. Consequently, an exhausted job is
rendered exactly like a healthy active generation: the composer shows a pulsing
Stop button, normal send and hook actions remain blocked, and the sidebar can
keep showing a green generation indicator. The user is not told that the
browser is no longer receiving the stream and is offered neither Retry nor
Refresh.

The current behavior is directly locked in by the reattach unit test: after
four outer attach calls, no timer remains, further triggers do nothing, and the
job remains in `activeGenerationJobs`
([reattach test:255-286](../../../src/ts/process/__tests__/reattach.test.ts#L255-L286)).

## What exactly is the bug?

### The retry state is private and cannot represent exhaustion to consumers

`activeGenerationJobs` is a public Svelte store, but the retry map is a
module-private `Map` whose value contains only a failure count and timer
([reattach:19-28](../../../src/ts/process/reattach.ts#L19-L28)). It retains
neither the last error nor a public lifecycle phase such as `reattaching`,
`waiting_to_retry`, or `reattach_failed`.

The retry delay array is `[250, 1_000, 4_000]`. A job is blocked while a timer
exists or once `transportFailures > 3`
([reattach:21](../../../src/ts/process/reattach.ts#L21),
[reattach:107-112](../../../src/ts/process/reattach.ts#L107-L112)). Each
retryable failure increments the counter before selecting a delay. On the
fourth failure, the selected delay is `undefined`; the state is retained, but
no timer or other recovery action is scheduled
([reattach:114-130](../../../src/ts/process/reattach.ts#L114-L130)).

The exact outer-attempt budget is therefore:

| Outer call | Result | Next action |
| --- | --- | --- |
| Initial call | Failure 1 | Retry after 250 ms |
| Retry 1 | Failure 2 | Retry after 1 s |
| Retry 2 | Failure 3 | Retry after 4 s |
| Retry 3 | Failure 4 | No timer; job is blocked |

This is four attach calls over at least 5.25 seconds of scheduled backoff, not
three total calls. Request and stream durations can make the visible interval
longer.

### The failed observation is restored as an apparently active job

Before attaching, the coordinator removes the job from `activeGenerationJobs`
to prevent duplicate observers. If `sendChat` reports
`retryable_transport_failure`, it restores the same job and schedules the next
outer retry. All other typed outcomes remove the job
([reattach:166-210](../../../src/ts/process/reattach.ts#L166-L210)).

After the fourth retryable failure, the restore still happens, but the retry
scheduler has no delay left. The browser now has:

- a retained `activeGenerationJobs` entry;
- a private retry entry with `transportFailures === 4` and no timer; and
- no local `activeChatGenerations` activity or live reattach controller.

No exported store or callback exposes that combination as a failure.

### The UI treats “known server job” and “healthy observed generation” as the same state

The chat considers itself to own a generation when it has either a live local
activity or any matching entry in `activeGenerationJobs`. If only the retained
job remains, the displayed stage defaults to zero
([DefaultChatScreen:347-358](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L347-L358)).
That derived boolean selects the pulsing cancel control instead of the send
control
([DefaultChatScreen:2316-2345](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2316-L2345))
and is also passed into transcript rendering as active generation state
([DefaultChatScreen:2616-2632](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2616-L2632)).

The same retained job feeds sidebar generation indicators. Job chat IDs are
unioned with live message activities
([sidebar multitasking:14-22](../../../src/lib/SideBars/sidebarMultitasking.ts#L14-L22)),
and the sidebar derives its indicators from that union
([Sidebar:358-364](../../../src/lib/SideBars/Sidebar.svelte#L358-L364)). Thus a
background exhausted job can also continue to look healthy.

The existing in-chat recovery banner is for an accepted user-message handoff,
not stream reattachment. It is keyed to `acceptedSendRecoveries` and offers only
the accepted-send Retry action
([DefaultChatScreen:2234-2254](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2234-L2254)).
Conflating it with MS-08 would be incorrect because accepted-send ownership and
job observation are different state machines.

### There are two retry layers

The outer MS-08 budget must not be confused with the lower-level durable SSE
reconnect loop. Once a response has opened, `serverChat.ts` can reconnect the
same job after an unexpected EOF/read failure using delays
`[0, 250, 500, 1_000, 2_000, 4_000]`, with at most eight reconnect cycles
([serverChat:59-65](../../../src/ts/process/request/serverChat.ts#L59-L65),
[serverChat:696-738](../../../src/ts/process/request/serverChat.ts#L696-L738)).
An initial GET that cannot open does not enter that inner loop; it returns a
typed outer reattach outcome.

The fix should preserve this separation:

- the inner loop repairs an already-observed stream without tearing down the
  active chat activity; and
- the outer coordinator owns browser lifecycle discovery, exhaustion, and the
  user-facing recovery state.

## How does the bug affect users?

### Misleading status

The pulsing Stop button and green sidebar indicators imply that token delivery
is still healthy. After exhaustion, no client observer is attached and no retry
is pending. The job may still be running, may be completing server-side, or may
already have completed; the browser does not know which.

### Blocked chat controls

The retained job keeps `currentChatOwnsGeneration` true. Besides replacing Send
with Stop, it disables BTW and Draft-send actions
([DefaultChatScreen:2416-2438](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2416-L2438)).
This is conservative with respect to the server's one-running-job-per-chat
lock, but it becomes a dead end because the UI does not explain the reason or
offer a way to re-establish authority.

### No error or next step

The last transport error is discarded. The user cannot distinguish an offline
device, a proxy failure, a transient 5xx/429/408, or an invalid response body.
They have no manual reattach button and no explicit authoritative refresh.

### Mobile recovery is event-dependent

The current automatic escape hatch is a successful bootstrap refresh caused by
one of these events:

- `visibilitychange` when the document becomes visible;
- `pageshow`; or
- `online`.

Those handlers refresh the server's active-job projection, then trigger
reattach
([reattach:234-269](../../../src/ts/process/reattach.ts#L234-L269)). A successful
refresh calls `setActiveGenerationJobs`, which clears all retry state and gives
still-running jobs a new budget
([reattach:40-45](../../../src/ts/process/reattach.ts#L40-L45)). If the job is no
longer running, bootstrap removes it from the local list. A failed refresh
retains both the job and exhausted budget. There is no `focus` listener in this
module.

Simply changing chat or character is not an escape hatch. Those changes can
trigger the coordinator, but they do not reset an exhausted retry entry, so the
job remains blocked by `isReattachRetryBlocked`.

### Authoritative data may be ahead of the UI

Fastify clears the chat's running lock at completion/cancellation and only
projects jobs that are still running
([generationJobs:48-66](../../../server/fastify/src/generationJobs.ts#L48-L66),
[generationJobs:84-115](../../../server/fastify/src/generationJobs.ts#L84-L115)).
The server can therefore persist the assistant result and stop reporting the
job while the browser retains its older active-job entry. A later bootstrap
refresh repairs that projection, but the current screen does not let the user
request it.

## In what sequence does the bug occur?

1. Fastify starts a durable generation, registers it by chat, and exposes it in
   bootstrap while it is running
   ([generation route:3900-3923](../../../server/fastify/src/routes/generationChat.ts#L3900-L3923),
   [bootstrap route:45-52](../../../server/fastify/src/routes/bootstrap.ts#L45-L52)).
2. On startup, a resource refresh, or after learning the job from a live
   response, the browser places `{ chatId, jobId, mode, ... }` in
   `activeGenerationJobs`
   ([bootstrap:339-346](../../../src/ts/bootstrap.ts#L339-L346),
   [reattach:47-57](../../../src/ts/process/reattach.ts#L47-L57)).
3. When the owning chat is open, `maybeReattachOpenChatGeneration` finds that
   job. It refuses duplicate observers, blocked retries, and same-chat local
   activity before continuing
   ([reattach:153-164](../../../src/ts/process/reattach.ts#L153-L164)).
4. The coordinator marks the job as reattaching, dynamically loads `sendChat`,
   verifies that the open target is still fresh, removes the job from the
   public list, and installs a chat-scoped abort controller
   ([reattach:166-182](../../../src/ts/process/reattach.ts#L166-L182)).
5. `sendChat` starts a chat-keyed message activity and enters its durable
   reattach branch with the existing job ID
   ([sendChat:230-266](../../../src/ts/process/index.svelte.ts#L230-L266),
   [sendChat:328-369](../../../src/ts/process/index.svelte.ts#L328-L369)).
6. The request layer performs authenticated
   `GET /api/v1/generate/chat/:jobId/stream`. Fastify attaches the connection as
   a viewer and replays the buffered stream; disconnecting the viewer does not
   cancel the server job
   ([serverChat:264-313](../../../src/ts/process/request/serverChat.ts#L264-L313),
   [generation route:2557-2608](../../../server/fastify/src/routes/generationChat.ts#L2557-L2608)).
7. If the GET fails to open, response body is missing, or the opened stream
   exhausts its inner reconnect loop, the request classifies the result.
   Network errors, missing bodies, HTTP 408/429/5xx, and exhausted stream
   transport reconnects are retryable; 404 is `missing_job`; other non-retryable
   HTTP and SSE `error` frames are terminal
   ([serverChat:310-367](../../../src/ts/process/request/serverChat.ts#L310-L367),
   [serverChat:840-882](../../../src/ts/process/request/serverChat.ts#L840-L882)).
8. `sendChat` reports the typed result through `onReattachOutcome` when its
   activity settles
   ([sendChat:653-669](../../../src/ts/process/index.svelte.ts#L653-L669)).
9. On a retryable result, the coordinator restores the job, increments its
   failure count, and schedules 250 ms, 1 s, then 4 s retries
   ([reattach:195-210](../../../src/ts/process/reattach.ts#L195-L210)).
10. On failure four, the coordinator restores the job again but schedules
    nothing. Future triggers return at the retry-block check. No error state or
    user action is emitted.
11. Svelte observes the restored job and continues rendering Stop, blocked send
    controls, transcript generation state, and sidebar generation indicators.

## What changes are needed to fix it?

### 1. Add an observable per-job reattach lifecycle

Keep server authority separate from client observation. A suitable model is a
job-ID-keyed store with phases such as:

- `idle` or `discovered`;
- `reattaching`;
- `waiting_to_retry`, with attempt number and `nextRetryAt`;
- `reattach_failed`, with last error, attempts, and failure timestamp; and
- `cancelling` or `cancel_failed` if Stop is incorporated into the same
  lifecycle.

`activeGenerationJobs` should continue to answer “which jobs does the browser
currently believe the server owns?” The new store should answer “can this
browser currently observe/control that job?” A reattach failure must not be
misrepresented as provider/generation failure.

Store the last typed transport error when scheduling a retry. On the fourth
failure, transition to `reattach_failed` instead of only leaving a private
counter with no timer.

### 2. Export exact-job Retry and Refresh operations

Add a manual Retry operation that:

1. accepts the exact `jobId` rather than selecting an arbitrary same-chat job;
2. clears that job's timer and retry budget;
3. uses an operation/version token so a late older attempt cannot overwrite the
   newer action;
4. verifies that the job is still known and the target chat is still correct;
5. starts one guarded reattach attempt; and
6. restores `reattach_failed` with the new error if it exhausts again.

Add a Refresh operation that performs a read-only bootstrap fetch and
reconciles the result:

- if the job is still running, reset only its recovery budget and reattach;
- if it is absent, clear local job/failure state and authoritatively hydrate the
  chat so persisted completion or cancellation output is visible; and
- if refresh fails, preserve the known job and failure state while showing the
  refresh error.

The current `setActiveGenerationJobs` clears retry state for every job. Replace
that blanket behavior with explicit per-job reconciliation/reset semantics so
an unrelated full refresh or another job does not erase useful failure state or
restart every budget accidentally.

### 3. Render a dedicated, accessible recovery affordance

For the open chat, render a reattach-specific alert near the composer with:

- a clear message such as “The reply may still be running, but this device
  could not reconnect”;
- Retry stream;
- Refresh status; and
- Stop/Cancel only if cancellation remains valid for the known job.

Keep this separate from `acceptedSendRecoveries`: the accepted-send banner
means “an accepted user row may not own a generation,” whereas MS-08 means “a
known job cannot currently be observed.” Add all user-visible text through
`src/lang`.

The composer should remain conservatively protected while server ownership is
unknown, but it should no longer present a healthy pulse. Sidebar/pinned-chat
indicators should similarly distinguish running/observed from reconnect-failed,
for example with a warning state and an action that opens the affected chat.

### 4. Make terminal and lifecycle reconciliation explicit

Clear job retry/UI state on all conclusive outcomes:

- completed terminal frame;
- terminal SSE failure;
- authoritative 404/missing job;
- acknowledged cancellation followed by authoritative absence; and
- bootstrap refresh that no longer reports the job.

On `visibilitychange`, `pageshow`, and `online`, a successful bootstrap refresh
may reset failed jobs that are still active, but it should do so deliberately
and per job. A failed refresh must leave the manual actions and error visible.

### 5. Fix cancellation as part of the lifecycle boundary

`cancelServerChatGeneration` currently returns `Promise<void>`, ignores non-OK
responses, and swallows fetch errors
([serverChat:235-262](../../../src/ts/process/request/serverChat.ts#L235-L262)).
Change it to return a typed result. A 200 response means that abort was accepted,
not necessarily that the runner has finished persisting partial output and
released the chat lock. Keep a `cancelling` state until a bounded authoritative
probe confirms that bootstrap no longer reports the job, then hydrate the chat.

Treat 404 as “already absent” and reconcile/hydrate. Surface 423, other 4xx,
5xx, and transport failures as cancellation failures with Retry/Refresh rather
than silently asserting either active or idle state.

### Likely implementation touchpoints

| Area | Required change |
| --- | --- |
| `src/ts/process/reattach.ts` | Observable state, last error, exact-job actions, scoped reconciliation, terminal cleanup |
| `src/ts/process/request/serverChat.ts` | Preserve typed reattach/cancel outcomes; stop swallowing cancellation failure |
| `src/ts/process/index.svelte.ts` | Route Stop through acknowledged job cancellation when no live controller exists |
| `src/lib/ChatScreens/DefaultChatScreen.svelte` | Reattach failure alert and Retry/Refresh/Stop presentation |
| Sidebar components | Distinguish reconnect failure from healthy generation |
| `src/lang/*` | Localized labels, status, and error copy |
| Bootstrap/resource refresh callers | Explicit per-job reset/removal policy and authoritative hydration |

No Fastify protocol change is required for basic Retry or Refresh: authenticated
GET reattach, read-only bootstrap discovery, and active-writer DELETE already
exist. A richer status endpoint or idempotent cancellation operation could make
the control contract clearer, but the immediate MS-08 fix can use the current
job ID plus bootstrap reconciliation.

## How should the fix be validated?

### Coordinator unit tests

Extend [reattach.test.ts](../../../src/ts/process/__tests__/reattach.test.ts) with
fake-timer assertions for:

1. exact transitions across initial attempt, 250 ms, 1 s, 4 s, and
   `reattach_failed`;
2. last error, attempt count, and absence of a timer at exhaustion;
3. repeated automatic triggers remaining coalesced and blocked after
   exhaustion;
4. manual Retry resetting only the selected job and starting exactly one call;
5. Chat A retry/failure state remaining isolated from Chat B;
6. successful Retry clearing failure state and the job on terminal completion;
7. Refresh retaining/resetting a still-active job, removing an absent job, and
   preserving state when bootstrap itself fails;
8. `visibilitychange`, `pageshow`, and `online` reset semantics;
9. navigation away/back showing the correct job state without bypassing the
   budget;
10. cancellation success, cancellation failure, 404, and eventual authoritative
    absence;
11. stop/shutdown clearing timers, subscriptions, and public state; and
12. late attempt results being ignored after Retry, Refresh, or Cancel supersedes
    them.

Keep the existing transport classification coverage in
[serverChat.test.ts](../../../src/ts/process/request/tests/serverChat.test.ts),
and add cancellation-result tests for 200, 404, 423, 5xx, invalid responses, and
network failure. The existing suite currently asserts that fetch failures are
swallowed
([serverChat test:1401-1444](../../../src/ts/process/request/tests/serverChat.test.ts#L1401-L1444));
that expectation must change.

### Svelte DOM tests

Add tests in
[DefaultChatScreen.loadPages.test.ts](../../../src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts)
that assert:

- exhausted state renders a named `role="alert"` with Retry and Refresh;
- the healthy pulse is not used as the sole status after exhaustion;
- accepted-send recovery and reattach failure can coexist without using each
  other's actions;
- Retry and Refresh have loading/disabled states that always settle;
- only the matching open chat shows the banner;
- other chats retain usable send controls;
- the composer remains protected until authority is resolved; and
- successful completion/removal restores Send and removes the sidebar warning.

Extend sidebar tests to cover warning versus healthy indicator derivation for
characters, folders, and pinned chats.

### Cross-layer and browser validation

Retain the existing Fastify tests for active bootstrap discovery, replay,
completed-job reattach, and cancellation terminal delivery
([durable generation tests:1021-1168](../../../server/fastify/__tests__/durableGeneration.test.ts#L1021-L1168)).
Add a production-stack Playwright/mobile test that:

1. starts a durable job and captures its ID;
2. interrupts only reattach GETs while leaving bootstrap and the server runner
   controllable;
3. observes all four outer calls and the failure UI;
4. verifies no fifth automatic call occurs;
5. exercises manual Retry after restoring the stream;
6. separately exercises Refresh after the server completes while the client is
   disconnected;
7. exercises successful and failed Stop after exhaustion; and
8. repeats with two chats so one failed observer cannot affect the other.

Run it under desktop and a mobile profile with `visibilitychange`, `pageshow`,
offline/online, full reload, and navigation between chats. For every scenario,
assert all four views of truth required by the consolidated audit:

- visible transcript/control state;
- browser job and recovery stores;
- authoritative server transcript/bootstrap jobs; and
- remaining retry/cancellation/recovery records.

The acceptance invariant is: **a known job is never shown as healthily observed
unless an observer or scheduled retry exists; if observation is exhausted, the
user always has a truthful, settling Retry/Refresh/Cancel path.**

## Additional issues discovered outside the consolidated audit

### AV-MS08-01 — known-job Stop has no acknowledged cancellation contract

This is confirmed and is not the sequence documented by MS-04. MS-04 covers a
fresh send aborted before the browser learns its job ID. This issue occurs after
the job ID is already known.

There are two inconsistent outcomes from the same failure-blind helper:

1. With a live reattach activity, abort sends best-effort DELETE, but the request
   path forgets the job as soon as local abort settles, regardless of whether
   DELETE succeeded
   ([serverChat:517-540](../../../src/ts/process/request/serverChat.ts#L517-L540),
   [serverChat:673-681](../../../src/ts/process/request/serverChat.ts#L673-L681)).
   A failed DELETE can therefore leave the server running while the UI becomes
   idle.
2. Without a live controller—for example before reattach installs one or after
   MS-08 exhaustion—`abortActiveGeneration` finds the known job and calls the
   same best-effort DELETE, but does not remove or refresh the local job
   ([sendChat coordinator:146-165](../../../src/ts/process/index.svelte.ts#L146-L165)).
   A successful DELETE can therefore stop the server while the UI continues to
   show Stop and block sending.

The current request test explicitly expects cancellation fetch failures to be
swallowed
([serverChat test:1435-1444](../../../src/ts/process/request/tests/serverChat.test.ts#L1435-L1444)).
The typed cancellation and authoritative follow-up described in the fix plan
should close both branches.

### AV-MS08-02 — accepted-send Retry can remain disabled on a stalled authority probe

This is a separate accepted-send recovery issue, found while tracing the
Refresh boundary. It is not documented in MS-01 through MS-10.

`retryAcceptedChatSend` sets `retrying: true`, attempts generation, and then
awaits `acceptedGenerationReachedServer` before it records a non-retrying
recovery again
([accepted-send coordinator:233-257](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L233-L257)).
That authority probe first awaits a read-only bootstrap refresh and may then
await a transcript read
([accepted-send coordinator:146-164](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L146-L164)).
Both fetches are called without an abort signal or application timeout
([bootstrap client:93-114](../../../src/ts/server/bootstrap.ts#L93-L114),
[hydration reads:228-266](../../../src/ts/server/hydrationReads.ts#L228-L266)).

If either request stalls rather than rejects, the retry promise never reaches
its cleanup path and the banner's button remains disabled because the UI binds
`disabled` directly to `recovery.retrying`
([DefaultChatScreen:2244-2252](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2244-L2252)).
The same no-timeout probe can delay initial creation of the recovery record
after a failed generation.

Add a bounded timeout/AbortController and a `finally`-style state settlement.
Test both bootstrap-never-settles and transcript-never-settles cases. This issue
has direct control-flow evidence but was not reproduced in a live browser during
this documentation-only validation.

## Investigation and verification notes

- Direct source tracing was cross-checked with five successful independent Luna
  read-only workers covering UI, lifecycle/cancellation, server authority,
  historical behavior, and undocumented issues. Three other workers failed at
  the runner boundary; their assigned state-machine, transport, and test topics
  were independently completed in the main investigation.
- The focused current suites passed: `76` tests across
  `src/ts/process/__tests__/reattach.test.ts` and
  `src/ts/process/request/tests/serverChat.test.ts`.
- The plain RisuAI checkout at `/home/codex/Risuai` has no durable-job reattach
  implementation to port. Its visible errors and manual “Continue response”
  affordance are presentation precedent only; Continue starts a new generation
  request and is not transport recovery.
- No physical-device run, process-kill harness, or live-provider request was
  performed for this report. The MS-08 confirmation follows directly from
  reachable current control flow and its existing fake-timer regression test.
