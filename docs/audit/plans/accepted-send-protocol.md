# Accepted-send, lineage, Stop, and restart protocol

Status: design for review, 2026-08-11. This document defines the joint protocol program requested by the `Needs design` cluster in [`WORK-INDEX.md`](../WORK-INDEX.md). It does not change the work index or implementation.

## Decisions and scope

This design takes the following decisions as fixed:

- A standard send is one server-side operation. The user-row append and generation intent commit in one SQLite transaction. Provider work starts only after that transaction commits. The browser outbox remains a transport-recovery aid, not the authority for an accepted send.
- Stop is an acknowledged operation lifecycle. The UI says **Stopping…** until the exact operation is known to be cancelled, no longer running, or already completed. A failed acknowledgement remains visible and retryable.
- A server restart never resumes or regenerates provider work. It marks interrupted operations `abandoned` and exposes them as retryable. An already-created finalization journal may still finish persisting the exact provider result it contains.
- `operationId`, source/target message IDs, job ID, database lineage, and writer ownership are carried end to end. Chat ID remains the one-at-a-time execution scope; it is never operation ownership evidence.
- A stale reattach cannot restore an older job over a newer authoritative projection. All operation/job projections are epoch-aware, and same-chat selection is deterministic.
- Accepted-send recovery uses `retryable -> owned_by_job -> completed`. A Retry control is suppressed only by an exact operation match.
- The landed additive `done.outcome: 'cancelled'` remains the durable-stream terminal disposition. Absence continues to mean `completed` for older peers.
- Cancelling only the returned consumer `ReadableStream` is passive detach. Explicit Stop alone enters the acknowledged cancellation lifecycle.

The primary design covers durable `send`. Durable `continue` and `regenerate` use the same operation, attempt, Stop, restart, and reattach protocol but do not append a user row. Inline preview/non-durable generation remains connection-scoped and outside the durable operation ledger.

## Current seams being replaced

The design deliberately follows current boundaries rather than introducing a parallel generation stack:

- `appendCurrentChatUserMessageForSend()` in `src/ts/chatCommands.ts` currently submits `POST /api/v1/commands/chats/:chatId/messages` and returns an immediate or in-memory queued settlement.
- `coordinateAcceptedChatSend()` in `src/ts/process/acceptedSendCoordinator.svelte.ts` currently owns the append-to-generation continuation in a module-local map. `acceptedSendRecoveries` in `acceptedSendRecoveryState.ts` is also process-memory only.
- `assembleServerBackedSendChat()` in `src/ts/process/serverBackedSendChat.ts` currently rereads the live tail and sends its text, without the accepted message ID.
- `requestServerChatGeneration()` in `src/ts/process/request/serverChat.ts` currently learns the server job ID from `X-Risu-Generation-Job-ID` or `job_accepted`. `cancelServerChatGeneration()` is best-effort and returns no typed result.
- `startDurableGeneration()` in `server/fastify/src/routes/generationChat.ts` creates the process-local job, claims `GenerationJobRegistry.runningByChat`, attaches the first viewer, and then starts `runGenerationJob()`.
- `StreamJob` in `server/fastify/src/streamJobs.ts`, `GenerationJobRegistry.activeJobs()` in `generationJobs.ts`, and bootstrap currently carry only chat/job/mode identity.
- `generation_finalization_retries` in `generationFinalizationRetry.ts` is durable, but is keyed by `generation_id` without accepted-send lineage.
- `src/ts/process/reattach.ts` stores an array of active jobs, consumes a job before attach, and restores a failed attach by job ID alone. Stop falls back to the first same-chat entry.

The new design adds a durable owner around these seams; it does not infer intent by scanning transcripts.

## 1. Operation schema

### Identifier formats

The browser creates these identifiers with `crypto.randomUUID()` before it stages or sends anything:

| Identifier | Format and scope | Meaning |
| --- | --- | --- |
| `operationId` | Canonical lowercase RFC 4122 UUID v4, 36 characters; unique within `databaseLineage` | Stable accepted-send or durable-generation intent and its idempotency key |
| `acceptedMessageId` | Existing message ID shape; new sends use a lowercase UUID v4 | Exact user row atomically appended by a `send` operation |
| `draftGeneration` | Existing `DefaultChatComposerDraftGeneration` envelope: lineage, writer session, transcript identity, and sequence | Opaque client recovery generation cleared only after this exact operation is accepted |
| `retryRequestId` | Lowercase UUID v4 | Idempotency key for one explicit retry attempt |
| `jobId` | Server-created lowercase UUID v4 | One process-local execution attempt; it is not the durable operation identity |
| `attemptNo` | Positive integer, monotonically increasing per operation | Orders successive explicit attempts and disambiguates a newer job from a stale one |

The operation ID is never derived from chat ID, message text, revision, or writer session. Imported legacy message IDs remain supported as transcript IDs, but a new accepted send always creates its operation and message UUIDs before staging.

### SQLite tables

Migration v29 should introduce a focused `server/fastify/src/generationOperations.ts` store and call its DDL from `db.ts`. The DDL below is normative in shape; timestamp spelling may follow existing helpers.

#### `generation_operations`

One row is the durable intent and current outcome:

```sql
CREATE TABLE generation_operations (
  database_lineage TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  protocol_version INTEGER NOT NULL CHECK (protocol_version >= 0),
  request_origin TEXT NOT NULL
    CHECK (request_origin IN ('unbound', 'accepted_send', 'continue', 'regenerate', 'legacy')),
  creator_writer_session_id TEXT NOT NULL,
  creator_writer_epoch INTEGER NOT NULL CHECK (creator_writer_epoch >= 0),
  binding_server_instance_id TEXT,

  character_id TEXT,
  chat_id TEXT,
  mode TEXT CHECK (mode IS NULL OR mode IN ('send', 'continue', 'regenerate')),
  accepted_message_id TEXT,
  target_message_id TEXT,
  client_draft_generation_json TEXT
    CHECK (client_draft_generation_json IS NULL OR json_valid(client_draft_generation_json)),

  request_fingerprint TEXT,
  intent_json TEXT CHECK (intent_json IS NULL OR json_valid(intent_json)),
  accepted_revision INTEGER CHECK (accepted_revision IS NULL OR accepted_revision >= 0),

  state TEXT NOT NULL CHECK (state IN (
    'cancel_requested',
    'accepted',
    'launching',
    'owned_by_job',
    'stopping',
    'finalizing',
    'retryable',
    'abandoned',
    'completed',
    'cancelled',
    'terminal_failed',
    'invalidated'
  )),
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version > 0),
  projection_epoch INTEGER NOT NULL CHECK (projection_epoch > 0),
  current_attempt_no INTEGER CHECK (current_attempt_no IS NULL OR current_attempt_no > 0),

  desired_terminal_outcome TEXT
    CHECK (desired_terminal_outcome IS NULL OR desired_terminal_outcome IN ('completed', 'cancelled')),
  result_message_id TEXT,
  failure_code TEXT,
  failure_phase TEXT,
  last_error TEXT,
  provider_may_have_run INTEGER NOT NULL DEFAULT 0 CHECK (provider_may_have_run IN (0, 1)),

  cancel_requested_at TEXT,
  runner_settled_at TEXT,
  terminal_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  PRIMARY KEY (database_lineage, operation_id),
  CHECK (
    (
      request_origin = 'unbound'
      AND state = 'cancel_requested'
      AND request_fingerprint IS NULL
      AND intent_json IS NULL
      AND binding_server_instance_id IS NULL
    )
    OR request_origin = 'legacy'
    OR (
      character_id IS NOT NULL
      AND chat_id IS NOT NULL
      AND mode IS NOT NULL
      AND request_fingerprint IS NOT NULL
      AND intent_json IS NOT NULL
      AND binding_server_instance_id IS NOT NULL
    )
  ),
  CHECK (
    request_origin IN ('unbound', 'legacy')
    OR mode IS NULL OR mode <> 'send'
    OR accepted_message_id IS NOT NULL
  ),
  CHECK (
    request_origin IN ('unbound', 'legacy')
    OR (request_origin = 'accepted_send' AND mode = 'send')
    OR request_origin = mode
  )
);
```

`intent_json` is the normalized, credential-free launch specification: exact target, mode, accepted message snapshot for `send`, synthetic-say-nothing flag, reset/loadout choice, inlay asset references, normalized client context, and client capabilities needed to reproduce the request boundary. It does not contain provider credentials. `request_fingerprint` is a 64-character lowercase SHA-256 hex digest over RFC 8785 canonical JSON of the server-normalized immutable semantics. Optional fields are first normalized to their contract-defined omitted/null form. The digest excludes `baseRevision`, active/creator writer identity, response/projection fields, and retry counters; it includes every value that could change the appended row or assembled request.

