# MS-05 validation: a missing finalization journal is reported as queued

Validated: 2026-08-11

Consolidated finding: [MS-05](../fastify-multichat-mobile-stability-audit-2026-08-11.md#ms-05--a-missing-retry-record-is-reported-as-queued)

Verdict: **Confirmed**

Severity: **High**

Confidence: **High**

## Executive conclusion

MS-05 is a real durability-contract bug in durable chat generation.

The server is designed to write a SQLite retry row before it attempts final
transcript persistence. That row is the write-ahead recovery record containing
the generated assistant message, alternates, script mutations, target identity,
and assembly-time freshness snapshot. A later retry sweep can recover a failed
final write only if this row exists.

The current code does not carry the result of that journal write to the error
classifier. If the journal insertion itself throws, the exception reaches a
caller that asks only whether it is an `EntityNotFoundError` or
`ValidationError`. Almost every journal failure is neither, so the caller emits
`persistenceDisposition: 'queued'` and a `retry_queued` metric despite having no
evidence that anything was queued. The browser trusts the disposition, retains
the streamed assistant projection, and records an in-memory provisional state.
There is no SQLite row for the retry worker to process.

The required invariant is:

> `queued` may be emitted if and only if creation of the replayable SQLite
> finalization record has succeeded.

This invariant should be encoded as an explicit journal/finalization outcome,
not inferred from the class of the later exception.

This investigation used the current tree at
`e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`. The consolidated audit names
revision `9afde4658ea5b277493e9d7f6ef7aaf387544165`; there is no diff between those
revisions in the MS-05 server, client, test, or architecture files reviewed
here.

## What exactly is the bug?

### Intended write-ahead sequence

`GenerationFinalizationAttempt` contains all material needed to replay a
durable result: generation and chat IDs, mode, optional target ID, primary and
alternate messages, post-generation mutations, and the target snapshot
([generationFinalizationRetry.ts:13-24](../../../server/fastify/src/generationFinalizationRetry.ts#L13-L24)).
The retry table stores that data under the generation ID with `pending` or
`terminal` status
([generationFinalizationRetry.ts:103-124](../../../server/fastify/src/generationFinalizationRetry.ts#L103-L124)).

The intended sequence is:

1. Upsert the complete attempt as a pending SQLite retry row.
2. Try the authoritative transcript/script/alternate write.
3. If persistence succeeds, delete the retry row.
4. If persistence fails, retain the row and record whether the failure is
   retryable or terminal.

The upsert itself is synchronous and uses `generation_id` as its idempotency
key
([generationFinalizationRetry.ts:127-168](../../../server/fastify/src/generationFinalizationRetry.ts#L127-L168)).
The app sweeps pending rows once at startup and every five seconds by default
([app.ts:349-383](../../../server/fastify/src/app.ts#L349-L383)).

### Actual failure

The journal upsert is outside the `try` that handles the authoritative
persistence attempt:

- the closed-database guard can throw before any insert;
- `enqueueGenerationFinalizationRetry()` can throw while serializing or
  executing the upsert; and
- only after that call succeeds does the inner `try` begin.

See
[generationChat.ts:3225-3246](../../../server/fastify/src/routes/generationChat.ts#L3225-L3246).

The outer caller catches every one of those failures, but its only classifier
is `isTerminalGenerationFinalizationError()`. That function recognizes only
`EntityNotFoundError` and `ValidationError`
([generationChat.ts:3182-3188](../../../server/fastify/src/routes/generationChat.ts#L3182-L3188)).
Every other error is emitted as both:

- metric status `retry_queued`; and
- SSE `persistenceDisposition: 'queued'`.

See
[generationChat.ts:3416-3457](../../../server/fastify/src/routes/generationChat.ts#L3416-L3457).

This is a phase-classification error. “Not a terminal domain-validation error”
does not mean “the retry journal exists.”

### Failure cases that reach the bad branch

The following failures can occur before a row is confirmed:

- the database has already been closed during a shutdown straggler;
- SQLite rejects the upsert because the database is busy or locked;
- SQLite reports an I/O, full-disk, read-only, corruption, or constraint error;
- serialization of the message, alternates, mutations, or snapshot throws; or
- statement preparation/execution otherwise fails.

The closed-database case is explicit in the source. The upsert serializes four
payloads before/during `.run()`, so serialization and SQL failures share the
same unjournaled path
([generationFinalizationRetry.ts:127-168](../../../server/fastify/src/generationFinalizationRetry.ts#L127-L168)).

SQLite is opened in WAL mode with `synchronous = NORMAL`; the project explicitly
accepts possible loss of the latest commit on OS/power failure. MS-05 is
different: it is a reachable software path that claims a row was queued even
when the insert call did not complete successfully
([db.ts:319-365](../../../server/fastify/src/db.ts#L319-L365)).

### Outcome truth table

| Finalization outcome | Retry row | Current wire result | Correct result |
| --- | --- | --- | --- |
| Journal insert fails before persistence | Not confirmed, normally absent | `queued` | `unconfirmed`/`not_queued`, or at minimum `rejected`; never `queued` |
| Journal insert succeeds, final persistence has a retryable failure | Pending | `queued` | `queued` |
| Journal insert succeeds, final persistence has a validation/not-found failure | Terminal | `rejected` | `rejected` |
| Journal insert, persistence, and cleanup succeed | Absent because it was deleted | terminal `done` | terminal `done` |
| Persistence commits but retry-row deletion fails | Still present | error + `queued` | committed result with cleanup/replay pending; see additional issue A-4 |

The second row is the legitimate reason for the `queued` disposition. MS-05 is
the first row being collapsed into it.

## How does the bug affect users?

### Immediate effect

The browser has already painted provider tokens into a client-side assistant
projection when finalization runs. A new send appends an empty assistant row
keyed by the generation ID and fills it as tokens arrive
([streamResponse.ts:122-166](../../../src/ts/process/postGeneration/streamResponse.ts#L122-L166),
[streamResponse.ts:223-260](../../../src/ts/process/postGeneration/streamResponse.ts#L223-L260)).

When the erroneous SSE `error` arrives, the client parser accepts `queued` and
passes it through its terminal result
([serverChat.ts:841-882](../../../src/ts/process/request/serverChat.ts#L841-L882)).
`applyServerBackedTerminal()` then deliberately preserves the streamed row and
adds a queued-persistence entry instead of rolling the projection back
([serverBackedSendChat.ts:693-739](../../../src/ts/process/serverBackedSendChat.ts#L693-L739)).

The result therefore looks like a recoverable persistence delay even though no
recovery work exists. The normal send lifecycle also reports a generation
failure; depending on the entry point, the accepted-send coordinator can add
its separate “Retry reply” recovery banner. That banner is not proof of a
finalization retry row.

### After refresh, mobile process eviction, or authoritative hydration

The assistant text exists only in the disposable browser projection. The
authoritative server transcript still has the state from before finalization,
and the retry worker has no row to replay. A refresh or process eviction loses
the optimistic row. An authoritative chat hydration can also replace it with
the server transcript.

For the supported modes, the visible consequence is:

- **send:** the apparently generated assistant reply disappears, leaving the
  persisted user turn without that reply;
- **continue:** the locally extended assistant text reverts to its previously
  persisted value; and
- **regenerate:** the provisional replacement/candidate is not authoritative,
  so the prior server-owned target/candidate state returns.

Post-generation chat-variable, character-field, local-lore, and alternate
candidate changes carried in the attempt are also not saved. Automatic
generated-message translation and notification follow-up begin only after
successful persistence, so they are not a substitute for the missing record
([generationChat.ts:3460-3539](../../../server/fastify/src/routes/generationChat.ts#L3460-L3539)).

### Why the severity is high

The provider call may have completed successfully and the user may have read
the full response. The failure occurs at the final durability boundary, after
the expensive and user-visible work. The server then makes a false recovery
claim. A mobile refresh or OS eviction turns that claim into silent loss of the
generated result, and no background sweep can repair it.

## Exact code sequence

1. The browser posts a durable `send`, `continue`, or `regenerate` request.
   Fastify creates a reconnectable job, indexes it by chat, attaches the first
   viewer, and launches the detached runner
   ([generationChat.ts:3883-3943](../../../server/fastify/src/routes/generationChat.ts#L3883-L3943)).

2. The runner emits provider token frames into the replayable job buffer. The
   browser consumes them and updates the owned local assistant projection
   ([generationChat.ts:3765-3809](../../../server/fastify/src/routes/generationChat.ts#L3765-L3809),
   [streamResponse.ts:223-260](../../../src/ts/process/postGeneration/streamResponse.ts#L223-L260)).

3. On successful provider completion, `emitProviderChunks()` calls the
   post-generation callback before emitting terminal `done`
   ([providerTransport.ts:99-125](../../../server/fastify/src/prompt/providerTransport.ts#L99-L125)).

4. `buildDurablePostGeneration()` derives the final assistant message,
   alternates, script mutations, target ID, and freshness snapshot, then calls
   `queueAndPersistGenerationFinalization()`
   ([generationChat.ts:3367-3435](../../../server/fastify/src/routes/generationChat.ts#L3367-L3435)).

5. `queueAndPersistGenerationFinalization()` checks `db.isOpen`, then calls the
   journal upsert before entering its persistence `try`
   ([generationChat.ts:3225-3246](../../../server/fastify/src/routes/generationChat.ts#L3225-L3246)).

6. In the MS-05 path, the guard or upsert throws. Authoritative transcript
   persistence is never attempted, `markGenerationFinalizationRetryFailure()`
   is not reached, and no retry row is confirmed.

7. The outer catch classifies the exception by domain error type rather than by
   journal phase. Because it is not a validation/not-found error, it emits an
   SSE `error` with reason `generation_persistence_failed`, disposition
   `queued`, and the generation projection. It also records the misleading
   `retry_queued` metric
   ([generationChat.ts:3436-3457](../../../server/fastify/src/routes/generationChat.ts#L3436-L3457)).

8. The client SSE reader resolves the request and terminal promises as failed,
   retaining the parsed disposition and projection
   ([serverChat.ts:841-882](../../../src/ts/process/request/serverChat.ts#L841-L882)).

9. The stream consumer has already produced a `StreamMessageProjection` with
   the prior data, owned data, row identity, and whether it appended the row
   ([streamResponse.ts:344-358](../../../src/ts/process/postGeneration/streamResponse.ts#L344-L358)).

10. The terminal handler's `queued` branch preserves that projection and writes
    an entry into `queuedGenerationPersistences`
    ([serverBackedSendChat.ts:714-739](../../../src/ts/process/serverBackedSendChat.ts#L714-L739),
    [generationPersistenceState.ts:4-19](../../../src/ts/process/generationPersistenceState.ts#L4-L19)).

11. The server marks the detached job done and releases the same-chat lock
    ([generationChat.ts:3854-3873](../../../server/fastify/src/routes/generationChat.ts#L3854-L3873)).
    The periodic retry sweep selects only actual `pending` rows, so it can never
    discover this generation
    ([generationFinalizationRetry.ts:227-275](../../../server/fastify/src/generationFinalizationRetry.ts#L227-L275)).

12. On reload, bootstrap projects active process-local jobs but not SQLite
    finalization retries. This job is already done, the client provisional store
    is initialized empty, and the server transcript contains no generated result
    ([bootstrap.ts:33-53](../../../server/fastify/src/routes/bootstrap.ts#L33-L53),
    [generationPersistenceState.ts:4-10](../../../src/ts/process/generationPersistenceState.ts#L4-L10)).

## What changes are needed?

### 1. Make journal creation an explicit outcome

Change the finalization boundary so it returns or throws a typed phase-aware
result. Do not let the caller infer journaling from the later error class.

A suitable internal state model is:

```ts
type GenerationFinalizationOutcome =
  | { kind: 'persisted'; persistence: GenerationFinalizationPersistenceResult }
  | { kind: 'queued'; error: Error; journalConfirmed: true }
  | { kind: 'rejected'; error: Error; journalConfirmed: true }
  | { kind: 'unconfirmed'; error: Error; journalConfirmed: false }
```

`enqueueGenerationFinalizationRetry()` should return an explicit receipt (and
verify that the upsert affected the expected row), or the wrapper should convert
an insertion exception directly into `unconfirmed`. A successful synchronous
upsert is the point at which `journalConfirmed` becomes true.

The write-ahead insert should remain a separate committed boundary from the
targeted transcript transaction. Combining both into a single transaction that
rolls back on final persistence failure would also roll back the recovery row
and defeat the queue.

Primary files:

- [generationFinalizationRetry.ts](../../../server/fastify/src/generationFinalizationRetry.ts)
- [generationChat.ts](../../../server/fastify/src/routes/generationChat.ts)

### 2. Derive the wire disposition from the phase-aware outcome

Only `{ kind: 'queued', journalConfirmed: true }` may emit `queued` and
`retry_queued`.

For a failed/unconfirmed journal write, the minimal compatible change is to emit
the existing `rejected` disposition. The clearer change is a new literal such
as `unconfirmed` or `not_queued`, because target rejection and inability to
establish the journal are operationally different. If a new literal is used,
update the duplicated contracts and parser in:

- [sseEvents.ts:107-123](../../../server/fastify/src/prompt/sseEvents.ts#L107-L123)
- [serverChatEvents.ts:238-256](../../../src/ts/process/request/serverChatEvents.ts#L238-L256)
- [serverChat.ts:121-130](../../../src/ts/process/request/serverChat.ts#L121-L130)
- [serverChat.ts:841-877](../../../src/ts/process/request/serverChat.ts#L841-L877)

The client should treat an unconfirmed journal like rejection for projection
ownership: remove/restore only the still-owned optimistic data and perform a
strict authoritative hydration. It must not call
`markGenerationPersistenceQueued()`
([serverBackedSendChat.ts:286-321](../../../src/ts/process/serverBackedSendChat.ts#L286-L321)).

For an I/O failure where the driver cannot prove whether the insert committed,
`unconfirmed` is more accurate than either `queued` or `rejected`. The client
can reconcile immediately; if a row later proves to exist and succeeds, the
normal `generation.persisted` resource event will reapply the authoritative
result.

### 3. Separate metrics and logs

Emit distinct statuses at least for:

- `journal_error` / `journal_unconfirmed`;
- `retry_queued` after a confirmed row;
- `terminal_error` after a confirmed terminal row;
- `persisted`; and
- `cleanup_pending` when persistence committed but retry-row deletion failed.

Include `generationId`, `chatId`, the failed phase, and `journalConfirmed`.
Do not log generated text or serialized attempt contents.

### 4. Do not let failure bookkeeping mask the original outcome

`markGenerationFinalizationRetryFailure()` currently returns `void` and does not
check whether its update changed a row
([generationFinalizationRetry.ts:207-225](../../../server/fastify/src/generationFinalizationRetry.ts#L207-L225)).
It should return a checked receipt. If marking fails after the insert succeeded,
preserve the original persistence error and separately report the bookkeeping
failure; the known journal receipt still controls whether `queued` is truthful.

Likewise, distinguish authoritative persistence from journal cleanup. If the
message transaction committed but deleting the retry row failed, the result is
already durable. The remaining row is safe to replay through the existing
snapshot/idempotency checks, but the client should not receive an unqualified
“generation persistence failed” result.

### 5. Fix the cancel-finalization caller at the same boundary

`persistRawCancelledResult()` uses the same helper but catches every error and
does nothing
([generationChat.ts:3543-3591](../../../server/fastify/src/routes/generationChat.ts#L3543-L3591)).
It needs the phase-aware outcome too. A confirmed queued partial result can be
left for the worker. An unconfirmed journal must produce an operational
error/metric and, for any attached or later reattached observer, an honest
terminal failure rather than an unconditional `done`.

### 6. Update the architecture contract

Document that “queued” means a confirmed replayable SQLite row, not merely a
retryable-looking exception. The relevant canonical descriptions are:

- [backend.md:243-265](../../structure/backend.md#L243-L265)
- [data-and-events.md:227-240](../../structure/data-and-events.md#L227-L240)
- [client-runtime.md:331-337](../../../src/docs/client-runtime.md#L331-L337)

## How should the fix be validated?

### Server unit and integration tests

Add the following cases to
[durableGeneration.test.ts](../../../server/fastify/__tests__/durableGeneration.test.ts):

1. **Journal insertion failure.** Disable the automatic retry sweep, gate the
   provider before completion, install a temporary SQLite `BEFORE INSERT`
   trigger that raises an error on `generation_finalization_retries`, then
   release the provider. Assert:

   - the SSE error is `unconfirmed`/`not_queued` (or `rejected` in the minimal
     design), never `queued`;
   - no retry row exists for the generation;
   - no authoritative assistant row, alternates, or post-generation mutations
     were written;
   - the metric is `journal_error`, not `retry_queued`; and
   - the job reaches a single, recoverable terminal state.

2. **SQLite busy at journal insertion.** Hold a write lock from a second
   connection after provider tokens are emitted and before finalization. Assert
   the same no-false-queue contract. This exercises a production-realistic path
   rather than only a mocked function.

3. **Serialization failure.** At the smallest exported/testable boundary,
   inject an attempt whose JSON serialization fails. Assert persistence is not
   attempted and the outcome is unconfirmed.

4. **Legitimate queue.** Keep or strengthen the existing transient persistence
   test at
   [durableGeneration.test.ts:798-823](../../../server/fastify/__tests__/durableGeneration.test.ts#L798-L823).
   Before running a retry sweep, directly assert that the exact generation ID
   has a pending row; then assert the wire disposition is `queued`. After the
   sweep, assert one assistant row, no duplicate event, and no retry row.

5. **Terminal finalization.** Retain stale-target/not-found coverage and assert
   a terminal row plus `rejected`, not `queued`
   ([durableGeneration.test.ts:1495-1527](../../../server/fastify/__tests__/durableGeneration.test.ts#L1495-L1527)).

6. **Cleanup failure after commit.** Inject failure only in retry-row deletion.
   Assert the authoritative assistant row is present, the retry row remains,
   the response is not described as an unqualified persistence failure, and the
   next sweep removes the row without duplicating the message or event.

7. **Cancel path.** Stream a partial response, cancel, and separately inject
   journal success/final-persist failure and journal insertion failure. Assert a
   confirmed retry is recoverable and an unconfirmed partial result is not
   silently reported as saved.

8. **Restart recovery.** With an actual pending row, close and rebuild the app,
   allow the startup sweep, and assert one authoritative message and row cleanup.
   With a failed insert, restart and assert there is no phantom work to sweep.

The tests already provide direct read-only inspection of the retry table at
[durableGeneration.test.ts:522-537](../../../server/fastify/__tests__/durableGeneration.test.ts#L522-L537).
That SQL assertion is the authoritative proof required by MS-05; observing only
an SSE disposition is insufficient.

### Client tests

Extend
[serverBackedSendChat.findMessage.test.ts](../../../src/ts/process/serverBackedSendChat.findMessage.test.ts)
and the server-chat SSE tests to cover:

- parsing and preserving the new unconfirmed disposition;
- confirmed `queued` retaining the still-owned stream projection;
- unconfirmed/rejected removing an appended projection;
- unconfirmed/rejected restoring the prior text for continue/regenerate;
- never overwriting a newer local edit while reconciling;
- strict hydration after an unconfirmed outcome;
- no queued marker for an unconfirmed journal; and
- resource hydration clearing a real queued marker only after it contains the
  matching generation.

The existing queued and rejected projection cases are at
[serverBackedSendChat.findMessage.test.ts:756-858](../../../src/ts/process/serverBackedSendChat.findMessage.test.ts#L756-L858).

### UI and reload validation

Add a production-stack browser journey that injects journal insertion failure
after visible tokens have arrived. For send, continue, and regenerate, assert
all four views of truth before and after reload:

1. rendered transcript;
2. browser projection and provisional/recovery stores;
3. authoritative `/chats/:chatId/messages` response; and
4. SQLite retry rows plus active/done generation jobs.

The essential assertions are that no UI says “queued” without a row, refresh
does not silently discard a reply that was represented as recoverable, and a
real queued row survives/replays across a browser reload and server restart.

### Focused regression commands

At minimum, run:

```text
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/durableGeneration.test.ts
pnpm exec vitest run src/ts/process/serverBackedSendChat.findMessage.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts
```

Then run the repository's full `pnpm test:all` gate because the SSE event union,
generation route, resource invalidation, and browser projection are shared
contracts.

## Additional issues discovered outside the consolidated audit

The following issues are not separately documented in the consolidated audit.
They should be tracked independently so closing MS-05 does not hide them.

### A-1 — The queued row indicator is wired but never rendered

Severity: **Medium**

Confidence: **High**

`Chats.svelte` computes `isGenerationPersistenceQueued` for each message and
passes it into `Chat.svelte`
([Chats.svelte:75-128](../../../src/lib/ChatScreens/Chats.svelte#L75-L128),
[Chats.svelte:218-254](../../../src/lib/ChatScreens/Chats.svelte#L218-L254)).
`Chat.svelte` declares and destructures the prop, but never reads it afterward
([Chat.svelte:189-200](../../../src/lib/ChatScreens/Chat.svelte#L189-L200),
[Chat.svelte:255-266](../../../src/lib/ChatScreens/Chat.svelte#L255-L266)). The
localized text “This reply is waiting to be saved and remains provisional” also
has no rendering call site
([en.ts:48-56](../../../src/lang/en.ts#L48-L56)).

Therefore the consolidated audit's wording that the reply can be “shown as
provisional and waiting to be saved” describes intended state, not the current
row UI. The separate accepted-send recovery banner may be visible for a normal
send, but it is a different state machine and does not identify a finalization
retry. Fixing MS-05 alone will not make legitimate queued persistence visible.

### A-2 — Legitimate finalization-queue state is not reload-reconstructable

Severity: **Medium**

Confidence: **High**

`queuedGenerationPersistences` is a module-local Svelte store initialized to an
empty array
([generationPersistenceState.ts:4-19](../../../src/ts/process/generationPersistenceState.ts#L4-L19)).
Bootstrap exposes active process-local generation jobs and translation jobs but
not pending/terminal finalization retries
([bootstrap.ts:33-53](../../../server/fastify/src/routes/bootstrap.ts#L33-L53)).

This means even a truthful queued result loses its browser marker on reload.
The SQLite worker can still recover the message, but until it does the
provisional reply can disappear during authoritative hydration with no queued
explanation, then later reappear on `generation.persisted`. A retry that later
becomes terminal is also not projected to the browser. The acknowledgement
logic removes an entry only when hydration contains the matching generation,
not when a retry becomes terminal
([generationPersistenceState.ts:21-37](../../../src/ts/process/generationPersistenceState.ts#L21-L37)).

Recommended follow-up: project writer-scoped pending/terminal finalization
state through bootstrap or a dedicated authenticated resource, reconstruct the
client state on reload, and send/refresh terminal transitions. This is distinct
from MS-05: it affects real retry rows after the false-queue bug is fixed.

### A-3 — Cancelled partial-result finalization swallows every persistence error

Severity: **High**

Confidence: **High**

The streaming cancel path attempts to journal and persist accumulated raw text,
but its catch block ignores every exception under the narrower comment “Chat
gone / changed”
([generationChat.ts:3543-3591](../../../server/fastify/src/routes/generationChat.ts#L3543-L3591)).
The caller then emits terminal `done` for the partial provider result
([generationChat.ts:3810-3832](../../../server/fastify/src/routes/generationChat.ts#L3810-L3832)).

Consequently an enqueue failure, SQLite I/O error, or retry-bookkeeping failure
can silently discard the stopped partial response with no retry record and no
accurate terminal/metric distinction. This shares MS-05's journal boundary but
is a separate false-success/silent-failure path and needs its own validation.

### A-4 — A retry-row cleanup failure is reported as persistence failure after the message committed

Severity: **Medium**

Confidence: **High**

The same `try` covers both authoritative persistence and deletion of the retry
row. If persistence succeeds and deletion throws, the catch marks a failure and
the outer layer emits an error/`queued`, even though the assistant message is
already authoritative
([generationChat.ts:3238-3245](../../../server/fastify/src/routes/generationChat.ts#L3238-L3245)).

The remaining row makes replay safe and eventual cleanup possible, but the user
sees a failed/provisional result when persistence actually committed. Track the
commit result separately from journal cleanup and let the subsequent idempotent
sweep clean the row.

### A-5 — Restored pre-snapshot continue/regenerate retries can write without a freshness fence

Severity: **High**

Confidence: **Medium-high**

Backup compatibility deliberately restores historical retry tables that lack
`target_snapshot_json` by inserting `NULL`
([repository.ts:3347-3394](../../../server/fastify/src/repository.ts#L3347-L3394)).
The compatibility test proves that this old shape, including a target message
ID, is supported
([backups.test.ts:684-780](../../../server/fastify/__tests__/backups.test.ts#L684-L780)).

Retry loading omits the snapshot when the column value is null
([generationFinalizationRetry.ts:256-274](../../../server/fastify/src/generationFinalizationRetry.ts#L256-L274)).
Both the already-persisted probe and the target freshness validation are
conditional on a snapshot
([generationChat.ts:3007-3022](../../../server/fastify/src/routes/generationChat.ts#L3007-L3022),
[generationChat.ts:3032-3045](../../../server/fastify/src/routes/generationChat.ts#L3032-L3045)),
but the code still writes using `targetMessageId`
([generationChat.ts:3076-3085](../../../server/fastify/src/routes/generationChat.ts#L3076-L3085)).

A pending retry restored from a pre-schema-18 backup can therefore replace a
continue/regenerate target without proving it still matches the assembly-time
row. Reachability requires such a historical pending row plus a target change
before its sweep, but the consequence is overwrite of newer transcript state.
Old unfenced rows should be quarantined/terminalized or migrated only when a
safe snapshot can be reconstructed.

### A-6 — Persistent retry failures have no backoff or user-visible terminal policy

Severity: **Low operational risk; medium UX risk**

Confidence: **Medium**

The schema records `failure_count`, but pending selection does not use it or a
next-attempt timestamp
([generationFinalizationRetry.ts:103-124](../../../server/fastify/src/generationFinalizationRetry.ts#L103-L124),
[generationFinalizationRetry.ts:227-254](../../../server/fastify/src/generationFinalizationRetry.ts#L227-L254)).
Every non-validation/non-not-found error remains pending and is retried on each
default five-second sweep
([generationChat.ts:3311-3347](../../../server/fastify/src/routes/generationChat.ts#L3311-L3347),
[app.ts:376-383](../../../server/fastify/src/app.ts#L376-L383)).

For a persistent non-terminal failure this produces unbounded retry/log churn
while A-2 leaves the user without reconstructable queue/failure state. Whether
infinite retry is a deliberate durability policy should be decided explicitly;
at minimum add bounded exponential backoff, health telemetry, and a visible
stalled state without silently deleting the attempt.

## Historical comparison

The pre-Fastify app at `/home/codex/Risuai` has no equivalent
`generation_finalization_retries` table, `persistenceDisposition` SSE contract,
or server-owned durable finalization worker. Its generation path writes streamed
text directly into the browser-owned `DBState` (`src/ts/process/index.svelte.ts`
lines 1591-1771), while the general database autosaver retries whole-database
saves up to four times and then alerts (`src/ts/globalApi.svelte.ts` lines
339-360 and 500-528).

MS-05 is therefore migration-specific. The Fastify port correctly introduced a
server-side write-ahead retry mechanism, but the wire disposition is currently
derived from the wrong fact. The old app does not provide a disposition or
retry-journal behavior to copy.

## Final assessment

MS-05 should remain open until all of the following are true:

- every emitted `queued` disposition is backed by a confirmed, complete SQLite
  retry row for the same generation ID;
- an unconfirmed journal write produces a distinct honest outcome and immediate
  ownership-safe client reconciliation;
- metrics distinguish journal creation, final persistence, and cleanup;
- send, continue, regenerate, cancel, reload, and restart tests inspect both
  the visible projection and the retry table; and
- the additional UI/reload/cancel/legacy-row issues above are either fixed or
  tracked separately with explicit acceptance criteria.
