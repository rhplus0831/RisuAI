# MS-10 validation: auxiliary send paths bypass accepted-send recovery

Investigated: 2026-08-11

Consolidated finding: [MS-10 — Auxiliary send paths bypass the recovery boundary](../fastify-multichat-mobile-stability-audit-2026-08-11.md#ms-10--auxiliary-send-paths-bypass-the-recovery-boundary)

Audit revision: `9afde4658ea5b277493e9d7f6ef7aaf387544165`

Validation revision: `e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`

Status: **Confirmed, with a broader affected surface than the consolidated finding records.**

## Executive conclusion

MS-10 is a real append-to-generation ownership bug. DevTool Autopilot and the
`.po` translation workflow both create a user message with
`appendCurrentChatUserMessageForSend()`, but neither transfers the returned
target, message ID, and possible queued settlement to
`coordinateAcceptedChatSend()`. Instead, each caller separately interprets the
append result and eventually calls raw `sendChat()`.

That split loses the guarantees that the normal composer and Plugin V3 already
have:

- a queued append is followed through to final acceptance or failure;
- an accepted message is generated for the captured chat even if the user has
  navigated elsewhere;
- a failed generation is associated with the exact accepted message and
  exposed as a retryable, chat-scoped recovery; and
- retry starts only the missing reply and never appends the user message again.

The consolidated report names two affected paths. This investigation also
confirmed the user-reachable `/multisend` slash command as a third bypass. It
has an even weaker boundary: it dispatches its transcript mutation
fire-and-forget, then invokes raw generation without obtaining or consuming an
append-acceptance outcome.

The consolidated audit rates MS-10 **Medium** because these are narrower
auxiliary tools. That rating is reasonable as a reachability discount, but it
is in tension with the audit's stated severity model: once an append is
accepted, silently stranding it is one of the model's High-impact outcomes.
The code evidence and confidence are High regardless of which severity label
is retained.

## What the correct boundary does

The normal send flow has two distinct operations and one mandatory handoff:

1. `appendCurrentChatUserMessageForSend()` captures a stable message ID,
   optimistically inserts the row, and dispatches its durable command. It
   returns `ok`, `queued` with a settlement promise, or `error`
   ([append result type](../../../src/ts/chatCommands.ts#L108-L111),
   [append implementation](../../../src/ts/chatCommands.ts#L5019-L5118)).
2. Every non-error append result is immediately handed to
   `coordinateAcceptedChatSend()` with the captured chat target. The
   coordinator deduplicates by target plus message ID, waits for a queued
   append to settle, and starts generation exactly once for that target
   ([operation identity](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L51-L80),
   [handoff](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L182-L222)).
3. If raw generation returns `false`, the coordinator refreshes active jobs and
   probes the authoritative transcript. If neither proves that this send
   reached the server, it records a recovery containing the target, accepted
   message ID, failure cause, and retry state
   ([generation attempt and probe](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L109-L179),
   [recovery shape](../../../src/ts/process/acceptedSendRecoveryState.ts#L5-L16)).
4. The chat UI selects that recovery by target, shows a retry action, and retry
   reuses the same message identity without another append
   ([target lookup and retry](../../../src/ts/process/acceptedSendCoordinator.svelte.ts#L224-L257),
   [visible recovery](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L2234-L2255)).

The normal composer follows this contract even after navigation. It passes
both immediate and queued results to the coordinator and uses callbacks only
for composer/draft state
([composer handoff](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L881-L918),
[normal send call site](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1583-L1605)).
Plugin V3 does the same and waits for the coordinator's terminal result
([Plugin V3 send](../../../src/ts/plugins/apiV3/v3.svelte.ts#L1898-L1908)).

MS-10 is not that `sendChat()` itself lacks durable-job recovery. The defect is
that these callers never register ownership of the accepted message with the
layer that decides whether generation must start, is already running, has
completed, or needs an explicit retry.

## What exactly is broken

| Path | Append behavior | Post-append behavior | Lost guarantee |
| --- | --- | --- | --- |
| DevTool Autopilot | Awaits `appendCurrentChatUserMessageForSend()` for each line | Returns on navigation, handles `queued` as a terminal branch, then calls `sendChat(i, ...)` directly | Queued settlement, navigation-safe handoff, failure probe, and recovery record |
| `.po` translation | Awaits `appendCurrentChatUserMessageForSend()` for each PO entry | Accepts only immediate `ok`, then calls `sendChat(-1)` directly | Queued settlement, navigation-safe handoff, failure probe, and recovery record |
| `/multisend` slash command | Mutates through a fire-and-forget compatible chat update | Calls `sendChat(-1)` immediately | Durable append acceptance, message-ID handoff, and every coordinator guarantee |

### DevTool Autopilot

The Run handler captures one target and checks that it is idle. For every
Autopilot line it awaits the append, then checks target freshness **before** it
does anything with the append result
([DevTool flow](../../../src/lib/SideBars/DevTool.svelte#L241-L273)). This creates
three confirmed failure modes:

1. **Navigation while append is in flight.** The server can accept the append
   while the user changes chat. When the promise resolves, the freshness check
   returns from the handler. The accepted row is left in the captured chat;
   generation was never attempted and no recovery was registered.
2. **Queued append.** If transport or writer conditions retain the append in
   the durable outbox, the handler displays the generic queued-message notice
   and returns. It never observes `append.settlement`. If replay later accepts
   the row, nothing launches its reply. If replay rejects it, the lower layer
   may roll back the optimistic row, but Autopilot does not own or report that
   terminal result.
3. **Raw generation failure.** After an immediate `ok`, `sendChat(i, ...)` can
   still return `false` because of same-chat contention, settings/context
   persistence failure, server rejection, provider failure, or exhausted
   transport recovery. Autopilot simply stops. The already accepted user row
   has no retry record.

The existing navigation test codifies the first broken branch: after a
successful append resolves under a new active target, it asserts only that raw
generation was not called
([DevTool navigation test](../../../src/lib/SideBars/DevTool.svelte.test.ts#L239-L260)).
It does not assert rollback—which would be wrong for a server-accepted row—or
any recovery/handoff.

There is also a race inside the raw call. Autopilot supplies the loop index as
`chatProcessIndex`. A nonnegative index bypasses `sendChat()`'s ordinary
same-chat activity rejection, so a generation that starts after Autopilot's
precheck can be entered as a legacy reentrant call
([activity gate](../../../src/ts/process/index.svelte.ts#L230-L265)). The server
can still reject the second job, but this path provides no typed failure
ownership or accepted-send recovery.

### `.po` translation multisend

`postChatFile()` invokes `sendPofile()` for selected `.po` files
([file dispatch](../../../src/ts/process/files/multisend.ts#L195-L260)). The PO
loop captures one target, parses an entry, appends its `msgid` as a user row,
requires `appendResult.status === 'ok'`, invokes raw `sendChat(-1)`, and reads
the current transcript's last row as the translation
([PO loop](../../../src/ts/process/files/multisend.ts#L26-L72)).

The confirmed failure sequences are:

1. **Navigation during append:** an immediately accepted row is followed by a
   stale-target return before generation, with no coordinator record.
2. **Queued append:** every status other than immediate `ok` returns `false`.
   A later-accepted outbox row therefore has no generation handoff. Unlike
   DevTool, this path does not even show the queued-message notice.
3. **Generation returns `false`:** the boolean is ignored. The last row is then
   usually the just-appended **user** row, so its source text is serialized as
   if it were the assistant's translation. The workflow may download a
   plausible-looking but materially incorrect `translated.po`.
4. **Generation throws:** `postChatFile()` catches the exception and silently
   skips that PO file. Any already accepted user row remains without
   accepted-send recovery.
5. **Partial batch:** entries before a target change or failure remain in the
   transcript. Later entries are skipped, and no operation-level result tells
   the user which accepted entries received replies.

The current tests cover a 125-entry happy path, command persistence, target
switching, picker errors, and a thrown raw send
([PO tests](../../../src/ts/process/files/multisend.test.ts#L239-L258),
[failure tests](../../../src/ts/process/files/multisend.test.ts#L346-L419)). They
do not cover a retained append, `sendChat()` resolving `false`, coordinator
recovery, retry without re-append, or exact assistant-row ownership.

### `/multisend` slash command

This path is not enumerated in the consolidated finding. It is reachable both
from slash-prefixed composer input
([composer command dispatch](../../../src/lib/ChatScreens/DefaultChatScreen.svelte#L1520-L1527))
and command trigger effects
([trigger dispatch](../../../src/ts/process/triggers.ts#L1817-L1820),
[V2 trigger dispatch](../../../src/ts/process/triggers.ts#L2341-L2347)).

For every `|||` segment, `/multisend` changes the transcript with
`mutateCurrentChatMessages()` and calls raw `sendChat(-1)`
([slash multisend](../../../src/ts/process/command.ts#L169-L201)). The mutation
helper returns `true` immediately after optimistic application and starts its
compatible command asynchronously
([scoped mutation](../../../src/ts/chatCommands.ts#L3706-L3739)). The shared
character-owner durable queue is a useful lower-level ordering safeguard: it
can stop successor send-context maintenance from overtaking a retained append.
It does not give this caller the append outcome or create a post-acceptance
generation obligation. If the raw send aborts behind that retained mutation
and replay later accepts the row, or if raw generation fails after acceptance,
there is still no message-keyed recovery.

Its tests currently require raw `sendChat()` calls and command order, but do
not hold the append response, simulate retention/failure, or inspect accepted
send recovery
([slash multisend tests](../../../src/ts/process/__tests__/command.resourceGuard.test.ts#L500-L580)).

## User impact

The primary visible symptom is a user-authored row that remains in a chat with
no assistant reply and no “Retry reply” banner. The user cannot tell whether
the operation is waiting, failed, or was intentionally not generated. Their
only practical recovery is to manually generate again, resend and risk a
duplicate, or edit/delete the stranded row.

The impact varies by entry point:

- **DevTool Autopilot:** a long sequence stops at the first queued, navigated,
  or failed generation. Earlier steps may be complete while the final accepted
  line is reply-less. The queued notice is misleading over time because its
  normal follow-up generation is never attached to settlement.
- **PO translation:** a batch may stop after modifying the chat, silently skip
  a file, or export source text as translated text. Users can receive both
  transcript pollution and a wrong output artifact.
- **Slash `/multisend`:** manual commands and trigger-driven automation can
  strand a later-accepted segment when the unowned raw send aborts or fails,
  with no recovery affordance.
- **Mobile/navigation use:** changing chats or routes while an append is
  awaiting the network makes the navigation branch realistic. Process eviction
  after handoff is the separate MS-01 defect; merely routing these callers
  through the current in-memory coordinator does not make recovery survive a
  reload.

No server transcript corruption is required for MS-10. The durable append can
be perfectly valid; what is lost is the obligation to create or recover the
corresponding reply.

## Root cause and historical behavior

The auxiliary workflows preserve the original app's sequential intent but
were not fully adapted to the Fastify durability contract.

- Original DevTool Autopilot directly pushed a user row into browser state and
  then awaited `sendChat(i)` (`/home/codex/Risuai/src/lib/SideBars/DevTool.svelte:213-238`).
- Original PO translation directly pushed each `msgid`, awaited
  `sendChat(-1)`, and read the last row
  (`/home/codex/Risuai/src/ts/process/files/multisend.ts:16-64`).
- Original `/multisend` likewise pushed each segment and called raw generation
  (`/home/codex/Risuai/src/ts/process/command.ts:163-180`).

Those flows had no `ok`/`queued`/`error` durable append outcome and no accepted
send coordinator to call. During the Fastify migration, target fences and
command-backed append helpers were added, but the second half of the new
protocol—the mandatory accepted-send handoff—was added only to the normal
composer and Plugin V3. MS-10 is therefore a migration integration gap, not a
new product requirement inferred for these tools.

## Changes needed to fix MS-10

### 1. Route every append-and-generate caller through one API

The tactical fix is to make `coordinateAcceptedChatSend()` the only legal
post-append generation handoff:

- import it in DevTool and `files/multisend.ts`;
- pass both `ok` and `queued` append results unchanged, including their exact
  `messageId` and settlement;
- pass the captured `ActiveChatTarget` even if it is no longer active;
- remove the freshness return between a completed append and coordinator
  registration;
- await the coordinator result before advancing a batch; and
- stop the batch on `append_failed` or `generation_failed`, allowing the latter
  to remain represented by its recovery record.

DevTool should no longer call `sendChat(i)`. The coordinator's ordinary
`sendChat(-1, { expectedTarget })` path restores the ordinary same-chat
single-flight entry. A typed server `generation_in_progress` failure remains
retryable; guaranteeing correct ownership when only a generic local failure
and an unrelated active job are visible also requires the operation-identity
fix described by MS-02.

For PO translation, the caller must also stop ignoring the generation outcome.
After `generated`, it should locate the assistant row adjacent to the exact
accepted `messageId` in the captured chat—not use the globally selected chat's
last row. If that projection is not present, force or apply authoritative
hydration before producing the output. This is necessary to avoid preserving
the wrong-output bug and to coexist with the separate MS-06 completion-probe
finding.

The `/multisend` command should use the same append helper and coordinator for
non-`clear` sends. `clear` mode needs an explicitly awaited durable transcript
replacement followed by the coordinated append; a fire-and-forget destructive
replacement cannot be safely folded into the send. Trigger callers must await
the same terminal result.

### 2. Make bypasses harder to reintroduce

The safer refactor is a higher-level `appendAndCoordinateChatSend()` operation
that owns the append and mandatory handoff while exposing lifecycle callbacks
for composer-specific draft behavior. Keeping a broadly importable append
helper beside a broadly importable raw `sendChat()` makes the invalid pairing
easy to recreate. A small architectural test or lint rule can enumerate the
few allowed raw-generation callers: continue, regenerate, preview, reattach,
and other operations that do not first append a new user row.

### 3. Preserve the longer-term atomic design

Routing through the current coordinator closes the caller-specific MS-10 gap
while the page remains alive, but it inherits MS-01, MS-02, MS-06, and MS-07.
The root fix remains an idempotent server operation keyed by client operation
ID, chat ID, and accepted message ID that atomically accepts the user row and
records or launches its generation. Job/bootstrap/terminal projections must
carry that identity. This removes the process-memory handoff window instead of
only making every caller enter it consistently.

## Validation plan

### Unit and component matrix

| Scenario | Required assertion |
| --- | --- |
| Immediate accepted append | Exactly one coordinator operation and one generation for the captured target; no duplicate user row |
| Queued append, later accepted | No generation before settlement; exactly one generation after acceptance; batch waits |
| Queued append, later failed | No generation, optimistic row rolls back as owned, caller reports failure, no false recovery |
| Navigation while append is in flight | Accepted result is still handed off to the original target; generation never redirects to the newly active chat |
| Navigation after generation starts | Current item reaches terminal/recovery state; subsequent batch items follow the documented stop policy |
| Same-chat generation appears after precheck | The new attempt is not reported as generated by an unrelated job; after the MS-02 identity fix, the exact accepted message retains recovery |
| Provider/transport/context failure | Target/message-keyed recovery is visible; retry calls generation once and does not append again |
| Duplicate handoff | Reusing the same target/message ID returns the remembered operation and never double-generates |
| PO success | Output comes from the adjacent assistant row for the exact accepted message ID |
| PO generation returns `false` or throws | No source/user row is serialized as a translation; no success download; recovery remains available when append was accepted |
| Multi-entry batch | Entry N+1 does not append until entry N is generated or has reached its explicit terminal/recovery result |
| `/multisend clear` | Replacement and append are durably ordered; generation never observes a rejected or stale replacement |

Update the current tests rather than only adding coordinator unit tests:

- `DevTool.svelte.test.ts` should mock/inspect the coordinator and reverse the
  navigation test's present expectation: generation ownership must be handed
  off after accepted append even though the visible chat changed.
- `multisend.test.ts` needs deferred queued settlements, resolved-`false`
  generation, exact message-ID/assistant adjacency, partial-batch, and retry
  assertions.
- `command.resourceGuard.test.ts` should stop expecting raw `sendChat(-1)` and
  instead hold command acceptance while proving no early generation.
- Keep `acceptedSendCoordinator.test.ts` as the shared contract suite. It
  already proves queued acceptance/failure, deduplication, target capture,
  server completion probing, failure recording, and retry without re-append
  ([coordinator tests](../../../src/ts/process/acceptedSendCoordinator.test.ts#L71-L234)).
- Reuse the normal composer and Plugin V3 queued/navigation/recovery cases as
  positive-control behavior
  ([composer queued cases](../../../src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts#L1857-L1930),
  [composer recovery cases](../../../src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts#L2542-L2739),
  [Plugin V3 cases](../../../src/ts/plugins/apiV3/v3.svelte.test.ts#L773-L905)).

### Integration and mobile lifecycle validation

Add one Fastify/browser journey with deterministic fault injection:

1. hold the append response, navigate to another chat, then release an accepted
   response;
2. verify the coordinator retains the original chat/message key and generation
   targets the original chat; if the atomic design is used, verify the server
   request and job carry the operation/message identity too;
3. force generation rejection and verify the recovery banner appears only when
   returning to the original chat;
4. retry and verify one assistant row is appended after the original user row;
5. repeat with a retained outbox append that settles after connectivity is
   restored; and
6. exercise DevTool, PO, and composer `/multisend` entry points, not just the
   normal composer.

If the tactical in-memory fix is chosen, document that a process kill between
append settlement and job acceptance still fails under MS-01. If the atomic
server operation is implemented, extend the journey with page reload/process
loss at every append-to-job checkpoint and require automatic reconstruction
without duplicate append or generation. The current test guide explicitly
notes that no composer-to-stream-to-durable-reload or crash/reload browser
journey exists
([test-suite gap](../../tests/README.md#major-gaps)).

After implementation, run at minimum:

```sh
pnpm exec vitest run \
  src/ts/process/acceptedSendCoordinator.test.ts \
  src/lib/SideBars/DevTool.svelte.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/process/__tests__/command.resourceGuard.test.ts \
  src/ts/plugins/apiV3/v3.svelte.test.ts
pnpm check
pnpm check:server
pnpm test:frontend
pnpm test:gates
pnpm test:server
pnpm test:smoke
```

For this investigation, the first four focused files were run unchanged: **4
files and 37 tests passed**. That is a baseline, not disproof of MS-10. Several
of those tests explicitly assert raw-send behavior or stop at “generation was
not called,” which is the missing ownership under review.

## Additional issues not documented in the consolidated audit

The following reachable issues were confirmed while tracing MS-10 and are not
separately documented in the consolidated report:

1. **`/multisend` is a third accepted-send bypass.** It is user- and
   trigger-reachable, invokes generation before the caller has a durable
   mutation outcome, and has no recovery identity. Lower-level owner ordering
   reduces overtaking but does not repair the missing handoff. This belongs in
   the MS-10 affected-path list and fix scope.
2. **PO translation ignores a failed generation result and can export the user
   source as the assistant translation.** This is a materially wrong artifact,
   not merely missing recovery. The fix must require an exact assistant row
   owned by the accepted message before writing `translated.po`.
3. **DevTool's loop index activates legacy reentrant generation behavior.** A
   generation that starts between its activity precheck and raw call does not
   hit the normal `chatProcessIndex === -1` client guard. Routing through the
   coordinator removes this bypass.
4. **The PO parser does not flush a final entry at EOF unless the file ends with
   an empty line.** Entry processing occurs only in the `line === ''` branch;
   a syntactically complete final `msgid`/`msgstr` pair without a trailing separator
   is omitted and can produce incomplete output
   ([entry flush](../../../src/ts/process/files/multisend.ts#L32-L72)). Existing
   fixtures always add a trailing newline
   ([fixture generator](../../../src/ts/process/files/multisend.test.ts#L169-L173)).
5. **PO extracted-note parsing has a singular/plural typo.** The condition
   accepts `#. Note =`, but the replacement removes `#. Notes =`, so the marker
   itself remains in the text sent to the model
   ([note parsing](../../../src/ts/process/files/multisend.ts#L73-L77)). This is
   inherited from the original app and is independent of accepted-send
   recovery.

The last two are adjacent PO parser defects and can be fixed/tested separately.
The first three should be addressed in the same change as MS-10 because they
share or directly interact with the post-append handoff.

## Final assessment

MS-10 is not a theoretical mobile race. The current source has explicit return
branches after append dispatch and explicit raw-generation calls outside the
accepted-send state machine. The minimal safe correction is to hand every
non-error append result to the coordinator immediately and make each batch
wait for that owned operation. The complete reliability correction is the
audit's broader atomic, idempotent append-and-launch server boundary.