The table is also the long-lived idempotency receipt. `binding_server_instance_id` distinguishes a same-process replay that may safely ensure the conditional post-commit launcher from a post-restart operation that must be abandoned. Bound operation rows are not time-pruned while their owning database lineage remains live. Chat/message deletion transitions them to `invalidated` instead of deleting their idempotency identity. Destructive import/restore rotates database lineage. Unbound `cancel_requested` tombstones are likewise retained until the client has observed the later submit rejection or the lineage rotates; correctness does not depend on a short TTL.

The current one-running-job-per-chat rule becomes a SQLite-backed live claim:

```sql
CREATE UNIQUE INDEX generation_operations_one_live_chat
ON generation_operations (database_lineage, chat_id)
WHERE state IN ('accepted', 'launching', 'owned_by_job', 'stopping');
```

`finalizing`, `retryable`, and `abandoned` do not hold this execution claim. That matches the current behavior that releases the process-local chat slot after the runner settles, even when durable finalization must retry. A retry must reacquire the partial unique claim before starting another attempt.

#### `generation_operation_attempts`

One row records each possible provider execution and makes retry billing risk auditable:

```sql
CREATE TABLE generation_operation_attempts (
  database_lineage TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  retry_request_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  server_instance_id TEXT NOT NULL,
  actor_writer_session_id TEXT NOT NULL,
  actor_writer_epoch INTEGER NOT NULL CHECK (actor_writer_epoch >= 0),
  status TEXT NOT NULL CHECK (status IN (
    'reserved', 'running', 'stopping', 'finalizing',
    'completed', 'cancelled', 'retryable_failed',
    'terminal_failed', 'abandoned'
  )),
  launch_revision INTEGER NOT NULL CHECK (launch_revision >= 0),
  provider_dispatch_started_at TEXT,
  provider_dispatch_finished_at TEXT,
  runner_settled_at TEXT,
  finalization_generation_id TEXT,
  failure_code TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (database_lineage, operation_id, attempt_no),
  UNIQUE (database_lineage, retry_request_id),
  UNIQUE (job_id),
  FOREIGN KEY (database_lineage, operation_id)
    REFERENCES generation_operations(database_lineage, operation_id)
);
```

The initial attempt uses `retryRequestId = operationId`. Later explicit Retry actions create a new `retryRequestId`; replaying that control request returns the same attempt. `provider_dispatch_started_at` is committed immediately before invoking provider dispatch. A crash after that marker is conservatively projected with `providerMayHaveRun: true`; the server does not claim whether the upstream actually billed.

#### `generation_operation_projection_state`

Operation transitions are outside the ordinary domain revision, so they need their own monotonic projection clock:

```sql
CREATE TABLE generation_operation_projection_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  epoch INTEGER NOT NULL CHECK (epoch >= 0)
);
```

Every transaction that changes an operation or its current attempt increments this singleton and copies the returned value to `generation_operations.projection_epoch`. Bootstrap returns the singleton as `generationOperationProjectionEpoch`. This is the fence used by lifecycle refresh and stale reattach; `schema_version.revision` remains the fence for transcript resources.

#### Existing table changes

`generation_finalization_retries` gains nullable compatibility columns:

```text
database_lineage, operation_id, operation_attempt_no,
actor_writer_session_id, actor_writer_epoch, accepted_message_id,
terminal_outcome ('completed' | 'cancelled')
```

They are required for all protocol-v1 rows and nullable only for legacy rows. `generation_id` remains the job/finalization ID. The assistant message's `generationInfo` gains additive `databaseLineage`, `operationId`, `acceptedMessageId`, `attemptNo`, and `jobId` fields.

`command_events` should gain nullable `database_lineage`, `operation_id`, `source_message_id`, and `job_id` columns so the atomic `message.appended` event and later `generation.persisted` event carry exact lineage through both live SSE and replay. Older command events remain valid with null lineage.

Device backups include all three new tables and the new finalization/event columns. Portable `.risu`/bundle exports do not export the live operation ledger. Backup restore copies the ledger, rotates database lineage as it does today, and rewrites the operation, attempt, finalization, event, and embedded protocol-v1 assistant lineage to the new database lineage in the same restore transaction. It then bumps the operation projection epoch and runs the boot reconciliation described below. The exhaustive lists in `server/fastify/src/repository.ts` and their backup tests must be updated together. A portable import may retain historical assistant metadata, but without a matching imported operation row it is never treated as live ownership.

### Durable operation states

| State | Durable meaning | UI disposition |
| --- | --- | --- |
| `cancel_requested` | Cancel arrived before a submit bound the `request_origin='unbound'` operation. No append or job may be created for this ID. | Stopping until the tombstone is acknowledged; then stopped |
| `accepted` | For `send`, user row and intent committed atomically. No attempt owns a job yet. | Preparing reply |
| `launching` | A server launcher claimed the operation and reserved the next attempt/job ID. Provider dispatch has not started. | Preparing reply |
| `owned_by_job` | The exact current attempt owns a registered job and is eligible to dispatch/run. | Generating or reconnecting; exact match suppresses Retry |
| `stopping` | Stop is durably recorded; the current attempt is being prevented or aborted. | **Stopping…** |
| `finalizing` | Provider/abort terminal data has a confirmed finalization journal or is in the atomic finalization transaction. | Saving reply or saving stopped partial; not a healthy generation |
| `retryable` | No job owns the operation. User action may start another exact attempt. | Actionable Retry |
| `abandoned` | Boot proved that the former process and job no longer exist, but not whether provider work was billed. No automatic retry. | Actionable Retry with restart/billing warning |
| `completed` | Exact result message and operation terminal state committed together. | Reconcile the exact message, then clear recovery |
| `cancelled` | No provider runner remains and cancellation is terminal. A partial may be persisted or explicitly reported rejected. | Stopped |
| `terminal_failed` | The exact operation cannot safely retry, for example its source/target was changed or finalization was terminally rejected. | Non-retryable error/Refresh |
| `invalidated` | Owning chat/source/target was explicitly deleted or replaced. | Non-retryable, normally hidden after authoritative refresh |

`abandoned` is a durable state, not an automatic queue. Bootstrap also returns `recoveryDisposition: 'retryable'` for it so the MS-07 UI model stays `retryable -> owned_by_job -> completed`.

### Transition table

Every transition is a conditional SQLite update over `(databaseLineage, operationId, state, stateVersion)`, in `BEGIN IMMEDIATE`, and bumps the projection epoch.

| From | To | Actor and condition |
| --- | --- | --- |
| absent | `cancel_requested` | `PUT .../cancellation`; creates the pre-submit `request_origin='unbound'` tombstone |
| absent | `accepted` | Atomic submit transaction; validates target/message, appends send row, inserts operation, bumps domain revision/event, commits |
| `cancel_requested` | `cancelled` | A later submit binds and fingerprints the request but does not append or launch |
| `accepted`, `retryable`, `abandoned` | `launching` | Post-commit launcher or explicit Retry; acquires same-chat unique claim and inserts the next attempt |
| `launching` | `owned_by_job` | Launcher has registered the exact preallocated job ID and commits the binding before provider dispatch |
| `launching` | `retryable` / `terminal_failed` | Pre-dispatch setup failed; classification depends on whether the same target can safely be tried again |
| `accepted`, `launching`, `retryable`, `abandoned` | `cancelled` | Cancel owns an operation with no running provider; it prevents later launch |
| `owned_by_job` | `stopping` | Cancellation endpoint records Stop and signals the exact current job after commit |
| `owned_by_job` | `finalizing` | Runner has a completed provider result and a confirmed finalization row |
| `stopping` | `finalizing` | Cancelled runner has a partial result and a confirmed cancelled finalization row |
| `stopping` | `cancelled` | Runner settled with no partial row to persist, or boot proves the stopped runner cannot still exist |
| `owned_by_job` | `retryable` / `terminal_failed` | Runner ended without a persistable result; error phase determines retryability and billing warning |
| `finalizing` | `completed` | Message/event/operation terminal transition commit atomically with `terminal_outcome='completed'` |
| `finalizing` | `cancelled` | Cancel partial/no-row policy and operation terminal transition commit atomically with `terminal_outcome='cancelled'` |
| `finalizing` | `terminal_failed` | Finalization fence is conclusively stale or another terminal validation fails; journal row is retained as terminal history |
| `finalizing` | `abandoned` | Startup finds neither the required journal nor an exact persisted result; records `finalization_record_missing` and never regenerates |
| `accepted`, `launching`, `owned_by_job` | `abandoned` | Startup sweep finds no terminal result/finalization row, or graceful shutdown records `server_shutdown` before aborting its process jobs |
| nonterminal | `invalidated` | Explicit chat/message destructive command invalidates the exact operation |

