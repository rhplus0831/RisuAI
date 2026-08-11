# MS-06 validation: completion proof is not transcript reconciliation

Validated: 2026-08-11

Consolidated finding: [MS-06 — Completion proof is not transcript reconciliation](../fastify-multichat-mobile-stability-audit-2026-08-11.md#ms-06--completion-proof-is-not-transcript-reconciliation)

Audit revision: `9afde4658ea5b277493e9d7f6ef7aaf387544165`

Validation revision: `e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`

Verdict: **confirmed, Medium severity**. No relevant source file changed
between the audit and validation revisions.

## Executive conclusion

MS-06 is a client reconciliation defect, not a server persistence defect. In
the affected sequence, Fastify has already persisted the correct assistant
row. The browser even downloads the authoritative transcript suffix containing
that row. It then uses the response only as a yes/no completion proof, discards
the messages, and reports the send as `generated`.

That result is stronger than the fact the coordinator actually established.
It established “the server has an adjacent assistant row,” but it reports “the
generation completed successfully for this client.” The latter requires the
authoritative row to be present in the local transcript before recovery state
is cleared and before downstream success behavior runs.

The bug is reachable when a durable generation outlives its mobile/browser SSE
viewer, finishes while the viewer is disconnected, and is no longer in the
active-job bootstrap projection when the coordinator checks. It also affects
the explicit Retry path. The visible chat can remain user-only or retain a
partial streamed assistant row; no accepted-send recovery banner remains, the
standard UI runs reroll success effects, and Plugin V3 receives `true`.

An independent `generation.persisted` event will normally hydrate the chat
eventually, but that event is a separate transport and is not ordered as a
barrier before the coordinator returns success. Delayed eventual repair is
particularly weak in the mobile/background conditions that led to the probe.

The preferred fix is to make authoritative completion probing an atomic
**fetch, freshness-check, apply, and post-apply-verify** operation. Merely
calling `applyServerChatMessagesResource` directly is unsafe because its normal
caller supplies revision and projection-epoch fencing. Merely calling the
current `{ force: true, strict: true }` full-hydration API is also insufficient:
that API can resolve after a failed forced refresh when the same chat was
already marked hydrated.

## What exactly is the bug?

The intended invariant is:

> An accepted send may be reported as generated only after either its live
> generation path has reconciled the terminal result, or an authoritative
> server read has been safely applied and the resident transcript contains the
> accepted user row followed by its assistant reply.

The fallback path implements only the first half of the second alternative.
`acceptedGenerationReachedServer` fetches an authoritative generation suffix
and evaluates `transcriptHasReplyForAcceptedSend`, but returns only a boolean
([coordinator](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L146)).
The response's `revision`, `chatId`, `message`, `hypaV3Data`, range, and
`alternates` are otherwise discarded.

The completion predicate itself is reasonable as a proof against the returned
snapshot. It finds the exact accepted user-message ID and requires the next row
to have role `char`
([predicate](../../../src/ts/process/acceptedSendRecoveryState.ts#L23)). The
problem is that a predicate over a downloaded snapshot does not mutate or
validate the browser's resident snapshot.

Both coordinator branches overstate the result:

- the initial handoff returns `{ status: 'generated' }` after a positive probe
  ([initial branch](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L167));
- the Retry branch removes its recovery record and returns `true` after the
  same positive probe
  ([retry branch](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L233)).

Neither branch calls the existing message hydration/apply layer.

### What the response contains but the coordinator ignores

`fetchServerGenerationChatMessages` calls the authenticated chat-message
endpoint with `generationMessageId`
([client read](../../../src/ts/server/hydrationReads.ts#L216)). The parsed
success response contains:

| Field | Meaning | Needed during reconciliation |
| --- | --- | --- |
| `revision` | Global server resource revision at read time | Reject older authoritative bodies and record the applied body revision |
| `chatId` | Server-declared chat owner | Refuse a mis-targeted response |
| `message` | Authoritative active-message suffix | Replace/append the missing or partial local row |
| `messageStart` / `messageTotal` | Absolute suffix position and transcript length | Merge the suffix without replacing the loaded prefix |
| `hypaV3Data` | Authoritative chat memory state | Keep chat body companions consistent |
| `alternates` | Persisted reroll candidates | Rebuild the correct chat-scoped swipe state |

The parser validates the revision, message array, and range shape
([response parser](../../../src/ts/server/hydrationReads.ts#L283)). The Fastify
route reads the suffix and returns all of those fields
([resource route](../../../server/fastify/src/routes/resourceReads.ts#L422)).

For the coordinator, the anchor is the accepted user-message ID. When that
active row belongs to the requested chat, the server returns an inclusive
suffix from its absolute `seq` through the current tail
([repository](../../../server/fastify/src/repository.ts#L2135)). Thus a normal
completed send returns at least `[accepted user, assistant]`, with the range
metadata needed to merge it.

If the anchor is missing, foreign, or ambiguous, the route falls back to the
last eight rows rather than returning an explicit “anchor not found” result.
That is a contract caveat, but it does not create MS-06's false success by
itself: the exact accepted-message predicate fails unless that ID is present in
the returned suffix.

### The repository already has the missing apply behavior

`applyServerChatMessagesResource` can apply an already fetched full or ranged
payload, preserve a loaded prefix during compatible append growth, advance the
chat projection epoch, reapply retained projections, acknowledge generation
and accepted-send recovery state, seed reroll alternates, and update hydration
status
([direct apply](../../../src/ts/server/chatMessageHydration.svelte.ts#L585)).
The lower storage function merges a range at `messageStart`, grows or rebuilds
to `messageTotal`, and writes authoritative Hypa data
([range merge](../../../src/ts/storage/database.svelte.ts#L3581)).

The normal event-invalidation caller surrounds that apply with protections the
coordinator currently lacks:

- it captures a chat-body projection epoch before starting the read and treats
  a changed epoch as supersession
  ([read fence](../../../src/ts/server/resourceInvalidation.ts#L1102),
  [supersession](../../../src/ts/server/resourceInvalidation.ts#L1207));
- it checks that the returned chat matches the requested chat;
- it refuses to regress a newer already-applied chat-body revision; and
- it records the result revision only after a successful apply
  ([guarded apply](../../../src/ts/server/resourceInvalidation.ts#L1406)).

Those protections explain why the fix should reuse or extract the complete
guarded operation, not only import the low-level apply function into the
coordinator.

## How does the bug affect users?

### Direct visible effects

- The server contains the full assistant response while the open chat can end
  at the user's row or display only the tokens received before suspension.
- The generation activity has ended, so the chat no longer presents a healthy
  live stream or Stop control for that operation. `sendChat` always removes its
  owned activity in `finally`
  ([generation cleanup](../../../src/ts/process/index.svelte.ts#L655)).
- No accepted-send failure banner is created on the initial path. On Retry, the
  existing banner is removed even though its authoritative reply was never
  applied locally.
- The standard composer path treats the coordinator result as success and runs
  `applySuccessfulSendChatEffects`
  ([screen continuation](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L908)).
  This clears the chat's previous reroll buffer and marks reroll ownership, but
  cannot record the missing assistant tail because it reads the stale local
  transcript
  ([reroll behavior](../../../src/ts/process/rerollNavigation.svelte.ts#L158)).
- Plugin V3 returns `true` to the plugin based solely on the coordinator status
  ([Plugin V3](../../../src/ts/plugins/apiV3/v3.svelte.ts#L1898)). A plugin can
  therefore observe “send succeeded” and immediately read a transcript without
  the response it was told had completed.

The composer is cleared at append acceptance, before generation starts
([handoff callback](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L881)).
That ordering is intentional for an accepted append and is not itself MS-06,
but it makes the false-success state feel final: the user sees an empty composer,
no retry banner, and no authoritative assistant row.

### Secondary behavior caused by the stale resident transcript

Finishing a message activity records a pending suggestion completion
([activity completion](../../../src/ts/process/generationActivity.svelte.ts#L72)).
The Suggestions component can then build a request from the current local
message array as soon as generation becomes inactive; a user-only transcript
is non-empty and passes that gate
([suggestion request](../../../src/lib/ChatScreens/Suggestion.svelte#L366),
[completion consumer](../../../src/lib/ChatScreens/Suggestion.svelte#L511)).
The application can consequently generate next-message suggestions without
the assistant reply that should have been their context.

Normal new-assistant-row auto-scroll and client automatic-translation
eligibility are also driven by changes in the resident message list
([chat row effect](../../../src/lib/ChatScreens/Chats.svelte#L169)). They cannot
run at the correct boundary while the fetched row is discarded. A later
resource apply may trigger them, but only after the coordinator has already
reported completion.

### What is not lost

The durable assistant row is normally safe in SQLite. The server test explicitly
proves that a durable job continues after its viewer drops and persists one
assistant row
([durable generation test](../../../server/fastify/__tests__/durableGeneration.test.ts#L679)).
MS-06 is therefore recoverable consistency and misleading success state, not
authoritative transcript loss. This supports the consolidated audit's Medium
severity.

## In what sequence does the bug occur in the code?

### Main composer sequence

1. The chat screen captures a stable target, constructs the user message, and
   calls `appendCurrentChatUserMessageForSend`
   ([screen send](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1570)).
2. The append helper ensures a message ID, pushes the user row into the local
   chat optimistically, then dispatches the durable Fastify append. It returns
   `ok`, `queued`, or `error`
   ([append](../../../src/ts/chatCommands.ts#L5019)).
3. `handoffAcceptedSend` captures `previousLength` after the user append and
   calls `coordinateAcceptedChatSend`. Its append-accepted callback clears the
   captured composer state
   ([handoff](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L881)).
4. For a queued append, the coordinator first awaits durable settlement. Once
   accepted, it calls the callback and enters `startAcceptedGeneration`
   ([settlement](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L188)).
5. `attemptGeneration` waits 10 ms for the initial handoff, creates an abort
   controller, and calls `sendChat` for the captured target
   ([attempt](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L114)).
6. Fastify accepts a durable job. The browser opens and renders its SSE viewer.
   On an unexpected transport failure, the request layer tries bounded stream
   reconnection; after it cannot reconnect, it resolves the terminal as an
   error and closes the local token stream
   ([transport settlement](../../../src/ts/process/request/serverChat.ts#L684),
   [reconnect exhaustion](../../../src/ts/process/request/serverChat.ts#L932)).
7. Independently, the detached Fastify job continues. It finalizes and persists
   the complete assistant row even though this viewer is gone. Depending on
   timing, the browser can retain only the user row or a partially streamed
   assistant projection.
8. The client consumes the terminal transport error. `sendChat` returns `false`
   and releases its generation activity
   ([terminal failure](../../../src/ts/process/index.svelte.ts#L570)).
9. `startAcceptedGeneration` calls
   `acceptedGenerationReachedServer`. That function refreshes the read-only
   bootstrap active-job list
   ([probe start](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L146)).
10. If the job already completed, bootstrap contains no active job. The
    coordinator fetches the authoritative suffix using the accepted user ID.
11. The suffix contains the accepted user row followed by the completed
    assistant row. `transcriptHasReplyForAcceptedSend` returns `true`.
12. The coordinator discards the response and returns `{ status: 'generated' }`.
13. The screen runs successful-send reroll effects immediately. It does not
    hydrate or verify the transcript first. Plugin V3 analogously returns
    `true`.
14. A separate `generation.persisted` event may later cause the event resource
    pipeline to fetch and apply the same suffix
    ([event read](../../../src/ts/server/resourceInvalidation.ts#L1112)). That
    eventual apply is not awaited by steps 12 or 13.

### Explicit Retry sequence

The Retry path has the same defect with a more visible state transition:

1. The user presses Retry on an existing accepted-send recovery.
2. `retryAcceptedChatSend` sets `retrying: true` and attempts generation.
3. If the attempt returns false but the server suffix now contains the reply,
   the same boolean probe succeeds.
4. The coordinator removes the recovery record and returns `true` without
   applying the suffix
   ([retry](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L233)).
5. The button caller ignores the returned boolean; there is no separate
   hydration callback
   ([recovery UI](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2234)).

The warning can therefore disappear while the row it was warning about is
still absent or partial in the resident transcript.

## Why existing tests pass

The coordinator test named “does not record a failure when the accepted reply
was persisted after a mobile stream drop” precisely locks in the defective
classification. It mocks `sendChat` as `false`, supplies an authoritative
`[user, char]` response, expects `{ status: 'generated' }`, and asserts that no
recovery remains
([coordinator test](../../../src/ts/process/acceptedSendCoordinator.test.ts#L155)).

The test has no local chat projection and no hydration apply assertion. It
therefore proves server completion detection, not client reconciliation.

Other existing suites separately prove useful pieces:

- the client read builds and parses the bounded generation-suffix request
  ([hydration read test](../../../src/ts/server/hydrationReads.test.ts#L357));
- the server route returns absolute range metadata for the requested anchor
  ([resource read test](../../../server/fastify/__tests__/resourceReads.test.ts#L1008));
- direct ranged application preserves a loaded prefix when an assistant row is
  appended
  ([hydration test](../../../src/ts/server/chatMessageHydration.test.ts#L307));
- a direct authoritative projection supersedes an older in-flight hydration
  ([freshness test](../../../src/ts/server/chatMessageHydration.test.ts#L757));
  and
- successful-send effects correctly mutate reroll state when their input
  boolean is true
  ([completion test](../../../src/ts/process/sendChatCompletion.test.ts#L12)).

None joins those pieces into the required invariant: **the authoritative row
is resident before `generated` becomes observable**.

## What changes are needed to fix MS-06?

### 1. Replace the boolean proof with a reconciliation outcome

`acceptedGenerationReachedServer` should not return a bare boolean. Use a typed
result that distinguishes at least:

- exact job still active;
- authoritative reply fetched and applied;
- authoritative reply already present in a newer resident projection;
- no exact reply;
- response stale or superseded;
- apply failed; and
- authority read timed out/unavailable.

The caller may report `generated` only for the two reconciled states. A known
active job is evidence that work reached the server, not evidence that the
assistant transcript is complete; operation identity for that state is part of
MS-02's broader fix.

### 2. Add one guarded API for an already fetched chat-message result

Extract or expose a resource-layer function that accepts the complete
`ServerChatMessagesResult` and owns the same safety contract as normal event
invalidation. It should:

1. capture the chat-body projection epoch before the fetch;
2. require `status === 'ok'` and `result.chatId === requestedChatId`;
3. verify the accepted user row and adjacent assistant in the returned suffix;
4. reject an older body revision when a newer body is already resident;
5. detect a projection-epoch change during the fetch;
6. on supersession, inspect the **resident** transcript for the exact reply
   instead of applying the stale response or treating supersession alone as
   success;
7. pass `messageStart`/`messageTotal` to ranged application with the current
   prefix-preservation behavior;
8. apply `hypaV3Data` and `alternates` with the message body;
9. mark the chat-body revision only after a successful apply;
10. retain the current projection-epoch advance, pending-projection reapply,
    persistence/recovery acknowledgement, hydration-state update, and reroll
    seeding; and
11. re-read the resident chat by stable chat/message IDs and require the
    accepted row plus assistant adjacency after all retained projections have
    been reapplied.

If the target chat was deleted, its character shell disappeared, a newer local
mutation won the race, or the apply cannot find the chat, fail closed and keep
or create recovery state.

### 3. Use the same barrier on initial send and Retry

Both branches already call the same probe, so the reconciliation outcome
should be shared. On initial handoff, record a recovery when the barrier cannot
be completed. On Retry, remove the recovery only after the resident postcondition
passes. Do not let the UI or Plugin V3 observe `generated` earlier.

The UI does not need to issue a second hydration if the coordinator owns the
barrier. `applySuccessfulSendChatEffects` can remain where it is, provided the
coordinator result now means “resident transcript reconciled.”

### 4. Do not use current force-plus-strict hydration as the barrier unchanged

A full forced re-fetch is a viable, less efficient fallback only after its
per-call result contract is corrected. Today `hydrateChatMessages(...,
{ force: true, strict: true })` checks the persistent `hydratedChatIds` set after
the request. A previously hydrated chat remains in that set even when the new
forced request fails or is dropped as stale. That issue is documented below as
AV-MS06-02.

The safer API shape is for `hydrateChat` to return a result for **this request**
(`applied`, `superseded-with-resident-proof`, `failed`, or `stale`), with
`strict` rejecting every non-reconciled result. Clearing a cache bit before
every force request is less precise because it conflates resident data with the
success of one refresh.

### 5. Preserve server behavior, but make the anchor contract clearer if touched

No Fastify persistence change is required for the base MS-06 fix. The existing
endpoint already returns the needed payload and range. If the contract is
revised, an explicit `anchorFound`/`anchorMessageId` field or 404-like typed
result would be safer than the silent eight-row fallback. The client must still
perform exact post-apply resident verification; an echoed anchor is not a
substitute for it.

### 6. Define terminal-only effect recovery separately

Applying the transcript closes MS-06's visible consistency gap, but it does not
replay client-only terminal work such as IGP or plugin output listeners. Those
effects need an idempotent durable terminal-outcome contract, not an ad hoc call
after every suffix probe. AV-MS06-03 describes that adjacent issue.

## How should the fix be validated?

### Coordinator tests

Replace the current positive-probe assertion with tests that observe both the
coordinator result and resident transcript:

1. **User-only local chat:** server returns `[accepted user, assistant]`; the
   suffix is applied before the promise resolves `generated`.
2. **Partial assistant:** local row contains a token prefix; authoritative
   suffix replaces it with the complete server row without duplicating the
   assistant.
3. **Retry:** the recovery remains present and `retrying` until apply succeeds,
   then disappears only after resident adjacency is true.
4. **Apply failure:** a valid server snapshot whose chat no longer exists does
   not return success and records/retains recovery.
5. **Wrong chat response:** a mismatched response `chatId` fails closed.
6. **Missing/foreign anchor fallback:** an arbitrary last-eight-row response
   cannot produce success.
7. **Newer authoritative projection wins:** if an event apply supersedes the
   probe and the resident transcript already has the exact reply, return
   reconciled without applying the older body.
8. **Unrelated supersession:** if the projection epoch changes but the resident
   transcript lacks the exact reply, do not report generated.
9. **Newer local edit during fetch:** never overwrite the newer edit with the
   old suffix; resolve through resident proof or a fresh read.
10. **Background chat:** navigate to Chat B while Chat A's read is pending; the
    result applies by stable IDs only to Chat A and success effects remain
    target-scoped.
11. **Timeout/abort:** bootstrap and suffix reads always settle recovery state.
12. **Ordering:** the screen success callback and Plugin V3 `true` become
    observable only after the apply/postcondition promise settles.

Do not mock only the fetch in the key regression test. Use the real chat
hydration bridge against a seeded client database, or provide a mock apply that
mutates a resident projection and explicitly assert call ordering.

### Hydration/resource tests

Extend
[chatMessageHydration.test.ts](../../../src/ts/server/chatMessageHydration.test.ts)
and
[resourceInvalidation.test.ts](../../../src/ts/server/resourceInvalidation.test.ts)
with:

- generation suffix merge into a fully loaded prefix;
- replacement of an owned partial row;
- transcript growth, shrink, and placeholder behavior for
  `messageStart`/`messageTotal`;
- Hypa and alternate/reroll reconciliation in the same apply;
- older resource revision rejection;
- projection-epoch change during the completion probe;
- retained optimistic projections reapplied before the resident postcondition;
- accepted-send recovery acknowledgement only for the exact message; and
- a previously hydrated chat whose forced strict refresh errors or is stale,
  proving that the per-call API rejects rather than reusing the old cache bit.

### Fastify integration tests

Retain the existing durable-disconnect test and add an endpoint assertion tied
to the accepted user row:

1. append an accepted user message with a known ID;
2. start a durable generation;
3. disconnect after at least one partial token;
4. allow the server job to finish;
5. verify bootstrap no longer lists the job;
6. fetch `generationMessageId=<accepted user ID>`;
7. assert the suffix contains the exact user then the one complete assistant,
   with correct `messageStart`, `messageTotal`, and revision; and
8. assert SQLite has one assistant row and no duplicate finalization/retry row.

Also test the missing/foreign/ambiguous-anchor fallback explicitly so its
client contract remains intentional.

### Production browser/mobile matrix

Add the missing normal composer-to-real-stream Playwright journey. Existing
documentation notes that the repository lacks a normal composer-to-real-stream
browser test
([test guide](../../tests/prompting-generation-and-streaming.md#L9)). The new
journey should run in desktop Chromium and a Pixel-class mobile profile:

1. submit through the real composer;
2. wait for append and durable job acceptance;
3. interrupt the SSE viewer after zero tokens and after a partial assistant
   projection;
4. let Fastify persist the result while the page is hidden/offline;
5. return through `visibilitychange`, `pageshow`, and online recovery;
6. separately reload using the same browser profile; and
7. repeat while navigating to another chat before reconciliation settles.

For every case assert all of the following before considering the send
successful:

- exactly one authoritative assistant row is visible with complete text;
- the local client transcript matches the server suffix by stable IDs;
- no accepted-send recovery remains;
- the generation is absent from active jobs and live activities;
- the composer is in the expected accepted state;
- reroll candidates and active index match server alternates;
- automatic suggestions are not requested from a user-only/partial history;
- Plugin V3 does not resolve `true` before transcript application; and
- a delayed older response cannot overwrite a newer edit or later generation.

### Validation commands

Run focused tests first, then the full repository lanes:

```text
pnpm exec vitest run \
  src/ts/process/acceptedSendCoordinator.test.ts \
  src/ts/process/acceptedSendRecoveryState.test.ts \
  src/ts/server/hydrationReads.test.ts \
  src/ts/server/chatMessageHydration.test.ts \
  src/ts/server/resourceInvalidation.test.ts \
  src/ts/process/sendChatCompletion.test.ts

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/resourceReads.test.ts \
  server/fastify/__tests__/durableGeneration.test.ts

pnpm test:frontend
pnpm test:server
pnpm test:smoke
pnpm test:all
```

The acceptance oracle must be transcript/DOM state plus server authority, not
only `{ status: 'generated' }`, a boolean plugin result, or absence of a warning.

## Additional issues discovered outside the consolidated audit

### AV-MS06-01 — the authority probe can stall recovery indefinitely

**Confidence:** confirmed by reachable source control flow.

**Severity:** Medium. It can leave the initial failure without a banner or an
existing Retry button permanently disabled until the task/page is recreated.

`acceptedGenerationReachedServer` first awaits a read-only bootstrap request
and may then await the transcript request. The coordinator supplies no abort
signal or application timeout to either read
([probe](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L146),
[bootstrap fetch](../../../src/ts/server/bootstrap.ts#L93),
[transcript fetch](../../../src/ts/server/hydrationReads.ts#L254)).

On the initial path, the recovery record is created only after that probe
returns. A stalled fetch therefore leaves a cleared composer with no recovery
banner. On Retry, `retrying` is set before the probe and reset only after it
returns; the UI disables the Retry button directly from that flag
([retry state](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L233),
[button](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2244)).

Use one bounded AbortController/deadline for the complete authority check and a
`finally`-safe state transition. Timeout should mean “authority unknown,” keep
the recovery, and permit another manual/lifecycle retry. Test bootstrap-never-
settles and transcript-never-settles separately. This issue is also recorded in
the MS-08 validation as AV-MS08-02, but it is absent from the consolidated
audit.

### AV-MS06-02 — forced strict hydration can falsely report a successful refresh

**Confidence:** confirmed by direct state/control-flow inspection.

**Severity:** Low in current call sites, but it is a release-blocking test/fix
hazard for MS-06 because the consolidated recommendation names strict
hydration as an alternative.

After a successful hydration, `hydratedChatIds` retains the chat ID. A later
`force: true` call bypasses the cache early return, but does not remove that ID
before fetching. If the forced request errors, returns the wrong chat, is older
than the baseline, is superseded, or cannot apply, `hydrateChat` returns without
removing the old hydrated marker
([force path](../../../src/ts/server/chatMessageHydration.svelte.ts#L336)).

`hydrateChatMessages(..., { strict: true })` then checks only whether the ID is
present in `hydratedChatIds`, not whether this invocation applied its response
([strict check](../../../src/ts/server/chatMessageHydration.svelte.ts#L576)). It
can therefore resolve even though the requested authoritative refresh failed
and resident data is still stale.

The existing strict failure test starts from a never-hydrated stub, so it does
not cover the false-positive sequence
([current test](../../../src/ts/server/chatMessageHydration.test.ts#L278)). Add a
test that hydrates successfully, changes the server response to an error, and
expects `{ force: true, strict: true }` to reject. Prefer a per-request outcome
over deriving strict success from a session-wide cache marker.

### AV-MS06-03 — transcript reconciliation cannot replay skipped terminal-only effects

**Confidence:** confirmed for configured client-only effects; expected policy
for ephemeral sound/TTS/notification remains a product decision.

**Severity:** Medium for IGP and plugin automation because uninterrupted and
recovered durable generations can produce different durable/observable
outcomes.

When durable stream reconnect is exhausted, the terminal promise resolves as
an error. `applyServerBackedTerminal` exits through its error branch before the
success-side post-generation logic
([terminal error](../../../src/ts/process/serverBackedSendChat.ts#L688)). The
coordinator's later authoritative suffix probe can then report `generated`, but
it has no terminal payload and does not resume that logic.

Consequences include:

- IGP is not evaluated. Normal terminal success invokes it with the stable
  assistant target, and IGP can durably append generated data to that message
  ([normal call](../../../src/ts/process/index.svelte.ts#L597),
  [IGP write](../../../src/ts/process/postGeneration/igp.ts#L66)).
- Plugin chat output listeners are not called. They normally receive a cloned
  final chat and exact assistant index only after terminal reconciliation
  ([listener call](../../../src/ts/process/serverBackedSendChat.ts#L962),
  [listener contract](../../../src/ts/plugins/chatOutputListeners.ts#L26)).
- Client stage-4 work such as notification and emotion/image fallbacks is
  skipped
  ([stage 4](../../../src/ts/process/postGeneration/runStage4.ts#L44)).
- The normal generated-message translation terminal handler is skipped, though
  a later hydration can still carry an already embedded translation
  ([translation handler](../../../src/ts/process/serverGeneratedMessageTranslation.ts#L41)).

Blindly running these effects after every completion probe would risk duplicate
IGP writes, plugin calls, notifications, or TTS if terminal delivery status is
ambiguous. The robust fix is a durable terminal-outcome/effect ledger keyed by
the exact send/job/message identity, with per-effect idempotency. Durable data
effects should be server-owned where practical; ephemeral effects should have
an explicit recovery policy. Add a disconnect-after-persistence-before-terminal
test for each supported effect class.

### De-duplicated observations

The following were investigated but are not additional independent findings:

- treating any same-chat active job as success is MS-02;
- recovery warning/job disagreement is MS-07;
- bounded replay replacing a complete result with a token suffix is MS-03;
- suggestions, reroll state, auto-scroll, and Plugin V3's early `true` are
  downstream consequences of MS-06's missing reconciliation barrier; and
- the endpoint's eight-row anchor fallback fails safe for the current exact
  accepted-message predicate, although an explicit anchor result would improve
  the contract.

## Historical comparison

Git blame identifies commit `c4dcce622bed69613eddc6b276fb5796d24ce656`
(`fix: reconcile accepted sends after background completion`) as the change
that introduced the completion probe. Its intent was correct: avoid showing a
failure when a detached durable job had already completed. The regression is
that the new read was added as proof only; it was not connected to the existing
authoritative apply path. The accompanying test asserted the new classification
but not resident state.

The plain pre-Fastify checkout has no equivalent server-authoritative recovery
probe. Its screen pushes the user row into the browser-owned database, awaits
`sendChat`, and records reroll data only when the local transcript length grows
([historical send](../../../../Risuai/src/lib/ChatScreens/DefaultChatScreen.svelte#L192),
[historical completion](../../../../Risuai/src/lib/ChatScreens/DefaultChatScreen.svelte#L305)).
That design does not solve mobile durability and should not be ported back, but
it demonstrates the semantic expectation that success effects follow a local
transcript change.

## Investigation and verification notes

- Five independent Luna read-only workers successfully cross-checked the
  coordinator sequence, endpoint contract, hydration path, caller effects, and
  tests. Two additional workers failed at the runner boundary; historical and
  undocumented-issue checks were completed directly in the main investigation.
- The focused frontend run passed **80 tests across five files**:
  `acceptedSendCoordinator.test.ts`, `acceptedSendRecoveryState.test.ts`,
  `hydrationReads.test.ts`, `chatMessageHydration.test.ts`, and
  `sendChatCompletion.test.ts`.
- The focused Fastify run passed all **40**
  `durableGeneration.test.ts` tests. In the combined server run,
  `resourceReads.test.ts` passed 17 of 18 tests; its one failure concerns extra
  legacy-preset fields and is unrelated to chat messages or MS-06. The
  generation-suffix route case was rerun alone and passed.
- No physical-device session, process-kill harness, live external provider, or
  full Playwright lifecycle journey was run. The MS-06 confirmation follows
  directly from reachable current control flow, the test's existing positive
  probe fixture, and the absence of any apply call before success.

## Exit criteria

MS-06 is fixed only when all of the following are true:

- a completion probe returns success only after exact resident transcript
  reconciliation;
- the fetched suffix is applied with chat identity, revision, projection-epoch,
  range, retained-projection, and post-apply adjacency guards;
- user-only and partial-stream local projections both become the complete
  authoritative row without duplication;
- initial and Retry paths share the same barrier;
- recovery state is retained on timeout, stale/superseded-without-proof, wrong
  chat, missing target, and apply failure;
- no UI success effect or Plugin V3 `true` is observable before the barrier;
- forced strict hydration reports the result of the current request rather than
  an old cache marker;
- terminal-only durable/client effects have an explicit idempotent recovery
  policy; and
- the real composer/mobile disconnect matrix passes while asserting DOM,
  resident client state, bootstrap/job state, and SQLite authority.
