# MS-01 validation: accepted-send recovery is not durable

Validated: 2026-08-11

Consolidated finding: [MS-01 — Accepted-send recovery is process-memory only](../fastify-multichat-mobile-stability-audit-2026-08-11.md#ms-01--accepted-send-recovery-is-process-memory-only)

Audit revision: `9afde4658ea5b277493e9d7f6ef7aaf387544165`

Validation revision: `e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`

Verdict: **confirmed, High severity**. No relevant source file changed between
the audit and validation revisions.

## Executive conclusion

MS-01 is a broken durability handoff, not a failure to persist the user's
message. The application can durably accept a user-message row without durably
recording the obligation to start or recover the corresponding generation.
The append command and generation launch are separate HTTP operations. The
only object connecting them is a browser-memory promise owned by a module-local
coordinator.

If the page reloads or a mobile browser evicts the process after the append is
durable but before Fastify registers the generation job, bootstrap can recover
the append but cannot recover what should happen next. The result is a durable
user row with no assistant reply, no running job, and no retry banner. A retry
banner that was already shown is also lost on reload because that state is
memory-only.

The strongest fix is one idempotent send operation in which Fastify atomically
appends the user row and persists a generation-launch intent. Provider work
must remain outside the SQLite transaction, but a durable operation row must
bridge the transaction-to-worker boundary. A client-only journal can reduce
risk, but it is not sufficient unless the same operation and accepted-message
identity is carried through generation, job metadata, bootstrap, cancellation,
and finalization.

## What exactly is the bug?

The intended invariant is:

> Once a user-message append is durably accepted, the same operation must
> eventually have exactly one matching generation job, one matching durable
> assistant reply, or one durable and visible recovery state.

The current implementation guarantees none of those outcomes across browser
process loss. It durably stores the append, but all knowledge that the append
was a *send requiring a reply* is stored separately in JavaScript memory.

The relevant state has the following durability properties:

| Artifact | Storage and lifetime | Survives reload? | Links the append to required generation? |
| --- | --- | --- | --- |
| Composer draft | Writer/lineage-scoped `sessionStorage` record | Yes, for a normal reload | No |
| Pending append | Encrypted IndexedDB mutation request | Yes, after its staging transaction commits | No; it is only `POST /chats/:chatId/messages` |
| Accepted message | SQLite `messages` row plus revision/event and optional command receipt | Yes | No pending-reply or operation field |
| Coordinator operation | Module-local `Map<string, Promise<...>>` | No | Yes, but only in the live process |
| Failure/retry state | Svelte writable initialized to `[]` | No | Yes, but only in the live process |
| Running generation | Fastify process-memory job registry | Browser reload only, while the same server process lives | Only by chat ID, not accepted message or send operation |

The pending-mutation outbox is therefore working as designed, but its intent is
too narrow for this workflow. It stores a generic append request
([outbox schema and stores](../../../src/ts/server/pendingMutationOutbox.ts#L112),
[staging](../../../src/ts/server/pendingMutationOutbox.ts#L631)). On startup,
bootstrap replays those generic mutations and requires the outbox to drain
before loading resources
([bootstrap](../../../src/ts/bootstrap.ts#L265),
[replay](../../../src/ts/server/pendingMutationReplay.ts#L11)). Neither path
reconstructs an accepted-send operation.

The two objects that do contain the missing intent are explicitly ephemeral:
`coordinatedOperations` is a module-local map
([coordinator](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L46)),
and `acceptedSendRecoveries` is a writable initialized to an empty array
([recovery state](../../../src/ts/process/acceptedSendRecoveryState.ts#L7)).

## How does the bug affect users?

The primary user-visible result is a chat that permanently stops at the user's
message. It looks as though the send completed because the user row survives
reload, but there is no response and no explanation.

More specifically:

- The original composer is cleared after append acceptance, before generation
  begins ([composer handoff](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L881)).
  In the immediate-acceptance windows, the user loses both the editable draft
  and the only explicit retry path.
- The chat can reopen with the accepted user row as its final row, no generation
  pulse or Stop button, and no accepted-send alert. The alert renders only when
  an entry already exists in the process-local recovery writable
  ([UI](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2234)).
- The lifecycle recovery hooks do not repair this state. They query only
  Fastify's `activeGenerationJobs` and reattach a job that already exists
  ([reattach lifecycle](../../../src/ts/process/reattach.ts#L234)). An append
  stranded before job registration is invisible to them.
- Authoritative transcript hydration cannot recreate the intent. It can remove
  an existing recovery after finding an adjacent assistant row, but it never
  synthesizes a recovery for a reply-less user row
  ([acknowledgement rule](../../../src/ts/process/acceptedSendRecoveryState.ts#L58)).
- The user can send another message because the composer is not disabled by an
  accepted-send recovery. This can produce consecutive user rows and makes it
  less clear which row a later reply belongs to
  ([send button](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2337)).
- Plugin V3 callers lose their pending JavaScript call on process loss while
  the server can retain the appended row. Their next runtime has no operation
  result to inspect. The plugin uses the same coordinator, so this is the same
  defect rather than a separate bypass
  ([Plugin V3 send](../../../src/ts/plugins/apiV3/v3.svelte.ts#L1884)).

This is High severity under the consolidated audit's model: a durably accepted
operation can become silently stranded with no durable retry record.

## Exact code sequence

### Normal sequence

1. The composer captures a stable character/chat target and stores the current
   draft generation. A normal send or Draft Send constructs a user row and
   awaits `appendCurrentChatUserMessageForSend`
   ([normal send](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1478),
   [Draft Send](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1625)).

2. `appendCurrentChatUserMessageForSend` assigns a message ID, pushes the row
   into the local projection, freezes a one-request durable mutation, and sends
   `POST /commands/chats/:chatId/messages`
   ([client append](../../../src/ts/chatCommands.ts#L5019)). The mutation is
   staged under the character owner before network execution
   ([durable dispatch](../../../src/ts/chatCommands.ts#L558),
   [dispatch ordering](../../../src/ts/server/durableMutationDispatch.ts#L127)).

3. Fastify processes that command inside `BEGIN IMMEDIATE`. It checks the
   receipt first, validates the revision, appends the message, bumps the global
   revision, persists the command event and receipt, then commits
   ([transaction](../../../server/fastify/src/commands/mutations.ts#L208),
   [message route](../../../server/fastify/src/routes/commands.ts#L6823)). The
   message row, revision, event, and receipt are atomic with each other.

4. On a retryable transport failure, the client returns
   `{status: 'queued', messageId, settlement}`. That settlement is a live
   JavaScript promise backed by an in-memory listener for the mutation ID
   ([settlement listener](../../../src/ts/chatCommands.ts#L257)). On an immediate
   accepted response, the append returns `{status: 'ok', messageId}`
   ([append outcomes](../../../src/ts/chatCommands.ts#L5104)).

5. `handoffAcceptedSend` passes either result to
   `coordinateAcceptedChatSend`. A queued operation waits for its live
   settlement promise; an accepted settlement invokes the composer callback
   and enters `startAcceptedGeneration`
   ([coordinator gate](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L182)).

6. `startAcceptedGeneration` removes an old warning, waits 10 ms, creates an
   abort controller, and calls `sendChat` with only the captured chat target and
   the synthetic-say-nothing flag
   ([generation attempt](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L114),
   [start](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L167)).

7. The 10 ms sleep is only the minimum exposed interval. `sendChat` can still
   wait for context maintenance, generation-settings persistence, and persona
   persistence before it prepares the server request
   ([pre-request waits](../../../src/ts/process/index.svelte.ts#L277)). Request
   construction can also collect/upload inlay references before POSTing
   ([server-backed request](../../../src/ts/process/serverBackedSendChat.ts#L405)).

8. The generation request contains chat ID, character ID, mode, user-message
   text, and the durable flag. It contains neither the accepted message ID nor
   an accepted-send operation ID
   ([request type](../../../server/fastify/src/routes/generationChat.ts#L131),
   [input mapping](../../../server/fastify/src/routes/generationChat.ts#L695)).

9. Only when `startDurableGeneration` runs does Fastify create and register a
   recoverable job. The job is indexed by chat and projects chat ID, job ID,
   mode, and optional regenerate target through bootstrap
   ([job creation](../../../server/fastify/src/routes/generationChat.ts#L3876),
   [projection](../../../server/fastify/src/generationJobs.ts#L84),
   [bootstrap](../../../server/fastify/src/routes/bootstrap.ts#L45)).

10. After this point, browser reload recovery can reattach while the Fastify
    process remains alive. Once finalization persists the assistant row, normal
    hydration can recover the transcript. Those states are outside the core
    MS-01 interval.

### Vulnerable checkpoints

| Checkpoint | Durable state after process loss | Result after reload |
| --- | --- | --- |
| Outbox append committed, command not yet accepted | Append request and composer draft | Bootstrap replays the append; the settlement continuation is gone, so no generation starts |
| Server append committed, HTTP response not delivered | Message, revision, event, receipt, and possibly the still-staged outbox row | Receipt makes append replay idempotent; it does not recreate generation intent |
| Immediate append accepted, before/during the 10 ms delay | Message only; composer draft may already be cleared | No outbox row, job, or warning exists |
| Inside `sendChat` pre-request awaits | Message plus client process-local generation activity | Reload discards the activity; Fastify has no job to project |
| Generation failed, before recovery probe/record completes | Message, no proven job/reply | The not-yet-recorded warning disappears |
| Recovery banner already recorded | Message plus an in-memory warning | Reload initializes the recovery list to `[]` |

A process loss before the IndexedDB append staging transaction commits is a
generic outbox-durability boundary, not proof of MS-01. Conversely, after the
generation job is registered, failures move into reattach, replay,
cancellation, and finalization findings covered by MS-02 through MS-08.

## Why bootstrap cannot infer the missing work

The server does not have enough information to distinguish these legitimate
transcript shapes:

- a user row deliberately appended without requesting generation;
- a row whose generation has not yet been requested;
- a row whose generation failed and should be retried;
- a row intentionally left unanswered; or
- a row superseded by later transcript edits.

The command receipt proves only that one append request completed. The
generation endpoint receives text and chat ownership, not the accepted message
ID. Its prompt assembler deduplicates the submitted text against the current
last user row, or creates a new working row if it does not match
([prompt assembly](../../../server/fastify/src/prompt/assemble.ts#L970)). The
job projection then exposes no accepted-row identity. Inferring “every final
user row needs a reply” would therefore create unintended or duplicate model
requests.

This is also why merely scanning transcripts during bootstrap is not a safe
fix.

## Changes needed to fix MS-01

### Preferred design: atomic append-and-enqueue on Fastify

Introduce one client-generated `operationId` and one client-generated
`messageId`, then use a single idempotent server send endpoint for standard
sends.

Within one SQLite transaction, that endpoint should:

1. validate database lineage, active-writer ownership, character ID, chat ID,
   message ID, and immutable operation fingerprint;
2. append the user message exactly once, or verify that an idempotent replay
   refers to the byte-equivalent existing row;
3. insert an accepted-send operation row in a durable `accepted`/`pending`
   state, including the operation ID, accepted message ID, stable target,
   mode/synthetic flag, creator writer identity, and timestamps;
4. bump the revision and persist the resource event/response receipt; and
5. commit before launching provider work.

Provider execution must not occur inside the transaction. After commit, a
launcher should atomically claim the pending operation, create or recover one
job, and update the operation with its job ID. If launch fails or the server
restarts between commit and claim, the durable row must remain `pending` or
become explicitly `retryable_failed`; it must never disappear.

The operation state machine should distinguish at least:

- `pending` — append accepted, job not yet accepted;
- `running` — exact job ID assigned;
- `completed` — exact assistant message/finalization recorded;
- `retryable_failed` — user- or policy-retryable with a stable cause;
- `terminal_failed` or `cancelled` — explicit terminal outcome.

State transitions must be conditional/idempotent. Retrying the same operation
ID must return or reattach the existing operation rather than append another
row or launch a second provider request.

### Carry identity through every recovery surface

The accepted `messageId` and `operationId` must be present in:

- the generation request and response;
- the in-memory job record and `job_accepted` frame;
- `activeGenerationJobs` or a replacement operation projection in bootstrap;
- reattach, status, retry, and cancellation APIs;
- finalization and its retry-journal row; and
- resource events used to reconcile the browser transcript.

Chat ID alone is not operation ownership. This identity work is shared with
MS-02, MS-04, and MS-07; implementing persistence without exact identity would
leave the recovery decision ambiguous.

### Make the browser a projection of the durable operation

The coordinator map can remain as an in-page duplicate-call optimization, but
it must stop being the authority. Bootstrap should load unresolved accepted
sends after writer/outbox preparation and reconcile each exact operation
against:

1. its append acceptance,
2. an exact running job,
3. an exact completed assistant result, or
4. an explicit durable failure state.

The recovery banner should be derived from that projection and survive reload.
It should display one entry per unresolved operation, or explicitly disclose a
count and let the user address each operation. It must clear only after an
exact operation transition, never because some job exists for the same chat.

Composer-draft cleanup should be tied to the durable operation. Once the
combined server operation is accepted, clearing the captured draft is safe
because a recovery state now exists even if job launch is delayed. A newer
draft generation must remain protected by the current generation token.

All standard append-then-generate call sites should use the same operation
contract. That includes the main composer, Draft Send, Plugin V3, and the
DevTool/multisend paths already identified under MS-10.

### Incremental fallback if the combined endpoint cannot land first

A smaller first step is a lineage- and writer-scoped encrypted client journal
persisted *before* the append. It would record operation ID, message ID, stable
target, immutable request payload/fingerprint, synthetic flag, outbox mutation
ID, and state. Bootstrap would resume the journal after generic outbox replay.

That fallback still requires the server generation request and job projection
to carry the same operation/message IDs. Serializing the existing Svelte
writable or storing only a chat ID is not sufficient: it cannot safely handle
multi-tab ownership, a lost response after server job creation, more than one
same-chat accepted send, or idempotent retry.

## How the fix should be validated

### Invariants to assert in every test

For every accepted send, assert all four views of truth:

1. **Visible UI:** exact user and assistant rows, correct banner/progress state,
   and correct composer draft.
2. **Client durability:** operation journal/projection, pending-mutation outbox,
   draft record, and active job projection.
3. **Server authority:** exact SQLite message rows, accepted-send operation row,
   command receipt/revision, and finalization-retry row.
4. **Execution:** zero or one exact job as appropriate, never two; the job and
   final assistant row must reference the same operation and user-message ID.

The universal postcondition should be: no accepted operation is left without
an exact job, exact reply, or persistent explicit recovery state.

### Unit and integration coverage

Add client state-machine tests for:

- immediate acceptance, queued acceptance, terminal append failure, and
  transient generation-launch failure;
- a simulated fresh JavaScript runtime at every state transition;
- bootstrap reconstruction after the generic append outbox is replayed;
- idempotent duplicate calls with the same operation ID;
- two unresolved sends in one chat and sends in two different chats;
- retry of an older accepted message when a newer row exists;
- writer handoff, database-lineage replacement, stale records, and cleanup;
- captured-draft deletion versus preservation of a newer draft generation; and
- exact recovery removal only after matching job/completion proof.

Add Fastify integration tests that inject failure immediately:

- before the append/operation transaction commits;
- after append but before operation insert inside the transaction, proving full
  rollback;
- after commit but before the initial response is sent;
- after commit but before the launcher claims the operation;
- after job creation but before the operation row is updated;
- during a retry of the identical operation ID;
- while an unrelated same-chat job is running; and
- across server restart with a pending or apparently running operation.

The server tests must verify exact SQLite rows and revisions, not only HTTP
status. A request retried after a lost response must reuse the original message
and job; a changed payload under the same operation ID must fail closed.

### Production-stack browser/mobile matrix

Add a real composer-to-stream-to-reload Playwright journey using the built SPA,
Fastify, and SQLite. The repository currently documents that this journey does
not exist ([test-suite gap](../../tests/README.md#L7)). Run it with desktop and a
Pixel-class mobile profile and hold the relevant request/server seam at each
checkpoint:

1. outbox persisted before append dispatch;
2. server append/operation committed before response delivery;
3. operation accepted before job launch;
4. generation POST received before job registration;
5. job registered before job ID/header delivery;
6. failure state committed before banner delivery; and
7. completed assistant persisted before terminal/resource delivery.

At each checkpoint exercise `page.reload()`, `visibilitychange`,
`pagehide/pageshow`, offline/online, and a fresh page/runtime using the same
persistent browser profile. Add a two-tab active-writer case and a server
restart case. Do not treat reappearing transcript text alone as success; check
the four views of truth above.

The current browser smoke only checks responsive composer accessibility and
mobile touch reordering
([browser smoke](../../../server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts#L331)).
The reroll smoke drains a direct generation request before reloading
([reroll smoke](../../../server/fastify/browser-smoke/rerollSwipePersistence.spec.ts#L65)),
so neither reaches MS-01.

### Existing regression coverage and validation run

The existing tests are useful but remain same-runtime tests:

- coordinator tests cover queued settlement, failure/retry, transcript proof,
  and active-job discovery
  ([coordinator tests](../../../src/ts/process/acceptedSendCoordinator.test.ts#L71));
- recovery-state tests cover adjacency and hydration cleanup
  ([recovery tests](../../../src/ts/process/acceptedSendRecoveryState.test.ts#L21));
- composer tests prove a queued send deliberately retains its draft until the
  in-memory settlement resolves
  ([composer test](../../../src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts#L1860));
- Plugin V3 tests wait for the same live settlement promise
  ([Plugin test](../../../src/ts/plugins/apiV3/v3.svelte.test.ts#L818)); and
- the durable server test proves that an explicit append survives a later
  same-chat generation 409, but supplies no operation linkage
  ([server test](../../../server/fastify/__tests__/durableGeneration.test.ts#L1170)).

During this validation, the five focused frontend files passed **159 tests**
and the focused Fastify durable-generation file passed **40 tests**. These
passing baselines confirm the documented current behavior; they do not exercise
process loss between append and job registration.

## Additional issues discovered outside the consolidated text

No additional independent root cause survived de-duplication against MS-02
through MS-10 and the audit's explicit server-restart limitation. Two concrete
user-facing consequences were confirmed that are not explicitly described in
the consolidated report and should be added as MS-01/MS-02 validation cases.

### Addendum A — retry can generate for a newer user row and clear the older recovery

**Confidence:** confirmed by reachable source control flow.

**Severity:** High under the audit rubric when two unresolved accepted sends
coexist, because successful work is attributed to the wrong accepted row.

Sequence:

1. Accepted user row A fails generation and records recovery A.
2. The composer remains enabled; the user sends row B. Its generation also
   fails, leaving B as the current tail and recording recovery B.
3. The UI selects the first recovery for the chat, which can be A
   ([selection](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L224)).
4. Retrying A constructs a request containing A's `messageId`, but passes only
   `expectedTarget` and the synthetic flag to `sendChat`; the message ID is not
   supplied to generation
   ([retry](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L233)).
5. Server-backed send derives `userMessage` from the *current last user row*,
   which is B
   ([request construction](../../../src/ts/process/serverBackedSendChat.ts#L426)).
6. If B generates successfully, `retryAcceptedChatSend` removes recovery A
   immediately without checking whether A gained an adjacent reply
   ([success cleanup](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L244)).

This is a distinct reproduction from MS-02's “some active job proves success”
example, but it has the same missing operation/message-identity root cause. The
fix must make retry address the exact accepted message, and it must refuse or
explicitly rebase when that row is no longer the valid transcript tail.

### Addendum B — a replayed queued append can also restore the same text as an unsent draft

**Confidence:** confirmed for a normal reload in the same tab/session.

**Severity:** Medium. It can lead to a duplicate resend and obscures whether the
first send was accepted.

The composer persists its captured draft in writer/lineage-scoped
`sessionStorage` and restores it after a fresh runtime
([draft storage](../../../src/lib/ChatScreens/DefaultChatScreen.composerDrafts.ts#L138),
[screen restore](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1089)).
For a queued append, the draft is deliberately retained until the live
settlement promise reports acceptance
([queued cleanup](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L850)).

If the page reloads before that promise resolves, bootstrap adopts the pending
outbox's writer identity, replays and accepts the append, and initializes the
same draft-recovery scope
([bootstrap ownership](../../../src/ts/bootstrap.ts#L265)). The old settlement
callback no longer exists, so the accepted row appears in the transcript while
the identical text can be restored into the composer. The user can reasonably
press Send again and create a duplicate row.

The durable operation fix should reconcile the exact captured draft generation
when replay establishes append/operation acceptance. Text matching alone is
not safe because the user may intentionally send identical messages.

## Historical comparison

The pre-Fastify app is not a safe fallback design. It pushed the user row into
the mutable browser database, waited 10 ms, and then called generation
([historical UI](../../../../Risuai/src/lib/ChatScreens/DefaultChatScreen.svelte#L192)).
Its database autosave was separately debounced by 500 ms and retried later
([historical autosave](../../../../Risuai/src/ts/globalApi.svelte.ts#L344)).
It had no atomic append-and-generate transaction or durable accepted-send
ledger either.

The Fastify migration makes the failure substantially more deterministic: the
append command can be durably committed before generation is even requested.
Historical behavior is therefore context, not a compatibility requirement or
an implementation model.

## Exit criteria

MS-01 is fixed only when all of the following are true:

- every accepted user send has a lineage-scoped, stable operation ID and
  accepted message ID;
- append acceptance and generation intent are one atomic durable boundary;
- restart/reload always yields an exact running job, exact completed reply, or
  persistent explicit recovery state;
- retry, cancellation, reattach, and completion address the exact operation;
- the same operation ID cannot append or launch twice;
- composer recovery cannot present an accepted send as an unsent draft;
- multiple unresolved same-chat sends cannot be mis-targeted; and
- the production browser/mobile fault-injection matrix passes while asserting
  UI, client durability, SQLite authority, and execution state.