Terminal states never transition back. Retry creates a new attempt on the same nonterminal `retryable`/`abandoned` operation; it never appends a second user row. If an exact result is found before retry claims the chat, reconciliation transitions the operation to `completed` instead of dispatching.

### State invariants

1. A protocol-v1 `send` with non-null `accepted_revision` has exactly one accepted message ID, and that ID maps to exactly one user row in its chat. A bound cancel-before-submit operation has the same reserved message ID but null `accepted_revision` and no row; every replay returns `not_appended`.
2. The append, operation row, `message.appended` event, revision bump, and submit response data are one transaction.
3. At most one operation in a chat owns the live execution claim. Different chats remain concurrent.
4. Provider dispatch is legal only when the operation is `owned_by_job`, the attempt/job is current, and cancellation is not requested. The runner checks again after every awaited preflight and immediately before dispatch.
5. An attempt's job cannot settle another operation. Chat ID, text equality, and current tail are never substitutes.
6. A confirmed finalization row and operation `finalizing` state agree on operation, attempt, job/generation, source message, and intended terminal outcome; `desired_terminal_outcome` is non-null throughout `finalizing`.
7. Result-message persistence and the operation's `completed`/`cancelled` terminal transition are atomic.
8. Every state/attempt mutation advances the operation projection epoch.
9. `current_attempt_no` is non-null only while the exact attempt is `launching`, `owned_by_job`, `stopping`, or `finalizing`; transitions to retryable, abandoned, or terminal truth clear it. Historical attempts remain queryable in `generation_operation_attempts`.

## 2. Endpoint contract

### Atomic submit endpoint

`POST /api/v1/generation-operations` is authenticated, active-writer guarded, JSON, and rate-limited with the existing generation-submit policy. It is the only standard browser boundary allowed to combine a new user row with reply intent.

Implement it in a new `server/fastify/src/routes/generationOperations.ts` plugin backed by `generationOperations.ts`. Extract the durable branch around today's `startDurableGeneration()` in `routes/generationChat.ts` into a shared `launchGenerationOperation()` that accepts an already committed operation/attempt identity; the legacy route calls the compatibility wrapper, while the new route never falls back to chat-tail ownership.

Required headers:

```text
risu-auth
risu-writer-session
risu-database-lineage
content-type: application/json
```

Send request:

```json
{
  "protocolVersion": 1,
  "operationId": "2c1a2699-166a-46a8-a2f5-926e807b34a1",
  "baseRevision": 481,
  "characterId": "character-id",
  "chatId": "chat-id",
  "mode": "send",
  "acceptedMessageId": "5752a0d4-a086-4646-b463-458a22892b94",
  "message": {
    "role": "user",
    "data": "Hello",
    "time": 1786435200000,
    "name": null,
    "chatId": "5752a0d4-a086-4646-b463-458a22892b94"
  },
  "draftGeneration": {
    "databaseLineage": "...",
    "writerSessionId": "...",
    "transcriptIdentity": "...",
    "sequence": 17
  },
  "generation": {
    "syntheticSayNothing": false,
    "resetMessages": false,
    "loadoutId": "optional",
    "inlayAssetRefs": [],
    "clientContext": {},
    "clientCapabilities": {}
  }
}
```

`acceptedMessageId` must equal `message.chatId`, the row must validate through the existing `createMessageRecord()` rules, and its role must be `user`. The server validates the character/chat relationship, exact message-ID uniqueness, generation-settings readiness that can be checked synchronously, and the same-chat live claim before writing.

`continue` and `regenerate` use the same endpoint with no `message`/`acceptedMessageId`; they include the exact `targetMessageId` required by the mode. They create intent but do not append. Preview and inline non-durable modes are rejected by this endpoint.

For `send`, `acceptedRevision` is the post-append domain revision and the response includes `append`. For continue/regenerate, the transaction captures the validated current revision as `acceptedRevision` and advances only the operation projection epoch; it does not synthesize a transcript command event or domain revision, and `append` is omitted.

New acceptance returns `201 Created`; an idempotent replay returns `200 OK`. The endpoint commits first, then invokes the post-commit launcher. It waits only for launch setup—not provider completion—and returns the newest projection it can observe:

```json
{
  "operation": {
    "operationId": "...",
    "state": "owned_by_job",
    "stateVersion": 3,
    "projectionEpoch": 991,
    "characterId": "character-id",
    "chatId": "chat-id",
    "mode": "send",
    "acceptedMessageId": "...",
    "currentAttempt": {
      "attemptNo": 1,
      "jobId": "...",
      "status": "running"
    }
  },
  "append": {
    "disposition": "accepted",
    "messageId": "...",
    "revision": 482,
    "event": {
      "type": "message.appended",
      "resource": "message",
      "id": "...",
      "parentId": "chat-id",
      "revision": 482,
      "operationId": "2c1a2699-166a-46a8-a2f5-926e807b34a1",
      "sourceMessageId": "5752a0d4-a086-4646-b463-458a22892b94"
    }
  },
  "stream": {
    "href": "/api/v1/generation-operations/.../stream?attemptNo=1&jobId=..."
  }
}
```

The post-commit launcher may instead return `accepted`, `launching`, `retryable`, or `cancelled`. Those are accepted operation states, not HTTP transport failure. A cancel-before-submit replay returns `200` with `append.disposition: 'not_appended'` and terminal `cancelled`; it never appends the row.

The endpoint does not use an immutable `command_mutation_receipts` response as its primary idempotency store because the operation response evolves from accepted to running to terminal. The operation row is the idempotency receipt. It still follows the receipt contract's useful ordering:

1. Require current active writer.
2. Assert `risu-database-lineage` against `database_metadata`.
3. Look up `(lineage, operationId)` before checking `baseRevision`.
4. If a bound row exists, compare `request_fingerprint`; return its current projection on match and `409 operation_id_conflict` on mismatch. A matching `accepted` row bound by the current `serverInstanceId` also invokes the same compare-and-set post-commit launcher, so a live-process loss between commit and the original launcher call is repairable exactly once. A row bound by an older instance is never launched.
5. If an unbound `cancel_requested` row exists, bind its immutable request fields and fingerprint, transition it to `cancelled`, and return `append.disposition='not_appended'`; do not check the base revision or append.
6. If no row exists, check the same-chat live claim, then `baseRevision`, target, and message ID, and perform the atomic write. The claim check precedes revision reporting so a concurrent same-chat submit receives stable `generation_in_progress` without an append/revision retry loop.

Changing only `baseRevision` during a conflict retry is allowed because it is excluded from the semantic fingerprint. A changed target, message byte shape, mode, draft generation, or generation intent under the same operation ID fails closed.

Writer identity is audit/control lineage, not request semantics: `creator_writer_session_id` and `creator_writer_epoch` never change, but a legitimately adopted outbox request may be replayed by the new active writer. The old writer receives `423`; the new writer must replay the byte-equivalent stored payload, including its original `draftGeneration`.

### Pinned atomic-acceptance sequence

MS-01 pins process-loss boundaries between staging, append acceptance, generation handoff, and job registration. The new boundary collapses the unsafe append-to-intent interval into one commit:

```mermaid
sequenceDiagram
    participant UI as Browser/outbox
    participant S as Atomic operation endpoint
    participant DB as SQLite
    participant L as Post-commit launcher
    participant J as Job/provider

    UI->>UI: create operationId, messageId, draftGeneration
    UI->>UI: durably stage complete submit
    UI->>S: POST append + intent
    S->>DB: BEGIN IMMEDIATE
    S->>DB: validate revision, chat claim, exact IDs
    S->>DB: insert message + operation + event; bump revision
    alt process loss before COMMIT
        DB-->>DB: rollback all rows
        Note over UI,DB: outbox retains one replayable request
    else COMMIT succeeds
        DB-->>S: accepted message and operation are durable together
        S->>L: launch exact committed operation
        L->>DB: launching -> owned_by_job
        L->>J: dispatch only after owned state commits
        Note over UI,J: loss before response cannot lose operation identity
    end
```

