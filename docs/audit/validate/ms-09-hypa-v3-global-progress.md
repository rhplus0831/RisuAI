# MS-09 validation report: Hypa V3 progress is a global last-event-wins scalar

**Audit item:** MS-09 in [`fastify-multichat-mobile-stability-audit-2026-08-11.md`](../fastify-multichat-mobile-stability-audit-2026-08-11.md#ms-09--hypa-v3-progress-remains-global)  
**Disposition:** Confirmed  
**Severity:** Medium for MS-09 itself; the related non-replay defect described below can make the incorrect UI state persist indefinitely  
**Investigated revision:** `e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`  
**Audit revision:** `7043a54bf`  

The MS-09 implementation paths have not changed between the audit's parent revision and the investigated revision.

## Executive conclusion

The server has the information required to present correct Hypa V3 progress: every memory event contains a `chatId`, a job ID, a kind, and a status. The browser also parses that identity and uses it for a terminal-update fence. It then drops the identity immediately before updating the progress UI. `applyServerHypaV3Progress` replaces one application-global `{ open, miniMsg, msg, subMsg }` object, and `App.svelte` mounts exactly one global popup from that object.

The store is therefore not a projection of the active memory jobs. It is only a projection of the last accepted memory event. An event for any job can overwrite the labels for every other job, and a terminal event for any job can close the popup while another job remains `pending` or `running`.

This is a presentation and recovery defect, not evidence that the underlying memory job is cancelled or loses its persisted result. The SQLite jobs and worker continue independently. The user-visible state is nevertheless materially false: active work can disappear, labels can refer to a different chat, and a stream gap can leave the popup permanently open or permanently absent.

## What exactly is the bug?

The broken invariant is:

> The progress popup is open if and only if at least one relevant Hypa V3 job is active, and its text truthfully describes that active set.

The implementation instead enforces:

> The progress popup equals the `hypav3_progress` payload of the most recently accepted memory event, regardless of which chat or job produced it.

The mismatch is visible at five boundaries:

| Boundary | Identity/state available | Identity/state retained for progress |
| --- | --- | --- |
| Persisted job | `chatId`, job `id`, `kind`, `status`, attempts, timestamps | All retained |
| Server `memory.job` event | Outer `chatId`; nested job `id`, `kind`, `status`, attempts; optional progress side effect | All retained |
| Browser event parser | Parses the same outer chat and nested job identity | All retained |
| Bootstrap dispatch | Uses `chatId + job.id` in `shouldAcceptMemoryJobUpdate` | Passes only `sideEffect.payload` to the progress setter |
| Progress store/UI | Could have been keyed by `chatId + job.id` | One global scalar with no chat, job, kind, or status |

The identity-loss point is [`src/ts/bootstrap.ts:642-647`](../../../src/ts/bootstrap.ts#L642-L647). The full event is accepted or rejected using `{ chatId, ...event.job }`, but the setter receives only `event.sideEffect.payload`. The setter at [`src/ts/process/request/serverMemory.ts:79-95`](../../../src/ts/process/request/serverMemory.ts#L79-L95) validates four display fields and replaces the entire global store. It even discards the payload's optional `status` and `queuedCount`. The store itself has only four scalar fields ([`src/ts/stores.svelte.ts:72-78`](../../../src/ts/stores.svelte.ts#L72-L78)).

The server emits the value that makes this destructive. `buildHypaV3ProgressSideEffect` treats only `pending` and `running` as active; `completed`, `failed`, and `cancelled` independently produce `open: false` and empty labels ([`server/fastify/src/memoryEvents.ts:114-130`](../../../server/fastify/src/memoryEvents.ts#L114-L130)). `open` describes one event's job, not the active set, but the client consumes it as global truth.

Finally, the shell renders one application-wide popup whenever that scalar says `open` ([`src/App.svelte:353-359`](../../../src/App.svelte#L353-L359)). The component reads the same scalar directly and has no chat/job context ([`src/lib/Others/HypaV3Progress.svelte:1-38`](../../../src/lib/Others/HypaV3Progress.svelte#L1-L38)).

### This is broader than “two chats”

The key collision is `all memory jobs -> one scalar`, so it occurs in all of these cases:

- two different chats;
- two batch jobs in the same chat;
- two different job kinds in the same chat;
- a pending job and a running job;
- a retry-to-`pending` transition interleaved with another job;
- events originating in another connected browser tab/client.

`shouldAcceptMemoryJobUpdate` does not prevent the collision. Its module-global map only rejects a later non-terminal update for the **same** `chatId + job.id` after that exact job became terminal ([`src/ts/server/memoryJobOrdering.ts:5-32`](../../../src/ts/server/memoryJobOrdering.ts#L5-L32)). A terminal update for Job A remains valid even while Job B is active, so it is allowed to close Job B's global popup.

## How does the bug affect users?

### Direct effects

1. **Active work disappears.** If Job A terminates after Job B has reported active state, A's `open: false` unmounts the only popup even though B is still `pending` or `running`.
2. **Labels oscillate or describe the wrong chat/job.** Each pending/running event overwrites `miniMsg`, `msg`, and `subMsg`. Nothing in the popup names the owning chat or job.
3. **The popup can close and reopen without a real stop/start.** A terminal event closes it; a later update from the still-active job reopens it. The component is remounted, so its local expanded/collapsed state also resets.
4. **Failures are visually indistinguishable from success or cancellation in this popup.** All three terminal states send the same empty, closed presentation. Failure details remain available in the memory-jobs modal, but the global indicator provides no terminal explanation.
5. **Every connected client observes global server work.** The event bus broadcasts each memory event to every connected event stream without chat filtering ([`server/fastify/src/routes/events.ts:252-265`](../../../server/fastify/src/routes/events.ts#L252-L265)). A tab can therefore display or hide progress due to a job created from another tab.

### Mobile-specific consequences

The collapsed control is fixed at the top-right of the application, and the expanded control occupies an application-level full-screen layer ([`src/lib/Others/HypaV3Progress.svelte:11-38`](../../../src/lib/Others/HypaV3Progress.svelte#L11-L38)). On a narrow screen, false reopening, label changes, or an unrelated chat's progress are more intrusive because there is less surrounding context with which to infer what the indicator belongs to.

### What is not directly corrupted

The UI store is not the memory worker's source of truth. Jobs remain persisted in SQLite, and worker transitions continue after the popup closes. The Hypa V3 modal separately receives the full event and filters it to its selected chat ([`src/lib/Others/HypaV3Modal/server-memory-jobs.svelte:105-139`](../../../src/lib/Others/HypaV3Modal/server-memory-jobs.svelte#L105-L139)). MS-09 does not by itself prove lost summaries, embeddings, or job cancellation.

## In what sequence does the bug occur?

### End-to-end code sequence

```mermaid
sequenceDiagram
    participant A as "Memory job A"
    participant B as "Memory job B"
    participant W as "MemoryWorker / job route"
    participant E as "memory.job event bus + SSE"
    participant O as "Browser ordering fence"
    participant S as "Global progress scalar"
    participant U as "Hypa progress popup"

    W->>E: "A running (chatId A, jobId A, open true)"
    E->>O: "Full identified event"
    O->>S: "Only A's display payload"
    S->>U: "Open; show A labels"
    W->>E: "B pending/running (chatId B, jobId B, open true)"
    E->>O: "Full identified event"
    O->>S: "Only B's display payload"
    S->>U: "Remain open; replace labels with B"
    A->>W: "A completes/fails/is cancelled"
    W->>E: "A terminal (chatId A, jobId A, open false)"
    E->>O: "Accepted because A is a valid terminal update"
    O->>S: "Only A's closed display payload"
    S->>U: "Unmount the sole popup"
    Note over B,U: "B remains active, but the UI no longer represents it"
```

The concrete code path is:

1. **Jobs are created.** Prompt assembly can create deterministic summarize and embed jobs while assembling Hypa V3 memory ([`server/fastify/src/prompt/assemble.ts:1972-2013`](../../../server/fastify/src/prompt/assemble.ts#L1972-L2013), [`server/fastify/src/memoryChunkPlanner.ts:75-119`](../../../server/fastify/src/memoryChunkPlanner.ts#L75-L119), [`server/fastify/src/prompt/memoryFollowups.ts:46-114`](../../../server/fastify/src/prompt/memoryFollowups.ts#L46-L114)). The explicit `POST /api/v1/memory/jobs` route is another producer and emits a pending event immediately ([`server/fastify/src/routes/memoryJobs.ts:99-148`](../../../server/fastify/src/routes/memoryJobs.ts#L99-L148)).
2. **The worker claims jobs.** One `MemoryWorker` owns a single `inFlight` worker turn and fairly selects chats ([`server/fastify/src/memoryWorker.ts:55-70`](../../../server/fastify/src/memoryWorker.ts#L55-L70), [`server/fastify/src/memoryWorker.ts:156-190`](../../../server/fastify/src/memoryWorker.ts#L156-L190)). Default summarize/embed batch handlers can claim several jobs from the same chat and execute them with configured concurrency ([`server/fastify/src/memorySummarizeJobHandler.ts:89-127`](../../../server/fastify/src/memorySummarizeJobHandler.ts#L89-L127), [`server/fastify/src/memoryEmbedJobHandler.ts:81-100`](../../../server/fastify/src/memoryEmbedJobHandler.ts#L81-L100)).
3. **Every transition emits one job event.** Claim emits `running`; completion emits `completed`; retry emits `pending`; final exhaustion emits `failed`; route cancellation emits `cancelled` ([`server/fastify/src/memoryWorker.ts:193-235`](../../../server/fastify/src/memoryWorker.ts#L193-L235), [`server/fastify/src/routes/memoryJobs.ts:183-203`](../../../server/fastify/src/routes/memoryJobs.ts#L183-L203)). Each is presented independently as a Hypa progress side effect ([`server/fastify/src/memoryWorker.ts:256-259`](../../../server/fastify/src/memoryWorker.ts#L256-L259)).
4. **The server preserves identity.** `buildMemoryJobEvent` includes the outer chat and nested job ID/status ([`server/fastify/src/memoryEvents.ts:81-104`](../../../server/fastify/src/memoryEvents.ts#L81-L104)). The in-memory bus fans it out, and the events route writes it as a `memory` SSE frame.
5. **The browser preserves identity while parsing.** `parseMemoryEvent` validates `chatId`, job ID, kind, status, attempts, timestamp, and side effect ([`src/ts/server/events.ts:219-277`](../../../src/ts/server/events.ts#L219-L277)).
6. **Bootstrap drops identity for the popup.** It applies the per-job terminal fence, calls `applyServerHypaV3Progress` with only the side-effect payload, then publishes the full event to modal subscribers.
7. **The setter performs a global replacement.** No reducer checks whether other active jobs exist. A terminal job's `open: false` therefore becomes application-global.
8. **The shell mounts/unmounts the only popup.** The user sees whichever single event won last.

### Reachable interleavings

The default worker does not normally execute providers for two different chats simultaneously: it has one global worker turn, while each default batch drains only jobs of the first job's chat and kind. The audit's proposed test should therefore be phrased in terms of **active persisted states**, not necessarily two simultaneous cross-chat provider calls.

#### Cross-chat route-created jobs

| Event | Persisted active jobs after event | Scalar popup after event |
| --- | --- | --- |
| A pending | A | A waiting |
| B pending | A, B | B waiting |
| A running | A, B | A running |
| A completed | B pending | **Closed incorrectly** |
| B running | B | B running; popup reopens |

This is reachable because route enqueues emit pending immediately and the fair, single-flight worker can leave another chat pending.

#### Same-chat batch

The summarize/embed batch handler claims multiple jobs, emitting `running` for each. It later commits results one at a time. When the first job emits a terminal event, later jobs still have persisted `running` state until their own commit call. The first terminal event closes the scalar during that interval. This is the clearest literal `running + running + one terminal` reproduction in the default configuration.

#### Retry and cancellation

A failed attempt below `maxAttempts` returns to `pending` and sends an active “Waiting…” payload; final exhaustion sends `open: false`. `DELETE /memory/jobs/:id` also sends `open: false` for only the cancelled job. Either terminal event can hide any unrelated active job.

## Why the original design became unsafe

Plain RisuAI already used the same global scalar and application-level popup. Its in-browser Hypa V3 workflow updated that scalar from local rate-limiter callbacks and cleared it after its local batch—for example, summarize progress and closure in `/home/codex/Risuai/src/ts/process/memory/hypav3.ts:380-431`, and embedding progress/closure in `/home/codex/Risuai/src/ts/process/memory/hypav3.ts:628-674`.

The Fastify migration retained the old UI representation while moving memory work into independently persisted, multi-chat jobs and broadcasting their transitions. The legacy design was not chat-scoped either, so it should not be treated as correct precedent; it explains why a display payload rather than a job-state projection exists today.

## What changes are needed to fix it?

### 1. Replace the scalar snapshot with an identified active-job projection

Introduce a dedicated client-side memory-progress reducer/store keyed by a collision-safe `(chatId, jobId)` tuple. Each entry should retain at least:

```ts
interface MemoryProgressEntry {
  chatId: string
  jobId: string
  kind: 'chunk' | 'embed' | 'summarize'
  status: 'pending' | 'running'
  attemptCount: number
  maxAttempts: number
  updatedAt?: string
}
```

Reducer semantics:

- `pending` or `running`: upsert only that exact key;
- `completed`, `failed`, or `cancelled`: remove only that exact key;
- terminal status is monotonic for one concrete job instance;
- retry-to-`pending` remains active and updates only that job;
- duplicate events are idempotent;
- never use one event's `open` flag as the truth for all jobs.

The most important API change is to pass the full `ServerMemoryEvent` (or the full identified job projection) into this reducer. `applyServerHypaV3Progress(payload)` should be removed, deprecated, or restricted to a compatibility-only legacy path. The Fastify event path must not discard identity.

### 2. Derive the popup from the active map

Choose and document one product policy:

- **Truthful aggregate (recommended):** the collapsed popup reports the total active count across chats; the expanded view groups/names the work by chat and prioritizes the open chat.
- **Open-chat-only:** display only entries for the currently selected chat, with a separate unobtrusive signal when background chats have active jobs.

A silent open-chat-only filter is insufficient because memory work intentionally continues for background chats. A truthful aggregate avoids hiding real work and matches the server's global broadcast model.

`open` should be derived as `activeEntries.length > 0`. The count and labels should likewise be derived from the active entries rather than copied from whichever event arrived last. A failed job should be removed from “active” and surfaced through the existing job modal or a separate, explicit terminal notification; it should not masquerade as generic successful closure.

### 3. Make startup/reconnect reconciliation authoritative and race-safe

Fixing the map alone does not recover events lost during an SSE outage. On initial connection and every reconnect, hydrate active memory jobs from the authoritative jobs endpoint or a new event-stream snapshot. The sequence must avoid a snapshot/live race:

1. establish or register the live memory subscription and buffer events;
2. fetch an authoritative active-job snapshot;
3. seed/replace the active map from the snapshot;
4. apply buffered events in an explicit order;
5. continue live delivery.

The strongest protocol is a versioned memory-job snapshot plus versioned events. Without a memory revision, `updatedAt`, attempt count, and terminal-state rules must be used carefully, and a newly created job instance must be distinguishable from an old terminal instance that reused the same deterministic ID.

Do not clear the popup merely because the transport disconnected; that can falsely hide real work. Mark progress as reconnecting/stale if useful, then clear or replace it only after an authoritative snapshot says there are no active jobs.

### 4. Retire the per-job `open` display contract

`HypaV3ProgressPayload.open` is intrinsically ambiguous in a multi-job system. The server should send facts—identity, kind, status, attempts, timestamps—and the client should derive presentation. Likewise, the client should derive an aggregate count from its active map instead of relying on a producer-specific `queuedCount`.

If the side-effect payload must remain during a transition, consumers must treat its text as optional decoration for that identified job, never as global state.

### 5. Localize and make the UI accessible

Progress labels are currently constructed as hard-coded English on the server ([`server/fastify/src/memoryEvents.ts:114-141`](../../../server/fastify/src/memoryEvents.ts#L114-L141)). Derive localized labels on the browser from `kind`, `status`, and aggregate counts. Add an accessible name to the collapsed/expanded controls and an appropriate `role="status"`/`aria-live` region so a changing background task count is announced without forcing focus.

### 6. Keep the modal and global indicator on one reducer where practical

The modal already maintains chat-scoped job state and polls while active. Having a second, unrelated global progress store creates divergent truth. Prefer a shared normalized memory-job store with selectors for:

- all active jobs;
- active jobs for the selected chat;
- bounded terminal history for the modal;
- aggregate progress presentation.

## How should the fix be validated?

### Pure reducer tests

Add table-driven tests for the identified active-job reducer:

1. `A running -> B running -> A completed` leaves only B and keeps the derived popup open.
2. `A pending -> B pending -> A running -> A completed` leaves B pending.
3. Two jobs in the same chat do not collide.
4. Two kinds with the same chat do not collide.
5. Completing/cancelling/failing one exact job removes only that job.
6. Retry `running -> pending -> running` for the same instance remains active.
7. Duplicate terminal and duplicate running events are idempotent.
8. A non-terminal update after a terminal update for the same instance is rejected.
9. A genuinely new instance that reuses a deterministic logical ID is accepted using an instance/version discriminator.
10. An event with the same job ID in a different chat cannot affect the first chat.

Assert the complete active map and derived presentation after every step, not just calls to a mocked setter.

### Bootstrap and transport tests

- Change the current single-event bootstrap test at [`src/ts/bootstrap.test.ts:4453-4465`](../../../src/ts/bootstrap.test.ts#L4453-L4465) so it asserts that full chat/job identity reaches the reducer.
- Cover initial connect and reconnect hydration with an active job already in SQLite.
- Disconnect after a running event, let the job finish, reconnect, and assert the stale active entry is removed from an authoritative snapshot.
- Disconnect before the running event, reconnect while the job is active, and assert it appears.
- Force a memory event during event-stream setup/replay and assert it is either buffered or recovered by the snapshot.
- Confirm malformed/unrelated events do not corrupt the active map.

### Server tests

- Extend [`server/fastify/__tests__/memoryEvents.test.ts`](../../../server/fastify/__tests__/memoryEvents.test.ts) beyond its current error-redaction assertion to cover every status and retained identity.
- Extend event-route coverage from one pending job to an interleaved multi-job sequence.
- Cover a same-chat concurrent batch and verify each running/terminal event is independently identified.
- If adding memory revisions/snapshots, prove the subscription/snapshot handoff has no event-loss window.
- Verify automatic planner/follow-up enqueues appear in the active projection before the worker claims them.

### Component tests

- Render two active jobs and verify the collapsed aggregate count.
- Expand on a narrow viewport and verify chat/job grouping without overflow or focus loss.
- Terminate one job and assert the component remains mounted for the other.
- Terminate the last job and assert it unmounts once.
- Switch chats under both proposed selector policies.
- Verify translated labels, accessible button names, live-region semantics, keyboard operation, and reduced-motion behavior.

### End-to-end acceptance scenarios

At minimum, automate these browser scenarios against Fastify:

1. Create memory work in Chats A and B; finish A first; verify B remains visible and completes normally.
2. Create multiple summarize/embed jobs in one chat with concurrency greater than one; verify terminal events do not prematurely close progress.
3. Use two browser contexts; create a job from one and verify both contexts converge on the same truthful active set.
4. Put a mobile browser context offline between running and terminal events; reconnect and verify convergence.
5. Reload while a job is active and after a job has completed; both reloads must immediately show authoritative state.
6. Cancel one of several jobs; verify only that job leaves the active set.
7. Fail one of several jobs; verify the others stay visible and the failure is available through the terminal-status UI.

### Regression commands

Run focused suites during development, followed by the project-wide checks required for the actual implementation:

```sh
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/events.test.ts src/ts/server/memoryJobRefresh.test.ts src/ts/process/request/tests/serverMemory.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/memoryEvents.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts
pnpm check
pnpm check:server
```

The scalar setter's current unit test ([`src/ts/process/request/tests/serverMemory.test.ts:493-528`](../../../src/ts/process/request/tests/serverMemory.test.ts#L493-L528)) and bootstrap's one-event pass-through test both encode the deficient representation; passing those tests does not validate MS-09.

Investigation-time baseline verification passed: the four focused frontend files above ran 192 tests, the four focused server files ran 54 tests, and Prettier accepted this report. Those results confirm that the documented behavior is the currently tested behavior; they do not exercise or disprove the missing multi-job, snapshot/reconnect, or stale-refresh interleavings.

## Additional issues discovered outside the consolidated audit

Yes. The following issues were found during MS-09 tracing and are not documented as separate findings in the consolidated audit.

### A. Memory progress is live-only and can remain permanently stale after a stream gap

**Confidence: High. Suggested severity: Medium.**

Only command events receive SSE IDs and persisted replay. Memory frames have no ID ([`server/fastify/src/routes/events.ts:22-28`](../../../server/fastify/src/routes/events.ts#L22-L28)); the architecture explicitly says memory events are never replayed ([`docs/structure/data-and-events.md:340-356`](../../structure/data-and-events.md#L340-L356)). On reconnect, bootstrap re-establishes the stream and refreshes durable command resources, but it neither resets nor hydrates the global Hypa progress store ([`src/ts/bootstrap.ts:425-487`](../../../src/ts/bootstrap.ts#L425-L487)).

Consequences:

- miss `running`: an active job stays invisible until some later job event happens;
- miss terminal: `open: true` and old labels can persist indefinitely;
- connect during command replay/setup: the server does not subscribe to memory events until after replay is flushed, leaving an additional setup window ([`server/fastify/src/routes/events.ts:239-268`](../../../server/fastify/src/routes/events.ts#L239-L268)).

The fix is the race-safe active-job snapshot/reconciliation described above.

### B. A stale jobs GET can erase a newer live active-job update in the modal

**Confidence: High from code reachability; no focused reproduction test exists. Suggested severity: Medium-Low.**

The modal subscribes to events and starts its initial refresh on mount. If an older GET snapshot is in flight, a newer live active update can be applied first. When the older response arrives, `normalizeJobs` initializes its next map from only cached **terminal** jobs, not cached active jobs, and publishes the response list ([`src/ts/server/memoryJobRefresh.ts:73-95`](../../../src/ts/server/memoryJobRefresh.ts#L73-L95), [`src/ts/server/memoryJobRefresh.ts:152-165`](../../../src/ts/server/memoryJobRefresh.ts#L152-L165)). An empty stale response can therefore remove the newer active job and stop polling.

Existing tests protect a terminal event against an older “running” response for the same job, but do not protect a newer active event against an older empty/list response. A snapshot version or request watermark is needed; retaining all live updates received after the request began is a minimum client-side fix.

### C. The production terminal fence is unbounded and can reject a legitimately recreated deterministic job

**Confidence: High. Suggested severity: Low to Medium-Low.**

`terminalJobIdsByChatId` is module-global, stores every terminal ID, and has no production clear/prune call; the only repository callers of `clearMemoryJobTerminalUpdateFence` are tests. Server terminal rows, by contrast, are pruned after seven days by default ([`server/fastify/src/memoryRepository.ts:9-13`](../../../server/fastify/src/memoryRepository.ts#L9-L13), [`server/fastify/src/memoryRepository.ts:1384-1404`](../../../server/fastify/src/memoryRepository.ts#L1384-L1404)). Hypa summarize IDs are deterministic from chat, chunk, and model ([`server/fastify/src/memoryChunkPlanner.ts:170-172`](../../../server/fastify/src/memoryChunkPlanner.ts#L170-L172)).

A failed/cancelled terminal row can be pruned, then the same logical work can be enqueued under the same deterministic ID. A long-lived browser still considers that ID terminal and rejects its new pending/running events. The map also grows without a bound for the lifetime of the page.

Use a concrete job-instance/version identity, bound retained terminal state, and reconcile it with authoritative server state. Do not fence forever by logical ID alone.

### D. Automatic Hypa enqueues do not emit a pending event

**Confidence: High. Suggested severity: Low.**

The explicit jobs route emits immediately after enqueue, but chunk planning and missing-memory follow-ups call the repository enqueue functions without the app's event sink. Their first user-visible event is emitted only when the worker claims them as `running`. With a backlog or retry delay, automatically created pending work is invisible even without MS-09.

Route all job creation through an enqueue service that performs the transaction and emits the identified committed job event, or rely on the authoritative active-job projection with prompt refresh/polling.

### E. Worker events erase queue counts supplied by route events

**Confidence: High. Suggested severity: Low.**

Route events calculate the active count for that chat and include `queuedCount` ([`server/fastify/src/routes/memoryJobs.ts:55-68`](../../../server/fastify/src/routes/memoryJobs.ts#L55-L68)). Worker events omit it ([`server/fastify/src/memoryWorker.ts:256-259`](../../../server/fastify/src/memoryWorker.ts#L256-L259)). The server builder converts an absent count into empty `miniMsg`/`subMsg`, and the scalar setter replaces the earlier nonempty strings. Thus `2 queued` can disappear as soon as one job becomes running even while another remains queued.

Deriving counts from the identified active map removes the producer inconsistency.

### F. Cancelling a running memory job does not abort its provider request

**Confidence: High. Suggested severity: Low to Medium-Low, depending on provider cost.**

`DELETE /memory/jobs/:id` changes the SQLite status and emits `cancelled`, but there is no worker/provider cancellation handle associated with the job. The summarize handler creates its own deadline controller inside execution, and the route cannot abort it. Commit-time status checks prevent a cancelled job from being committed as completed, but provider work may continue until it finishes or times out. This can consume tokens, provider quota, battery/network, and time after the user believes cancellation succeeded.

Track an `AbortController` per running job and have cancellation signal it before or alongside the persisted terminal transition. Preserve the existing commit-time status guard as defense in depth.

### G. Progress strings bypass localization and the control lacks robust status semantics

**Confidence: High. Suggested severity: Low.**

The server constructs English strings such as “Waiting to summarize…” and “queued”; these cannot follow the browser's selected language. The collapsed button can have no accessible name when `miniMsg` is empty, and the changing progress text has no live status semantics. The aggregate redesign should render localized client-side strings and add explicit accessible names/status announcements.

## Final assessment

MS-09 is confirmed as written. The root cause is not merely that the store is “global”; it is that an independently emitted **per-job command** (`open: true/false` plus labels) is being mistaken for a **derived aggregate state**. The durable job layer already has the correct identities. The fix should retain those identities through a normalized client store, remove only the terminal job, derive the UI from the remaining active set, and reconcile that set authoritatively across initial load and reconnect.

The non-replay gap and terminal-fence lifetime issue should be addressed in the same design. Otherwise, changing the scalar into a map will fix the basic A/B overwrite while still allowing the map to become missing, stale, or poisoned.