After commit, a browser loss is repaired by idempotent submit/status/bootstrap. A server-process loss before a terminal result is repaired by the boot sweep to `abandoned`; neither path reconstructs intent from the transcript or launches automatically after restart.

### Conflict and writer policy

| HTTP result | Machine code | Append/operation effect |
| --- | --- | --- |
| `409` | `revision_conflict` | Nothing committed; client retries the same operation ID with the current base revision through the serialized mutation lane |
| `409` | `database_lineage_conflict` | Nothing committed; old-lineage submit/Stop intent is terminally quarantined by existing lineage recovery |
| `409` | `operation_id_conflict` | Nothing new committed; same ID was bound to different immutable semantics |
| `409` | `message_id_conflict` | Nothing committed; a foreign existing row cannot be adopted by text equality |
| `409` | `generation_in_progress` | Nothing committed for a new operation; a different operation owns the chat execution claim |
| `409` | `operation_target_stale` | Retry cannot safely address the exact source/target; operation becomes or remains non-running and is never retargeted to the live tail |
| `423` | `active_writer_stale` | Guard runs before lookup/mutation; nothing committed. Client retains staged submit/Stop intent and enters the existing writer-loss flow |

An exact replay of an already accepted operation is returned even when its own chat claim is busy, because it is the owner of that claim. A different busy-chat request is rejected before append. The endpoint is added to `routeManifest.ts` as active-writer; operation status and stream reads are auth-only/read-only.

### Related operation endpoints

- `GET /api/v1/generation-operations/:operationId` returns the current exact projection and global projection epoch. It is read-only and is the bounded authority probe for Stop/Retry.
- `GET /api/v1/generation-operations/:operationId/stream?attemptNo=N&jobId=J&projectionEpoch=E` attaches only if all supplied lineage is still authoritative. A stale request returns `409 stale_generation_attempt` with the newer operation projection; it never attaches the stale job as current.
- `PUT /api/v1/generation-operations/:operationId/cancellation` is the idempotent cancel/tombstone resource described below.
- `POST /api/v1/generation-operations/:operationId/retries` requires `{ retryRequestId, expectedStateVersion }`. It accepts only `retryable` or `abandoned`, validates the exact source/target again, reacquires the chat claim, and returns the existing attempt on retry-request replay.

### Existing send-path migration

For a normal send, `DefaultChatScreen.svelte` will generate the operation/message IDs and captured draft generation first, stage the complete operation submit in the existing encrypted pending-mutation outbox, apply the optimistic user row, and call a new `src/ts/server/generationOperations.ts` adapter. It will no longer call `appendCurrentChatUserMessageForSend()` followed by `sendChat()`.

`appendCurrentChatUserMessageForSend()` and `POST /api/v1/commands/chats/:chatId/messages` remain valid for explicit message-only mutations; they are no longer legal standard-send primitives. `acceptedSendCoordinator.svelte.ts` becomes a projection coordinator over durable operations and can retain its map only to coalesce same-page calls.

`claimPreparingSendTarget()` becomes an explicit ownership transfer, not a `finally` release. The browser keeps the preparation token while the request is staged and while the exact operation is `accepted`/`launching`; it transfers the token to operation-keyed generation activity on `owned_by_job`, to the exact recovery control on `retryable`/`abandoned`, or releases it on a terminal/rejected-not-appended result. Independently, the SQLite live-chat claim prevents another standard send from appending after server acceptance. No chat-level activity observation participates in this transfer.

Before the atomic request, the browser still performs current pre-request work that must precede durable acceptance: complete chat hydration, generation-settings/persona flushes, server-owned inlay upload/reference resolution, and local validation. After acceptance, no browser-only await is allowed between the durable intent and server launch.

For protocol-v1 `send`, request assembly reads the committed row by `acceptedMessageId` and verifies it against the operation's captured transcript fence. `assembleServerBackedSendChat()` may remain for compatibility/inline modes, but the new adapter never substitutes the live last user row or reuses only its text. Continue/regenerate likewise use the recorded `targetMessageId`; every awaited prompt/preflight boundary rechecks that the same operation/attempt remains launchable.

All append-and-generate callers migrate to the same adapter:

- main composer and Draft Send in `DefaultChatScreen.svelte`;
- Plugin V3 `sendChat` in `src/ts/plugins/apiV3/v3.svelte.ts`;
- DevTool Autopilot in `src/lib/SideBars/DevTool.svelte`;
- PO multisend in `src/ts/process/files/multisend.ts`;
- slash/STScript `/multisend` in `src/ts/process/command.ts`.

Batch callers wait for each operation's accepted/current outcome and exact adjacent result, not a raw boolean. Continue/regenerate creation in `sendChat()` migrates to operation submission without an append.

## 3. Lineage propagation map

`LineageEnvelope` is the shared additive wire shape:

```ts
interface LineageEnvelope {
  databaseLineage: string
  operationId: string
  writerSessionId: string
  writerEpoch: number
  operationStateVersion: number
  projectionEpoch: number
  attemptNo: number
  jobId: string
  acceptedMessageId?: string
  targetMessageId?: string
}
```

| Boundary | Required identifiers | Concrete change |
| --- | --- | --- |
| Atomic submit body | `databaseLineage` header; `operationId`; `characterId`; `chatId`; `mode`; `acceptedMessageId` + full row for send; `targetMessageId` for continue/regenerate; `draftGeneration` | New `generationOperations.ts` browser/server adapters; no tail-derived ownership |
| Operation row | Lineage, operation, writer creator/epoch, binding server instance, stable target, source/target message, draft generation, state/version/epoch, current attempt, result message | New `generation_operations` table |
| Attempt row | Lineage, operation, `attemptNo`, `retryRequestId`, `jobId`, server instance, attempt actor writer session/epoch, provider-dispatch timestamps/status | New `generation_operation_attempts` table |
| `StreamJob` | Full `LineageEnvelope`, plus current mode/target | Extend `StreamJob` in `streamJobs.ts`; `GenerationJobRegistry.runningByChat` remains a concurrency index only |
| Initial response headers | Existing `X-Risu-Generation-Job-ID`; new `X-Risu-Generation-Operation-ID`, `X-Risu-Generation-Attempt-No`, and `X-Risu-Generation-Projection-Epoch` | Compatibility aid; Stop never depends on receiving these headers |
| `job_accepted` SSE | Full `LineageEnvelope` | Additive fields in server/client `sseEvents.ts`/`serverChatEvents.ts` |
| Every later durable SSE frame | Full `LineageEnvelope` | Additive optional fields for old wire types, mandatory when protocol v1 created the job |
| `done` SSE | Full lineage, landed `outcome`, `postGeneration.messageId`, authoritative operation state/version | `outcome` absence remains completed; `cancelled` skips success-only client effects as today |
| Bootstrap | Top-level `generationOperationProjectionEpoch`; `generationOperations[]` exact projections; enriched `activeGenerationJobs[]` with operation/source/attempt/version/epoch | `routes/bootstrap.ts`, `src/ts/server/bootstrap.ts`, startup and resource-refresh callers |
| Reattach request | Path `operationId`; query `attemptNo`, `jobId`, last seen projection epoch | Server validates all fields and returns newer authority on mismatch |
| Finalization journal | Database lineage, operation, attempt actor writer, `accepted_message_id`, existing `generation_id`/job ID, `terminal_outcome` | Extend `generationFinalizationRetry.ts`; no chat-only join |
| Persisted assistant row | `resultMessageId`; `generationInfo.databaseLineage`, `.operationId`, `.acceptedMessageId`, `.attemptNo`, `.jobId` | Lets exact transcript reconciliation survive event loss |
| `message.appended` / `generation.persisted` events | Accepted/result message ID + database/operation/source/job lineage as applicable | Extend command-event table/types and `persistServerGenerationResult()`; nullable only for legacy events |
| Cancellation control | Operation ID in path; client-known attempt/job/state version as advisory fields; server resolves current attempt authoritatively | Stale client job cannot redirect cancellation |
| Retry control | Operation ID in path; `retryRequestId`; expected operation state version | Never rereads or retargets the current chat tail |
| Recovery controls | Lineage, operation, accepted/target message, state/version/epoch, and current attempt/job when owned | Replace chat/message-only `AcceptedSendRecovery`; Retry suppression requires exact operation/source match |
| Client activity/UI | `operationId`, exact target/source, current attempt/job | Extend `ChatGenerationActivity`; compatibility `doingChat` stays aggregate only |

### Pinned same-chat ownership sequences

MS-02 pins both two concurrent local sends and an older remote job whose typed 409 body is lost. They share this rule: the durable chat claim is checked inside the atomic endpoint before a second user row is appended, and later ownership is proved only by operation lineage.

```mermaid
sequenceDiagram
    participant A as Plugin/composer operation A
    participant B as Plugin/composer operation B
    participant S as Atomic operation endpoint
    participant DB as SQLite ledger
    participant J as Job A

    par concurrent submits for chat C
        A->>S: POST operation A + message A
    and
        B->>S: POST operation B + message B
    end
    S->>DB: serialize with BEGIN IMMEDIATE
    DB-->>S: append A + accepted A; acquire chat-C claim
    S-->>A: operation A accepted
    S->>J: launch only operation A
    S-->>B: 409 generation_in_progress before append B
    Note over A,B: no same-chat activity can credit A's job to B
    B->>S: later explicit/idempotent retry of operation B
    alt A still owns chat C
        S-->>B: same 409; message B still not accepted
    else A terminal and B target still valid
        S->>DB: append B + accept operation B exactly once
    end
```

For the remote-job variant, job A already holds the SQLite claim. Operation B therefore cannot reach the old state “message B durable, generation B rejected.” If the 409 body or whole response is lost, B's staged request remains unresolved and replayable; bootstrap may show A, but A's different `operationId` cannot settle B, clear B's draft generation, or suppress a B control. The UI may explain the same-chat conflict, but it must not render B as durably accepted until B's endpoint response or an exact B projection proves acceptance.

### Backward compatibility

- Bootstrap advertises `generationOperationProtocol: { version: 1 }`. A new browser switches the standard send path only after seeing that capability.
- `activeGenerationJobs` retains `chatId`, `jobId`, `mode`, and `regenerateMessageId`; old browsers ignore the additive lineage fields. New browsers classify entries without `operationId` as `ownership: 'unknown'`. Such a job may be reattached by job ID, but it cannot suppress an exact accepted-send Retry.
- The current `/api/v1/generate/chat` durable path stays for one compatibility window. Every compatibility job creates a server-generated `request_origin='legacy'` operation/attempt so it participates in the durable same-chat claim, but it has no accepted message ownership and cannot settle a protocol-v1 operation.
- Existing job-ID reattach and cancel routes stay during the window. Job cancellation is upgraded to a typed response, but protocol-v1 UI uses operation cancellation.
- Existing finalization rows with null operation lineage continue through current snapshot-fenced replay. They do not infer or settle a new operation by chat ID.
- SSE fields are additive. `done.outcome` keeps the landed rule: missing means completed.
- No migration guesses an operation from a tail user row or from message text. Pre-v1 reply-less rows remain legacy data.

After the compatibility window, raw `durable: true, mode: 'send'` on `/generate/chat` without an operation capability is rejected for browser callers. Inline/tests and explicitly allowlisted compatibility callers remain separate. The exact release cutoff is an open rollout question at the end of this document.

## 4. Cancellation lifecycle

### Client states

The browser keeps cancellation presentation in an operation-keyed store, not in the chat-keyed activity boolean:

| Client state | Meaning and controls |
| --- | --- |
| `none` | No explicit Stop intent |
| `stop_staging` | Persisting Stop intent locally; button is disabled and says **Stopping…** |
| `stop_sending` | Durable intent exists and cancellation request is in flight |
| `stop_waiting` | Server returned `cancelling`; poll/bootstrap/SSE reconciliation continues |
| `stop_failed` | 423, 5xx, malformed response, timeout, or transport failure; show error with Retry Stop and Refresh |
| `stopped_finalizing` | Runner is absent/cancelled but an exact partial finalization is queued |
| `settled_cancelled` | Operation is terminal `cancelled`; remove Stop activity after authoritative transcript reconcile |
| `settled_completed` | Completion won the race; do not claim cancellation, hydrate the exact result |

`Stopping…` remains visible through `stop_staging`, `stop_sending`, and `stop_waiting`. The local activity/job is not forgotten merely because the viewer POST/GET was aborted.

### Persisted client Stop intent

The existing encrypted, lineage/writer-scoped `risu-pending-mutations-v1` outbox is extended with allowlisted `generation-operation-submit`, `generation-operation-cancel`, and `generation-operation-retry` records. This reuses its pre-dispatch staging, writer adoption, database-lineage quarantine, and pre-hydration replay behavior. It is not the accepted-send authority; the server operation row is.

Explicit Stop performs this order:

1. Resolve the visible exact `operationId`; never manufacture ownership from chat ID.
2. Stage the cancellation record durably.
3. Enter `Stopping…`.
4. Issue operation cancellation using a fresh signal, not the viewer's already-aborted signal.
5. Abort/detach the local viewer only after step 2. A consumer-only stream cancellation remains passive detach.
6. Retain the cancellation record until status/bootstrap/SSE proves terminal `cancelled`, terminal `completed`, or a cancel-before-submit tombstone that prevents later acceptance.

If submit and cancel records both survive a crash, replay may deliver them in either order. The server state machine makes both orders equivalent; client replay should still prioritize cancellation for latency.

### Cancel endpoint and typed outcomes

`PUT /api/v1/generation-operations/:operationId/cancellation` accepts:

```json
{
  "reason": "user_stop",
  "knownStateVersion": 3,
  "knownAttemptNo": 1,
  "knownJobId": "optional-advisory-job-id"
}
```

The known attempt/job are stale-detection diagnostics, not authority. The server locks the operation row and selects its current attempt. It never cancels another operation just because it shares the chat.

| HTTP | `disposition` | Authoritative meaning |
| --- | --- | --- |
| `200` | `cancelled_before_acceptance` | Durable tombstone exists; a later submit with this operation ID cannot append or launch |
| `202` | `cancelling` | Stop is durably recorded and the exact current runner was signalled or is being prevented; not settled yet |
| `200` | `cancelled` | No runner remains and operation is terminal cancelled |
| `200` | `cancelled_finalizing` | Runner is gone; cancelled partial has a confirmed journal and may still be saving |
| `200` | `completion_finalizing` | Completion won before Stop; its exact result journal is saving, so cancellation cannot replace its disposition |
| `200` | `already_cancelled` | Idempotent terminal replay |
| `200` | `already_completed` | Completion won; response includes result message/revision and client must reconcile it |
| `200` | `terminal_nonrunning` | Operation is `terminal_failed`/`invalidated`; no runner exists and response includes the terminal reason |
| `409` | `database_lineage_conflict` | The operation ID belongs to another database lifetime; quarantine the local control and refresh authority |
| `423` | `active_writer_stale` | Existing writer-loss flow; Stop intent remains durable and visible |

An absent operation is not a 404 success: cancellation creates `cancel_requested`. This is what makes cancel/submit ordering safe. A request header for a lineage other than the current `database_metadata.lineage` is a conflict and does not erase the client intent.

A stale `knownStateVersion`, `knownAttemptNo`, or `knownJobId` does not reject Stop. The response reports `knownAttemptMatched: false`, while the server applies the intent to the current attempt of the same operation. That is required when an explicit retry advanced operation A from attempt 1 to attempt 2 before its Stop arrived. It still cannot cross from operation A to same-chat operation B.

The endpoint commits `stopping` before signalling the `AbortController`. The runner checks the committed operation state after awaited prompt/Hypa preflight and immediately before provider dispatch. Register/attach/track failures abort and remove the process job, release the chat claim, and transition the operation truthfully.

### Arrival-order sequences

Stop before submit reaches Fastify:

```mermaid
sequenceDiagram
    participant UI as Browser UI/outbox
    participant C as Cancellation endpoint
    participant S as Atomic submit endpoint
    participant DB as SQLite operation ledger

    UI->>UI: create operationId and stage Stop
    UI->>C: PUT cancellation(operationId)
    C->>DB: insert cancel_requested tombstone
    C-->>UI: cancelled_before_acceptance
    UI->>S: delayed/replayed POST same operationId
    S->>DB: bind fingerprint; transition cancelled
    Note over S,DB: no user row, job, or provider dispatch
    S-->>UI: idempotent cancelled / not_appended
```

Submit wins but job ID has not reached the browser:

```mermaid
sequenceDiagram
    participant UI as Browser UI/outbox
    participant S as Atomic submit/launcher
    participant DB as SQLite operation ledger
    participant J as Process job/provider
    participant C as Cancellation endpoint

    UI->>S: POST operationId + message
    S->>DB: append row + accepted intent; COMMIT
    S->>DB: reserve attempt/job; owned_by_job
    S->>J: register runner
    Note over UI,S: submit response/jobId may still be delayed
    UI->>C: PUT cancellation(operationId)
    C->>DB: owned_by_job -> stopping
    C->>J: abort exact current attempt
    C-->>UI: 202 cancelling
    J->>DB: cancelled partial/no-row finalization
    DB-->>UI: cancelled terminal via SSE/bootstrap/status
```

This closes the MS-04 interval because the address used by Stop existed before either HTTP request.

The post-ID MS-04 addendum and MS-08 AV-01 use the same acknowledgement rather than optimistic local removal:

```mermaid
sequenceDiagram
    participant UI as UI with operation/job already known
    participant O as Durable Stop outbox
    participant C as Cancellation endpoint
    participant J as Exact current runner

    UI->>O: stage Stop(operationId)
    UI->>UI: render Stopping...
    O->>C: PUT cancellation(operationId, advisory jobId)
    alt 423, 5xx, timeout, or network loss
        C--xO: no authority established
        UI->>UI: Stop failed; retain job + intent; enable Retry Stop
    else accepted cancellation
        C->>C: commit stopping/cancel fence
        C->>J: abort current attempt of same operation
        C-->>UI: 202 cancelling
        J-->>UI: cancelled terminal/status projection
        UI->>UI: reconcile partial/result, then render Stopped
    else completion already won
        C-->>UI: 200 already_completed + exact result
        UI->>UI: hydrate result; do not claim Stopped
    end
```

### Interaction with `done.outcome: 'cancelled'`

The runner retains today's mode-aware partial policy:

- no provider text: no assistant row;
- streaming text: persist only the allowed raw partial for send/continue/regenerate, with the existing transcript snapshot fence;
- cancelled terminal: emit protected `done` with `outcome: 'cancelled'`, complete lineage, and `postGeneration` reconciliation when a partial row is durable or queued;
- browser: reconcile the partial/result message but skip output listeners, IGP, notification, emotion, reroll/resend, terminal TTS/inlay, and completion sound exactly as the landed implementation does.

`done.outcome: 'cancelled'` confirms generation disposition, not necessarily finalization settlement. If the partial has a confirmed journal, the operation remains `finalizing` and cancellation returns `cancelled_finalizing`; UI changes from **Stopping…** to a truthful stopped/saving state. If journal insertion itself fails, the wire must report a rejected partial-persistence disposition—never `queued`—and the operation records the cancellation plus persistence error.

### Reconciliation loop

Cancellation reconciliation is operation-specific and bounded per request:

1. Consume exact operation SSE while available.
2. Otherwise issue `GET /generation-operations/:operationId` with one abort deadline.
3. On `owned_by_job`/`stopping`, keep `Stopping…` and retry with capped exponential backoff plus online/visible/pageshow wakeups.
4. On `finalizing` with `desiredTerminalOutcome='cancelled'`, leave **Stopping…** for `stopped_finalizing`, retain exact saving/rejected-partial status, and continue reconciliation without implying an active provider. With `desiredTerminalOutcome='completed'`, completion won; render its saving state and reconcile the result rather than claiming Stop.
5. On an acknowledged `cancel_requested` tombstone, settle the Stop presentation, roll back only the exact unaccepted optimistic row, and preserve its exact draft generation; the staged submit is marked superseded or allowed to receive `not_appended`. On `cancelled`, `completed`, or another no-runner terminal, settle and delete the local Stop record only after storing that authoritative response.
6. On authority timeout/5xx/423, enter `stop_failed`; the button always re-enables in `finally` and the durable intent remains.

Chat-level job absence alone is not sufficient. The terminal condition is the exact operation's cancellation fence plus no current attempt, or exact completion.

## 5. Restart handling

### Boot sweep

`buildApp()` in `server/fastify/src/app.ts` creates a new random `serverInstanceId` after `openDatabase()` and before bootstrap/generation routes are registered, then calls `reconcileGenerationOperationsAtStartup(db, serverInstanceId)` from the new store. In one operation-ledger transaction it performs:

1. Reconcile an exact persisted result already carrying `generationInfo.operationId` to `completed` if a previous process committed the message but did not project its response. The planned atomic finalization transaction should make this a defensive path only.
2. Leave `finalizing` operations with a matching pending `generation_finalization_retries` row in `finalizing`; the existing startup finalization sweep may persist that exact saved result. This is persistence replay, not provider regeneration.
3. Mark attempts from another server instance in `reserved`/`running` as `abandoned`.
4. Mark operations in `accepted`, `launching`, or `owned_by_job` without a finalization row as `abandoned`, set `failure_code='server_restarted'`, and set `provider_may_have_run` from the attempt dispatch marker.
5. Mark `stopping` operations with no finalization row `cancelled`, because restart proves that their process-local runner cannot survive. A stopped partial with a journal remains `finalizing` toward `cancelled`.
6. Mark an inconsistent `finalizing` operation with no journal and no exact result `abandoned` with `failure_code='finalization_record_missing'`.
7. Bump the projection epoch once for the sweep.

No startup code scans `accepted`/`abandoned` rows and launches them. Only the original submit or an exact replay of an `accepted` row bound to the current server instance invokes the compare-and-set post-commit launcher. After abandonment, only an explicit user Retry invokes another attempt.

The existing `app.ts` graceful-shutdown order remains important, but its abort reason becomes explicit. Before aborting registry jobs it conditionally marks their still-running attempts/operations `abandoned` with `failure_code='server_shutdown'`; the runner must not reinterpret that system abort as user Stop or emit a successful `cancelled` disposition. It then aborts, waits for runners, and closes SQLite. If an exact completed/cancelled finalization journal won first, finalization truth wins instead. Hard process loss reaches the same non-resume policy through the next boot sweep.

```mermaid
sequenceDiagram
    participant P as Old server process
    participant DB as SQLite ledger/journal
    participant N as New server process
    participant B as Bootstrap/UI

    P->>DB: operation A owned_by_job; dispatch marker committed
    P--xP: process exits before terminal result
    N->>DB: open database with new serverInstanceId
    alt exact finalization journal/result exists
        N->>DB: replay only saved finalization data
    else no terminal data exists
        N->>DB: attempt A -> abandoned; operation A -> abandoned
    end
    Note over N,DB: never invoke provider launcher during sweep
    N->>N: register bootstrap/generation routes
    B->>N: bootstrap
    N-->>B: A abandoned, retryable, providerMayHaveRun flag
    B->>B: show explicit Retry (and billing warning when required)
```

### Bootstrap projection

Bootstrap adds:

```json
{
  "generationOperationProtocol": { "version": 1 },
  "generationOperationProjectionEpoch": 1002,
  "generationOperations": [
    {
      "operationId": "...",
      "state": "abandoned",
      "recoveryDisposition": "retryable",
      "failureCode": "server_restarted",
      "providerMayHaveRun": true,
      "characterId": "...",
      "chatId": "...",
      "mode": "send",
      "acceptedMessageId": "...",
      "stateVersion": 6,
      "projectionEpoch": 1002
    }
  ]
}
```

Bootstrap projects all nonterminal operations and enough recent terminal operations to reconcile a lost response, scoped to the current database lineage. Current active-writer controls who may Stop/Retry; creator writer fields are diagnostic and are not used to strand work after a legitimate writer takeover.

The client initializes operation/recovery state before generation reattach. It first reconciles an exact completed result, then exact current jobs, then retryable/abandoned entries. A matching `owned_by_job` projection suppresses Retry; an unrelated same-chat job does not.

The MS-07 recovery transition is pinned as an exact-lineage sequence:

```mermaid
sequenceDiagram
    participant UI as Recovery UI for operation A
    participant B as Bootstrap/status
    participant J as Job projection
    participant T as Transcript hydration

    UI->>UI: A is retryable; show Retry
    B-->>UI: operation A = owned_by_job, attempt 1, job A
    J-->>UI: same operation A / source message A
    UI->>UI: retryable -> owned_by_job; suppress Retry
    Note over UI,J: same-chat job B would retain A's warning instead
    J-->>UI: done for operation A, result message R
    T-->>UI: exact R adjacent to accepted message A
    UI->>UI: owned_by_job -> completed; clear recovery
```

Discovery alone does not delete the recovery record. The operation remains the underlying durable entity until exact terminal transcript reconciliation, which prevents the warning/job flicker documented by MS-07.

### Explicit retry and double-billing avoidance

Retry of `retryable`/`abandoned` uses the same operation and user row. The server:

1. idempotently resolves `retryRequestId`;
2. verifies no exact result already exists;
3. verifies the accepted user row still exists, is a user row in the recorded chat, and is still an eligible target under the transcript fence;
4. verifies no other operation owns the chat claim;
5. creates the next attempt/job and transitions through `launching -> owned_by_job`;
6. dispatches only after the owned state commits.

An abandoned attempt is never silently reissued. If `providerMayHaveRun` is true, Retry requires an explicit UI confirmation that another provider request may be billed. If the source is stale or a newer row makes the operation ineligible, the server returns `operation_target_stale`; it does not generate for the current tail.

MS-01 Addendum A's older-recovery/newer-row ordering is therefore pinned as:

```mermaid
sequenceDiagram
    participant UI as Retry control for operation A
    participant S as Retry endpoint
    participant DB as Transcript + operation ledger

    Note over UI,DB: operation A owns accepted message A; newer user message B now exists
    UI->>S: POST retry A with retryRequestId
    S->>DB: lock A; verify exact source A and transcript fence
    DB-->>S: A is no longer an eligible generation target
    S-->>UI: 409 operation_target_stale, operation A unchanged/non-running
    Note over UI,DB: no job targets B; A's recovery is not cleared by B
```

The attempt ledger cannot prove what an upstream billed across arbitrary process loss, so the safe contract is conservative disclosure plus user-authorized retry. It does guarantee that the server itself never automatically submits a second request.

## 6. Stale-reattach deduplication

### Pinned timing sequence

The MS-02 A-03 race is preserved as a required regression sequence:

```mermaid
sequenceDiagram
    participant R as Browser reattach A
    participant S as Server
    participant B as Browser bootstrap projection
    participant UI as Chat/Stop selector

    R->>R: capture epoch 40, operation A, attempt 1, job A
    R->>S: GET exact stream A
    R->>R: temporarily consume A from local projection
    S->>S: A completes; release chat claim
    S->>S: operation B starts; job B becomes authoritative
    B->>S: read bootstrap
    S-->>B: epoch 41, same chat -> operation B/job B
    B->>UI: replace projection with B
    S--xR: stale A reattach fails retryably
    R->>R: restore guard sees epoch/version changed
    Note over R,UI: A is dropped, never prepended beside B
    UI->>UI: Stop resolves exact authoritative B
```

### Deduplication rule

The client replaces `ActiveGenerationJob[]` ownership decisions with a normalized operation/job map. Applying bootstrap requires `incomingEpoch >= currentEpoch`; a lower epoch is ignored. For each chat, the authoritative live candidate is ordered by:

```text
(projectionEpoch, operationStateVersion, attemptNo, jobId)
```

Only the greatest candidate that is still `owned_by_job`/`stopping` is current. Job ID lexical order is merely a deterministic final tie-breaker for malformed equal-version data; it does not establish freshness.

When `maybeReattachOpenChatGeneration()` begins, it captures:

```text
projectionEpoch, operationId, stateVersion, attemptNo, jobId, chatId
```

Its failure path may restore the consumed entry only if all captured fields still equal the current operation projection and no newer same-chat candidate exists. A lifecycle/full-refresh epoch change makes the restore a no-op. The minimum compatibility fallback for a legacy job also deduplicates by chat ID, preferring the entry from the newest bootstrap application; it never prepends a stale same-chat entry.

The reattach endpoint performs the same check server-side. A request for stale A returns the authoritative newer projection and does not attach. `restoreJob()` in `src/ts/process/reattach.ts` therefore cannot recreate authority that both server and bootstrap have superseded.

Stop selection follows the same normalized map. A UI action for operation A never silently cancels B. A generic “Stop current chat” action first resolves the current operation B, renders B's identity, and then cancels B. If authority changes after resolution, the response plus projection epoch causes the client to refresh and re-resolve the still-pending generic intent; it may then present/cancel authoritative B, but never redirects an operation-A request to B or uses `.find(job.chatId)` array order.

## 7. Migration and rollout order

Each wave is independently reviewable and preserves a useful invariant even before later UI work lands.

### Wave 0 — retain honest containment

Land or preserve the work-index containments that do not require the schema:

- route Plugin V3, DevTool, PO multisend, and slash/STScript multisend through `coordinateAcceptedChatSend()`;
- wait for queued append settlement and per-item outcome;
- remove chat-level “some activity means success” inference and keep exact adjacent-reply proof;
- transfer `claimPreparingSendTarget()` ownership until the exact in-memory coordinator reaches activity, recovery, or terminal outcome;
- retain a warning for an unrelated same-chat job.

Invariant: containment may be conservatively retryable, but it never converts unrelated same-chat work to success. These callers later migrate from the in-memory coordinator to the operation adapter without changing their captured-target/per-item structure.

### Wave 1 — ledger, migrations, and read projection

Add v29 schema/store APIs, projection epoch, backup/restore ownership, `app.ts` startup sweep, bootstrap capability/projection, and metrics. No production caller creates protocol-v1 rows yet. Add nullable lineage columns to the finalization journal and command events.

Invariant: existing behavior is unchanged; any seeded/test operation has deterministic restart and bootstrap truth. Restore/import allowlists remain exhaustive.

### Wave 2 — lineage-aware attempt/job/finalization backend

Extend `JobRegistry.create()` to accept a preallocated job ID, extend `StreamJob` and `GenerationJobRegistry`, add the operation submit/status/stream/retry routes, and make `runGenerationJob()`/finalization update exact operation state. Make the compatibility durable route create a legacy operation claim. Provider dispatch is gated on committed `owned_by_job` and rechecked after awaited preflights.

Invariant: the backend can atomically accept and idempotently replay one send, all job/SSE/bootstrap/finalization surfaces agree on lineage, and restart cannot regenerate. The old browser continues through the compatibility route.

### Wave 3 — browser atomic-send cutover and durable recovery

Add `src/ts/server/generationOperations.ts`, extend the encrypted outbox shapes, and migrate main composer/Draft Send and Plugin V3 first. Convert `acceptedSendCoordinator.svelte.ts` and `acceptedSendRecoveryState.ts` from authority to projections of `generationOperations`. Carry `draftGeneration` and clear only the exact accepted generation after bootstrap/outbox replay.

Migrate DevTool, PO multisend, and both slash/STScript multisend paths in the same wave or immediately following it. A raw-generation-caller allowlist test prevents new append-plus-`sendChat()` bypasses.

Invariant: every newly accepted standard send has an atomic durable operation; process loss yields exact job, exact completion, or durable retryable state. Multiple recoveries in one chat remain distinct. The Wave 0 coordinator routing containment now calls the durable endpoint instead of owning settlement.

MS-07 suppression migrates here: the client models `retryable -> owned_by_job -> completed`, suppresses Retry only for matching `operationId`/`acceptedMessageId`, and retains warnings for unrelated same-chat jobs. It does not delete recovery merely when a job is discovered; it keeps the underlying operation until exact terminal transcript reconciliation prevents warning flicker.

### Wave 4 — acknowledged Stop

Add operation cancellation/tombstones, typed legacy job cancellation, persistent control records, operation-keyed cancellation UI, exact status reconciliation, and the corresponding localized `src/lang` keys for Stopping/failure/retry/saving states. Update `abortActiveGeneration()` in `src/ts/process/index.svelte.ts` and `requestServerChatGeneration()` so explicit Stop uses the operation controller, while consumer stream cancellation remains passive detach.

Invariant: Stop is effective and acknowledged in either POST/cancel order and before or after job-ID delivery. Failure is visible/retryable; local idle is never treated as remote cancellation.

### Wave 5 — epoch-aware reattach and lifecycle convergence

Normalize operation/job projections, add epoch-aware application and restore guards in `reattach.ts`, make reattach and Stop exact-attempt operations, and integrate per-job reattach failure controls from MS-08. Full resource refresh, online, visibility, pageshow, local `job_accepted`, terminal SSE, and transcript hydration all call the same operation reconciler.

Invariant: a stale observer cannot outrank a newer job; exact current work drives Retry/Refresh/Stop; unrelated same-chat recovery remains visible.

### Wave 6 — compatibility hardening and cleanup

After a measured compatibility window:

- reject non-allowlisted lineage-less durable browser sends;
- remove standard-send use of `appendCurrentChatUserMessageForSend()` and the late tail reread in `assembleServerBackedSendChat()`;
- delete chat-level accepted-send success helpers such as `isChatGenerationKnown()` from ownership decisions;
- retain job-ID endpoints only for legacy observation/administration as policy requires;
- update `STRUCTURE.md`, backend/data/client-runtime guides, route manifest, and protocol diagnostics.

Invariant: there is one owned standard-send boundary and one exact operation lifecycle.

## 8. Test plan

No wave is complete on unit tests alone. Each must assert visible UI, browser durability/projection, SQLite authority, and provider/job execution count.

### Per-wave gates

| Wave | Unit/component | Fastify integration | Production browser gate |
| --- | --- | --- | --- |
| 0 | `acceptedSendCoordinator.test.ts`, `acceptedSendRecoveryState.test.ts`, Plugin V3, DevTool, PO/slash multisend tests: concurrent same-chat calls, queued settlement, unrelated job, reservation handoff | Existing `durableGeneration.test.ts` typed/untyped 409 cases stay conservative | Two rapid same-chat sends and two concurrent Plugin V3 calls never produce false success |
| 1 | Store transition table, fingerprint canonicalization, epoch monotonicity, bootstrap parser compatibility | `db.test.ts`, `bootstrap.test.ts`, `backups.test.ts`: migration/rollback, schema allowlist, restore lineage rewrite, boot sweep | Start from a pre-v29 database and a restored backup; app loads with no spurious retry/generation |
| 2 | Job registry preallocated IDs, lineage envelope encoding/decoding, attempt idempotency, finalization joins | Atomic submit transaction, duplicate/lost response, busy-chat rejection before append, exact finalization, restart states, legacy claim coexistence | Direct protocol journey proves one append/one provider call and exact SSE/bootstrap lineage |
| 3 | Operation projection/MS-07 state machine, exact draft generation cleanup, caller adapters, multiple recoveries | Browser adapter against real route; same operation replay across revision conflict/writer takeover | Composer and each auxiliary caller survive reload/process loss at every append-to-job checkpoint |
| 4 | Cancellation store/UI states, typed outcomes, passive consumer detach, retry backoff/finally settlement | Cancel-first, submit-first, pre-dispatch, post-dispatch, partial, completion race, 423/5xx/network failure | Press Stop before response head, after head, after `job_accepted`, mid-token, and after persistence; run desktop and Pixel-class mobile |
| 5 | Projection epoch, stale restore guard, exact selector, MS-08 retry/refresh/Stop | Stale reattach request returns newer authority; operation cancel never crosses IDs | Reproduce A-completes/B-starts/bootstrap-refresh/A-fails and prove Stop controls B only after B is visibly selected |
| 6 | Raw caller allowlist and backward parsers | Legacy fields nullable, lineage-less path policy, old `done` without outcome | Mixed-version capability test for the supported compatibility window |

Suggested existing suites to extend include:

- `src/ts/process/acceptedSendCoordinator.test.ts`
- `src/ts/process/acceptedSendRecoveryState.test.ts`
- `src/ts/process/__tests__/reattach.test.ts`
- `src/ts/process/request/tests/serverChat.test.ts`
- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `src/ts/server/bootstrap.test.ts`
- `src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`
- `src/lib/ChatScreens/DefaultChatScreen.composerDrafts.test.ts`
- `src/ts/plugins/apiV3/v3.svelte.test.ts`
- `src/lib/SideBars/DevTool.svelte.test.ts`
- `src/ts/process/files/multisend.test.ts`
- `src/ts/process/__tests__/command.resourceGuard.test.ts`
- `server/fastify/__tests__/db.test.ts`
- `server/fastify/__tests__/bootstrap.test.ts`
- `server/fastify/__tests__/durableGeneration.test.ts`
- `server/fastify/__tests__/generation.chat.test.ts`
- `server/fastify/__tests__/backups.test.ts`

Add a production-stack `server/fastify/browser-smoke/acceptedSendProtocol.spec.ts` with deterministic server/proxy fault seams. The current responsive smoke and reroll-after-completion smoke are not substitutes.

### Mandatory atomicity and process-loss fault points

| Fault point | Required postcondition |
| --- | --- |
| Before submit transaction | No message, operation, attempt, event, or provider call; exact draft remains |
| After message insert but before operation insert | Full transaction rollback: no message/revision/event/operation |
| After operation insert but before revision/event/commit | Full transaction rollback |
| After commit but before HTTP response | One message and operation; replay returns them; no duplicate append |
| After commit but before launcher claim | Same process may claim once; process restart marks `abandoned`; never auto-dispatches |
| After attempt reservation but before process job registration | Attempt/operation become retryable or `abandoned`; no provider call; chat claim releases |
| After process registration but before `owned_by_job` commit | Cleanup removes registry job and claim, or restart marks abandoned |
| After `owned_by_job` commit but before provider dispatch | Stop prevents dispatch; restart marks abandoned with `providerMayHaveRun: false` |
| Immediately before/after provider call | Attempt marker and restart projection conservatively distinguish “not started” from “may have run”; no automatic retry |
| Job accepted before submit response/job ID delivery | Operation-addressed Stop cancels the exact job |
| After partial token | `done.outcome='cancelled'`; mode-aware raw partial/journal/operation lineage agree; success-only effects do not run |
| Before finalization-journal insert | Never report `queued`; operation records rejected/unknown persistence truth |
| After journal insert before message commit | Operation is `finalizing`; startup sweep retries only the saved result, not provider work |
| During message/event/operation finalization transaction | All roll back together; journal remains replayable |
| After message/operation commit before `done`/resource delivery | Bootstrap/status plus exact hydration yield completed once; no second provider call |
| During cancelled-partial finalization | Stop remains acknowledged; exact partial is either durable/queued or explicitly rejected, never silently claimed queued |
| Graceful shutdown during job | `server_shutdown` marks the nonterminal operation `abandoned` before job abort; runner settles before SQLite close and never reports a user cancellation |
| Crash/restart during accepted/launching/running/stopping | Boot sweep produces the specified abandoned/cancelled state and no process job |

### Concurrency, lineage, and lifecycle matrix

Every relevant wave also covers:

- same operation submitted concurrently twice: one append, one attempt, one provider call;
- same operation ID with changed message/chat/mode/draft: `409 operation_id_conflict`;
- two different same-chat operations: second rejected before append while the first owns the live claim;
- two retryable operations in one chat: each remains distinct; Retry addresses its exact source and refuses a stale/non-tail target;
- two different chats: concurrent jobs and independent Stop/recovery;
- older unrelated same-chat job plus hidden/unparseable 409: no operation is credited to that job;
- exact matching discovered job: `retryable -> owned_by_job`, Retry suppressed without deleting the operation;
- unrelated discovered job: warning retained and Retry does not launch while the chat claim is busy;
- active-writer takeover and `423`: no stale mutation, staged Stop/submit retained under existing policy;
- database-lineage rotation: old submit/Stop/retry is quarantined and cannot address restored state;
- exact composer draft generation accepted after outbox replay: only that generation clears; identical newer text remains;
- SSE replay and terminal result: all lineage fields remain stable and `done.result` stays canonical;
- legacy job/finalization without lineage: reattach/persist is compatible but never suppresses a protocol-v1 recovery;
- `visibilitychange`, `pagehide/pageshow`, offline/online, reload, fresh JS runtime, two tabs, and full server restart at every mandatory fault point;
- stale reattach sequence from the prior section, including manual Stop and Refresh;
- final authoritative assertions: rendered transcript/control, browser operation/outbox/draft/job stores, SQLite message/operation/attempt/finalization rows, bootstrap projection epoch, command event lineage, and provider dispatch/abort count.

The universal accepted-send assertion is:

> Every durably accepted send has exactly one operation and accepted message. At every observable point it has an exact current job, an exact completed result, or a durable explicit recovery/terminal state. No unrelated same-chat job satisfies that assertion.

The universal Stop assertion is:

> Once Stop is staged, a later submit cannot escape it, a running exact attempt is either cancelled or conclusively completed, and failure to establish that authority remains visible and retryable.

## Open questions

Two rollout/product details are not decided by the audited implementation:

1. **Legacy durable-client cutoff.** The protocol defines a capability-gated compatibility window and the eventual rejection of lineage-less browser sends, but the repository does not define how many releases or which deployed clients must remain supported. Release owners must set the cutoff before Wave 6.
2. **Abandoned-retry confirmation copy.** The technical policy is fixed: no automatic retry, and explicit confirmation when `providerMayHaveRun` is true. The exact localized wording and accessible confirmation interaction need product/accessibility review before Wave 3 UI lands.

Neither question blocks the schema, endpoint, lineage, cancellation ordering, restart state, or test invariants above.
