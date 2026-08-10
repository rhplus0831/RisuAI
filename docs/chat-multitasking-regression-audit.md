# Chat multitasking regression audit

Last verified: 2026-08-10
Review range: `HEAD~4..HEAD` (`ed8f173f4` through `cb7152ee6`)
Status: Open work ledger

## Purpose

The reviewed commits allow message generation to continue while the user opens
and sends from other chats. The chat-keyed generation registry is a sound
starting point, but several surrounding flows still assume that only one chat
can be active at a time. The resulting failures include accepted messages that
never receive a reply, generation work targeting the wrong chat, ineffective
cancellation, retry loops, and transient UI state leaking between chats.

This document divides the audit into independently assignable work items. An
agent should claim and resolve one item at a time unless an item's dependency or
overlap note explicitly says otherwise.

## How to use this ledger

### Status values

- `Ready`: the finding and expected behavior are sufficiently defined for an
  implementation agent.
- `Needs design`: the defect is verified, but the ownership or recovery policy
  must be chosen before implementation.
- `In progress`: an agent has claimed the item. Record the owner or task link.
- `Blocked`: progress requires an explicit product or architecture decision.
- `Resolved`: the fix and regression tests have landed. Record the commit and
  tests in the resolution field.

### Agent workflow

1. Reverify the cited current-code evidence before editing; line numbers will
   drift as earlier items land.
2. Change the item's status to `In progress` and record the owner/task.
3. Stay within the listed scope. If a necessary change overlaps another item,
   update both entries before broadening the implementation.
4. Add the item-specific regression tests. A passing existing suite is not
   sufficient because several current tests omit or explicitly accept the
   failing concurrency window.
5. Run `pnpm check`, the focused frontend/server tests named by the item, and
   Prettier on edited files.
6. Mark the item `Resolved` with its commit hash and test names. Do not delete
   completed findings from this ledger.

### Cross-cutting invariants

- Capture a stable `characterId` and `chatId` before the first asynchronous
  boundary and keep using that target through append, generation, progress,
  cancellation, completion, and error recovery.
- A durably accepted user message must lead to exactly one generation attempt
  for the same chat, or to an explicit, recoverable error. It must never be
  silently stranded.
- Work in Chat A must not change Chat B's composer, controls, stages, progress,
  reroll candidates, suggestions, or translation availability.
- Cancellation must affect only the work represented by the visible Stop
  control and must cancel a durable server job exactly once.
- `accepted`, `queued`, and `failed` command outcomes remain distinct. A queued
  append must not be duplicated by retry logic.
- Stable IDs, not mutable array indexes, own asynchronous completion writes.

## Work queue

| ID | Priority | Status | Work item | Primary area | Dependencies |
| --- | --- | --- | --- | --- | --- |
| MTC-01 | P1 | Ready | Continue an accepted send after navigation | Composer/generation handoff | None |
| MTC-02 | P1 | Ready | Recover an append when the server rejects a duplicate same-chat generation | Composer/server lock | Coordinate with MTC-01 |
| MTC-03 | P1 | Ready | Preserve the plugin send target across awaits | Plugin API | Prefer MTC-01 target contract |
| MTC-04 | P1 | Ready | Stop retrying terminal reattach failures | Reattach lifecycle | None |
| MTC-05 | P1 | Ready | Cancel a reattached durable job before its response opens | Reattach cancellation | Coordinate with MTC-04 |
| MTC-06 | P2 | Ready | Scope Draft/BTW hook activity and cancellation by chat | Input hooks/composer | None |
| MTC-07 | P2 | Ready | Make reroll candidates chat-scoped | Reroll navigation | None |
| MTC-08 | P2 | Ready | Make live generation progress chat-scoped | Progress UI | None |
| MTC-09 | P2 | Ready | Generate suggestions after background completion | Suggestions | MTC-08 optional |
| MTC-10 | P2 | Ready | Remove aggregate `doingChat` locks from cross-chat-safe features | Translation/preview/autopilot | None |
| MTC-11 | P2 | Ready | Use stable IDs for asynchronous finalization and error writes | Post-generation/error handling | None |
| MTC-12 | P2 | Ready | Keep preview results owned by their original chat | Prompt preview | Coordinate with MTC-10 |
| MTC-13 | P3 | Ready | Prevent generation indicators from intercepting avatar clicks | Sidebar indicators | None |
| MTC-14 | P3 | Ready | Make the pinned rail inert with the narrow menu | Sidebar accessibility | None |
| MTC-15 | P3 | Ready | Expose active pinned-chat state | Sidebar accessibility | None |
| MTC-16 | P3 | Ready | Localize the unnamed pinned-chat fallback | Sidebar localization | None |
| MTC-17 | P3 | Ready | Canonicalize missing-character routes after multitasking navigation | Router | None |

## Recommended execution order

1. Resolve the data- and lifecycle-critical items: MTC-01 through MTC-05.
2. Resolve state ownership: MTC-06 through MTC-09.
3. Audit remaining compatibility projections and stable completion targets:
   MTC-10 through MTC-12.
4. Finish the bounded navigation and accessibility items: MTC-13 through
   MTC-17.

MTC-04 and MTC-05 touch the same reattach code and should be implemented
sequentially. MTC-10 and MTC-12 also overlap in preview ownership. Other items
can be assigned independently once their dependencies are resolved.

---

## MTC-01 — Continue an accepted send after navigation

**Priority:** P1
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —
**Decision (2026-08-10):** Chat-independent coordinator. Once an append is
durably accepted, generation is no longer tied to the chat being active; the
send path must behave identically whether navigation happens before or after
generation starts. The retry/error state is the failure branch, not the policy.

### Problem

The normal composer appends the user message before starting generation. If the
user opens another chat while the append command or the following delay is
settling, freshness checks return before `sendChatMain`. The message remains
persisted in the original chat, its draft is consumed, no generation starts,
and no error is shown.

The current test named `silently aborts a delayed append result after the active
chat changes` explicitly expects this behavior, so this is a product-contract
failure rather than an undetected test failure.

### Reproduction

1. Enter a message in Chat A and click Send.
2. Delay the append command response.
3. Open Chat B before the append settles or during the following `sleep(10)`.
4. Settle the append successfully.
5. Return to Chat A: the user row exists, but no assistant generation was
   started and no failure was surfaced.

### Evidence

- `src/lib/ChatScreens/DefaultChatScreen.svelte:1504-1538` appends first,
  returns on stale selection at three points, and starts generation last.
- `src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts:2220-2263`
  expects `sendChat` and `alertError` not to run after the accepted append.
- `src/ts/chatCommands.ts:5091-5103` shows the durable command settlement that
  creates the navigation window after optimistic application.

### Implementation boundary

Hand the accepted operation to a chat-independent coordinator and start
generation exactly once for the captured Chat A target, using the existing
chat-keyed generation registry. If the coordinator cannot start generation
(preflight failure, server rejection), restore an actionable retry state in
Chat A and visibly report the failure — that path is the fallback for
coordinator failure, not an alternative to starting generation.

Do not navigate back automatically, write into Chat B, duplicate a queued
append, or restore Chat A's draft over newer text typed after the send.

### Acceptance criteria

- Navigation after an accepted append cannot silently suppress generation.
- Generation, recovery, and any error belong to the original stable chat ID.
- Chat B's composer and draft remain untouched.
- Reopening Chat A shows either its generated reply or an explicit retryable
  failure state.
- Queued append settlement starts at most one generation.

### Required tests

- Replace the existing silent-abort expectation with a captured-target handoff
  or explicit recovery assertion.
- Cover navigation while the append is pending and during the post-append
  delay.
- Cover a newer draft typed in Chat A or Chat B while the old operation settles.
- Cover queued settlement and prove no duplicate user row or generation.

---

## MTC-02 — Recover an append rejected by the same-chat generation lock

**Priority:** P1
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —
**Decision (2026-08-10):** Explicit retryable state, no automatic recovery.
Rollback is unsafe (the row may have been observed elsewhere) and
auto-retry-when-free launches unwatched generations and can duel with other
clients. Auto-continue after the remote job completes may be revisited later
as a follow-up if manual retry proves annoying; it is out of scope here.

### Problem

A different tab/client can already own Chat A's server generation lock before
the local bootstrap projection learns about it. The local UI appends and clears
the composer, then `/generate/chat` returns `409 generation_in_progress`.
`sendChat` reports failure without rolling back or otherwise recovering the
accepted user row.

### Reproduction

1. Start a durable generation for Chat A from another client.
2. Before the current client refreshes `activeGenerationJobs`, send from Chat A.
3. Let the user-message append succeed and the generation request return 409.
4. Observe the persisted user row, cleared composer, and missing reply.

### Evidence

- `server/fastify/src/routes/generationChat.ts:3900-3905` rejects a second
  running job for the chat.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:1504-1538` commits the user row
  before dispatching generation.
- `src/ts/process/index.svelte.ts:407-410` converts failed server assembly into
  `false`; it does not own append recovery.
- `server/fastify/__tests__/durableGeneration.test.ts:1170-1183` covers the raw
  409 but not transcript/composer recovery.

### Implementation boundary

The MTC-01 coordinator owns this path: on a 409 it marks the accepted append
as needing generation, surfaces the already-running remote job through the
normal `activeGenerationJobs` bootstrap so the user can see why, and exposes a
one-click retry on the stranded row. Do not delete the persisted row: another
client may already have observed it, and revision conflicts must remain
authoritative. Do not start generation automatically when the remote lock
frees.

### Acceptance criteria

- A 409 cannot leave an unexplained, reply-less user row.
- The UI identifies the original chat and exposes a safe retry/recovery action.
- Recovery does not duplicate the user message or interfere with the existing
  server job.
- The composer does not report success merely because append succeeded.

### Required tests

- Add an integration test covering append success followed by generation 409.
- Assert transcript, composer, error UI, and retry behavior.
- Cover bootstrap catching up to the already-running job during recovery.

---

## MTC-03 — Preserve the plugin send target across awaits

**Priority:** P1
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

The V3 plugin `sendChat` checks the active chat, awaits an unscoped append, and
then calls `processSendChat(-1, {})` without the original target. Navigation
during the append can persist the user row in Chat A and start generation in
Chat B. The API returns `true` without checking the generation result.

### Reproduction

1. Invoke plugin `sendChat` in Chat A.
2. Pause the durable append after its optimistic Chat A write.
3. Open Chat B and settle the append.
4. Observe `processSendChat` capture Chat B while the user row remains in A.

### Evidence

- `src/ts/plugins/apiV3/v3.svelte.ts:1881-1910` captures local records but does
  not construct or pass an `ActiveChatTarget`.
- `src/ts/chatCommands.ts:5023-5035` already supports `expectedTarget` checks.
- The changed per-chat guard in `v3.svelte.ts` makes this path reachable while
  another chat is generating.

### Implementation boundary

Capture one stable target before the first await, pass it to the append helper
and generation coordinator, and propagate a false generation result as an API
failure. Preserve the existing queued-append no-duplicate contract.

### Acceptance criteria

- Plugin generation always targets the chat captured when the API call began.
- Navigation cannot redirect the append or generation.
- A failed generation is not reported as plugin success.
- A queued append resolves without a duplicate retry or cross-chat generation.

### Required tests

- Add a deferred-append navigation test to `src/ts/plugins/apiV3/v3.svelte.test.ts`.
- Assert the exact `expectedTarget` passed to append and generation.
- Cover stale-before-append, stale-after-append, queued, and generation-false
  outcomes.

---

## MTC-04 — Stop retrying terminal reattach failures

**Priority:** P1
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

`maybeReattachOpenChatGeneration` restores every non-aborted `false` result.
`sendChat` also uses `false` for terminal SSE errors and expired/404 jobs. When
the generation activity finishes, the activity subscription schedules another
reattach, producing an immediate request/error loop.

### Reproduction

1. Seed `activeGenerationJobs` with an expired job or a job that emits a
   terminal `error` frame.
2. Open its chat and allow reattach.
3. Observe the job get forgotten by the request layer, restored by reattach,
   and immediately requested again.

### Evidence

- `src/ts/process/reattach.ts:127-153` restores all non-aborted false results.
- `src/ts/process/reattach.ts:202-207` retriggers on every activity change.
- `src/ts/process/index.svelte.ts:343-348` returns false for completed/GC'd
  reattach jobs.
- `src/ts/process/request/serverChat.ts:795-834` forgets jobs on terminal error.
- `src/ts/process/request/serverChat.ts:640-684` classifies missing/404 reconnects.

### Implementation boundary

Carry a typed reattach outcome that distinguishes retryable transport failure
from terminal failure, missing job, explicit abort, and successful completion.
Only retry transport failures, with a bounded/backed-off trigger rather than an
activity-change spin.

### Acceptance criteria

- Terminal error and 404/expired outcomes are attempted once and not restored.
- Retryable transport failure remains recoverable.
- Explicit abort remains final.
- No failure path creates a tight microtask/network loop.

### Required tests

- Extend `src/ts/process/__tests__/reattach.test.ts` with terminal error, 404,
  retryable transport, and activity-settlement cases.
- Count request attempts after microtasks settle.
- Assert terminal jobs are absent and retryable jobs remain available.

---

## MTC-05 — Cancel a reattached durable job before its response opens

**Priority:** P1
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

Reattach removes the known job from `activeGenerationJobs` before opening the
GET. The request layer installs `cancelDurableOnAbort` only after
`openChatResponse` resolves. If Stop wins that interval, the activity controller
is aborted and the cancellation function returns early, but no DELETE is sent
for the already-known durable job. The server continues and later persists it.

### Reproduction

1. Reload with a known active durable job.
2. Delay the reattach GET before response headers resolve.
3. Press Stop.
4. Verify the viewer fetch aborts but the durable cancellation endpoint is not
   called and the server job completes.

### Evidence

- `src/ts/process/reattach.ts:116-133` consumes the known job before the request.
- `src/ts/process/index.svelte.ts:136-163` returns after aborting an activity
  controller and reaches the job-store fallback only when no activity exists.
- `src/ts/process/request/serverChat.ts:493-548` installs durable cancellation
  only after the initial response opens.

### Implementation boundary

The known `reattachJobId` must be cancellable from the moment the activity is
visible. Either bind it directly to the activity/controller or retain it until
the request layer takes ownership. Cancellation must be idempotent.

### Acceptance criteria

- Stop before, during, or after reattach response opening sends exactly one
  cancellation for the known job.
- The cancelled job is not restored for retry.
- Stopping Chat A cannot cancel Chat B's reattach or generation.
- A network disconnect without explicit Stop still detaches rather than
  cancelling durable work.

### Required tests

- Add a deferred-`openChatResponse` test and abort before it resolves.
- Assert one cancellation call with the exact job ID.
- Cover two concurrent chats and disconnect-versus-explicit-abort behavior.

---

## MTC-06 — Scope Draft/BTW hook activity and cancellation by chat

**Priority:** P2
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —
**Decision (2026-08-10):** Concurrent hooks across chats are allowed, keyed
the same way as the chat-keyed generation registry (one shared mental model:
each chat owns its own activity). Per-chat mutual exclusion is retained — one
hook per chat at a time. A cross-chat gate would reintroduce the aggregate-lock
pattern MTC-10 removes, and would not avoid the hard work anyway: stale-result
and cleanup-ordering races exist even with a single hook.

### Problem

Message-generation ownership is chat-keyed, but `doingDraftHook`,
`doingBtwHook`, the hook stage, and fallback abort-controller selection remain
global. A hook running in Chat A therefore replaces Chat B's Send button with
Chat A's Stop control. Stop can cancel A, and keyboard submission can start an
overlapping hook whose cleanup corrupts the shared state.

### Reproduction

1. Start a slow Draft or BTW hook in Chat A.
2. Open Chat B.
3. Observe Chat B show the hook stage and cancel control instead of Send.
4. Press Stop, or submit through the composer keyboard shortcut.

### Evidence

- `src/lib/ChatScreens/DefaultChatScreen.svelte:324-351` combines chat-scoped
  generation state with global hook booleans/stage.
- `DefaultChatScreen.svelte:1304-1395` sets and clears unscoped hook state.
- `DefaultChatScreen.svelte:2197-2201` permits keyboard send.
- `DefaultChatScreen.svelte:2226-2234` renders Stop for any active hook.
- `src/ts/process/index.svelte.ts:145-153` aborts the most recent unbound
  controller rather than one owned by the open chat.

### Implementation boundary

Define a chat-keyed input-hook activity contract, including stage, controller,
hook kind, and composer-operation ownership. Different chats may run hooks
concurrently; within one chat, at most one hook runs at a time. UI and
cancellation must remain target-safe under concurrency.

### Acceptance criteria

- Chat A's hook never changes Chat B's composer controls or stage.
- Stop cancels only the open chat's visible operation.
- Concurrent hooks in different chats cannot clear each other's state.
- Stale hook results still cannot overwrite a newer chat/draft.

### Required tests

- Extend `DefaultChatScreen.loadPages.test.ts` with navigation during a pending
  hook and assert Chat B controls.
- Cover cancellation ownership for two hook targets.
- Cover cleanup ordering when two hooks resolve in reverse order.
- Cover keyboard send while another chat owns a hook.

---

## MTC-07 — Make reroll candidates chat-scoped

**Priority:** P2
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

`rerolls`, `rerollid`, and last-scope metadata are module singletons. Opening
Chat B and starting a send clears Chat A's candidate buffer. Background
alternates are seeded only when their chat is active, and reopening an already
hydrated chat can skip the fetch that would rebuild them.

### Reproduction

1. Generate or hydrate multiple reroll candidates in Chat A.
2. Open Chat B and send a message.
3. Return to Chat A and open the reroll list.
4. Observe that A's candidates were cleared/replaced or are unavailable.

### Evidence

- `src/ts/process/rerollNavigation.svelte.ts:29-33` owns one global buffer.
- `rerollNavigation.svelte.ts:126-153` clears and records into that buffer.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:1424` resets it at send start.
- `src/ts/process/serverBackedSendChat.ts:899-925` seeds provider alternates
  only for the active chat.
- `src/ts/server/chatMessageHydration.svelte.ts:503-540` can no-op for an
  already resident chat.

### Implementation boundary

Store reroll state by stable character/chat identity or deterministically
derive it from persisted alternates when a chat becomes active. Do not allow a
completion in one chat to mutate another chat's active candidate index.

### Acceptance criteria

- Chat A's candidate list and active index survive sends/completions in Chat B.
- Background alternates become available when their chat is opened.
- Clearing the confirm boundary affects only its target chat.
- Reload/hydration behavior remains durable and candidate ordering remains
  stable.

### Required tests

- Add cross-chat buffer preservation tests to `rerollNavigation.test.ts`.
- Cover background completion followed by return to an already hydrated chat.
- Add or extend the reroll list DOM test to verify candidate ownership.

---

## MTC-08 — Make live generation progress chat-scoped

**Priority:** P2
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

Agent Preset progress, post-generation progress, and half-streaming throughput
each expose one writable singleton. Starting Chat B replaces Chat A's active
session. Later A events are ignored or replace B's throughput sample, so the
visible progress disappears or flickers as the user switches chats.

### Reproduction

1. Start a generation with progress events in Chat A.
2. Start a second generation in Chat B.
3. Alternate events from A and B while navigating between them.
4. Observe missing Agent/PostGen progress and half-streaming throughput
   switching ownership based on the most recent frame.

### Evidence

- `src/ts/process/agentPresetProgress.ts:15-33` has one `activeSession`; a new
  session clears the prior store and prior events are ignored.
- `src/ts/process/postGenerationProgress.ts:21-44` has the same singleton model.
- `src/ts/process/halfStreamingProgress.ts:23-63` replaces the active target
  whenever another target records a token.
- `src/ts/process/request/serverChat.ts:483-492` starts these sessions for every
  concurrent request.
- The UI filters the one value by active chat rather than reading a per-chat
  collection.

### Implementation boundary

Use stable target/generation keys and independent session cleanup. Preserve a
small bounded collection and remove terminal entries without clearing other
chats.

### Acceptance criteria

- Concurrent A/B progress events remain independent.
- Opening either chat immediately shows its current stage/throughput.
- Finishing or failing one session does not clear the other.
- Stale events cannot revive a completed generation.

### Required tests

- Add simultaneous A/B sessions to `agentPresetProgress.test.ts`.
- Add equivalent post-generation progress coverage.
- Interleave half-streaming frames from two chats and assert both projections.
- Add a rendered active-chat switching assertion for each progress component.

---

## MTC-09 — Generate suggestions after background completion

**Priority:** P2
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

Automatic suggestions are requested on the visible chat's generation
active-to-idle transition. If Chat A completes while Chat B is open, the
component observes no transition for A. Returning to an already resident A also
does not meet the hydration-completed special case, so suggestions remain empty
until another generation or manual reroll.

### Reproduction

1. Enable automatic suggestions.
2. Start generation in Chat A and open Chat B.
3. Let A complete in the background.
4. Return to A and observe that no suggestions were requested.

### Evidence

- `src/lib/ChatScreens/Suggestion.svelte:465-470` reacts only when the effective
  boolean changes.
- `Suggestion.svelte:330-340` requests on the false transition.
- `Suggestion.svelte:507-530` requests on hydration only for the same observed
  transcript owner moving from zero to resident messages.

### Implementation boundary

Observe completion by stable chat identity or mark the chat as needing
suggestions and consume that marker when it becomes active. Deduplicate against
persisted suggestions and in-flight requests.

### Acceptance criteria

- A background-completed chat requests suggestions exactly once when eligible.
- Returning to the chat shows persisted or newly generated suggestions.
- Chat B's suggestions and requests are unaffected.
- Navigation and hydration races cannot persist suggestions to the wrong chat.

### Required tests

- Add an A-generates/B-visible/A-completes/return-to-A test to
  `Suggestion.svelte.test.ts`.
- Cover an already resident transcript and a shell that hydrates on return.
- Cover existing persisted suggestions and ensure no duplicate request.

---

## MTC-10 — Remove aggregate `doingChat` locks from cross-chat-safe features

**Priority:** P2
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

`doingChat` is now an aggregate compatibility projection that is true when any
chat generates. Several unchanged consumers still use it as a global lock.
Consequently, while Chat A generates, Chat B can send normally but non-cached
HTML translation silently returns its source text, and hotkey/DevTool previews
and DevTool autopilot return without running.

### Reproduction

1. Start generation in Chat A and open Chat B.
2. Request an uncached translation in B; observe the original HTML returned.
3. Invoke prompt preview or DevTool preview/autopilot; observe an immediate
   no-op despite B having no generation.

### Evidence

- `src/ts/process/index.svelte.ts:168-175` sets `doingChat` from aggregate
  activity count.
- `src/ts/translator/translator.ts:858-865` returns source HTML when it is true.
- `src/ts/hotkey.ts:207-216` blocks prompt preview globally.
- `src/lib/SideBars/DevTool.svelte:37-45` and `:234-265` block preview and
  autopilot globally.

### Implementation boundary

Replace global gates with stable target ownership where the operation is safe
across chats. Retain same-chat mutual exclusion. Decided 2026-08-10: do not
add a provider capacity policy — no designed throttle exists; the aggregate
lock was incidental UI state. If provider rate-limiting becomes a measured
problem, add a documented concurrency limit at the request layer then.

### Acceptance criteria

- Translation and supported preview/autopilot work in idle Chat B while A runs.
- Same-chat conflicting operations remain blocked.
- Operations cannot adopt a newly opened chat after an await.
- No compatibility-only `doingChat` consumer controls chat-specific UI behavior.

### Required tests

- Add a cross-chat translation test with an uncached LLM translation.
- Add hotkey and DevTool tests for A-active/B-idle and A-active/A-active cases.
- Re-run `rg` for runtime `doingChat` consumers and document any intentionally
  aggregate use.

---

## MTC-11 — Use stable IDs for asynchronous finalization and error writes

**Priority:** P2
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

Some stage-4 finalization, inlay, and error paths retain numeric character/chat
indexes captured before asynchronous work. Multitasking now permits navigation,
reordering, insertion, and deletion while generation runs. If indexes move,
completion metadata or an error row can be written to the wrong chat.

### Reproduction

1. Start generation in Chat A.
2. While it runs, reorder/delete chats or characters so the captured numeric
   slot points elsewhere.
3. Let stage 4 or the error path finish.
4. Inspect the newly occupying row for misplaced generation metadata/error text.

### Evidence

- `src/ts/process/postGeneration/runStage4.ts:60-70` forwards captured indexes.
- `src/ts/process/postGeneration/stage4Finalize.ts:22-37` writes through those
  indexes.
- `src/ts/process/postGeneration/orchestrateResponse.ts:149-162` contains an
  additional post-await indexed write.
- `src/ts/process/sendChatErrors.ts:23-60` resolves the error target by captured
  indexes.

### Implementation boundary

Resolve character, chat, and message by stable IDs at the mutation boundary and
fail safely if the original target no longer exists. Do not fall back to the
current selection or the row now occupying an old index.

### Acceptance criteria

- Reordering cannot redirect finalization or error writes.
- Deleting the target causes a safe no-op/recovery path, never a write elsewhere.
- Normal navigation without reordering still completes in the background.
- Server-persisted terminal rows and client metadata agree on identity.

### Required tests

- Add reorder, insertion, and deletion during deferred finalization.
- Add a deferred error-path test with index reuse.
- Assert the original stable message ID is the only eligible write target.

---

## MTC-12 — Keep preview results owned by their original chat

**Priority:** P2
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

Freshness checks after context/settings/persona maintenance were removed so
background sends can continue. Prompt previews share the same coordinator but
write to global `previewBody` and `previewFormated`. If navigation occurs while
preview maintenance is pending, Chat A's preview can be presented after Chat B
has become active.

### Reproduction

1. Start prompt preview in Chat A.
2. Delay context persistence or settings/persona maintenance.
3. Navigate to Chat B using browser navigation or another route source.
4. Release the delay and observe A's preview adopted as the current global
   preview result.

### Evidence

- `src/ts/process/index.svelte.ts:273-305` awaits maintenance without a later
  target-freshness check.
- `src/ts/process/index.svelte.ts:412-415` assigns global preview results.
- Existing preview tests cover standalone success, not navigation during
  maintenance.

### Implementation boundary

Decided 2026-08-10: discard the stale preview. Capture the target at start,
compare at presentation time, and drop the result on mismatch — preview is an
ephemeral inspection tool that is cheap to re-run, so per-chat storage is not
worth the added state. Do not reintroduce a global block that prevents
unrelated message generations.

### Acceptance criteria

- Chat A's delayed preview is never presented as Chat B's result.
- Navigation discards a pending preview result whose target no longer matches.
- Normal background message generation remains unaffected.

### Required tests

- Add delayed maintenance plus navigation cases to
  `sendChat.serverPreview.test.ts`.
- Cover both formatted-prompt and raw-body preview modes.

---

## MTC-13 — Prevent generation indicators from intercepting avatar clicks

**Priority:** P3
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

`GenerationIndicator` is an absolutely positioned sibling over the top-right of
character and pinned-chat avatars. It accepts pointer events but has no click
handler, so clicks on the badge area do not activate the avatar underneath.

### Evidence

- `src/lib/SideBars/GenerationIndicator.svelte:11-18` has no
  `pointer-events-none` behavior.
- `src/lib/SideBars/PinnedChatsRail.svelte:42-54` overlays it on the clickable
  avatar.
- `src/lib/SideBars/Sidebar.svelte:758-762` uses the same overlay for characters.

### Acceptance criteria

- Clicking anywhere in the avatar, including under the badge, activates the
  character or pinned chat exactly once.
- The indicator retains its status semantics and tooltip.

### Required tests

- Add DOM click tests for character and pinned-chat avatars at the indicator
  target.

---

## MTC-14 — Make the pinned rail inert with the narrow menu

**Priority:** P3
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

When the narrow hamburger menu is open, character controls become inert but the
pinned rail is mounted outside that inert container. Pinned chats remain
tabbable and clickable behind the menu overlay.

### Evidence

- `src/lib/SideBars/Sidebar.svelte:659-663` mounts `PinnedChatsRail` before the
  element receiving `inert={menuMode === 1}`.
- Existing sidebar keyboard tests assert inertness only for character controls.

### Acceptance criteria

- Pinned chat controls cannot receive focus or activation while the menu owns
  the narrow sidebar.
- They become operable again when the menu closes.

### Required tests

- Extend `Sidebar.keyboard.dom.test.ts` with mounted pinned chats and assert
  focus/activation before, during, and after menu mode.

---

## MTC-15 — Expose active pinned-chat state

**Priority:** P3
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

Pinned chat shortcuts have no current-route comparison, selected styling, or
`aria-current`. When multiple chats are pinned, the user cannot tell which
shortcut represents the open chat visually or semantically.

### Evidence

- `src/lib/SideBars/PinnedChatsRail.svelte:41-54` passes only name and click
  behavior to each avatar.
- `src/lib/SideBars/SidebarAvatar.svelte:37-53` exposes a generic button role
  without an active-state contract.

### Acceptance criteria

- Exactly one matching pinned entry exposes current state when its chat is open.
- Current state is visible and represented with appropriate accessibility
  semantics.
- Character-only and non-chat routes expose no false current entry.

### Required tests

- Add a `PinnedChatsRail` DOM/accessibility test covering route changes between
  two pinned chats.

---

## MTC-16 — Localize the unnamed pinned-chat fallback

**Priority:** P3
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

An unnamed pinned chat is displayed as hard-coded English `Chat`, bypassing the
language packs.

### Evidence

- `src/lib/SideBars/sidebarMultitasking.ts:56-69` uses
  `chat.name || 'Chat'`.

### Acceptance criteria

- The fallback comes from `src/lang` and renders in the selected language.
- Whitespace-only names follow the same documented normalization policy as the
  regular chat list.

### Required tests

- Update `sidebarMultitasking.test.ts` for empty and whitespace-only names.
- Add language-pack assertions for English and Korean keys.

---

## MTC-17 — Canonicalize missing-character routes after multitasking navigation

**Priority:** P3
**Status:** Ready
**Owner:** Unassigned
**Resolution:** —

### Problem

Navigation is now accepted during active generation. A route for a missing or
deleted character clears selection but leaves the stale character URL in the
browser, unlike the existing missing-chat canonicalization path.

### Reproduction

1. Start a generation and navigate to `/character/deleted-id/deleted-chat`.
2. Observe the chat selection clear while the browser remains on the stale URL.

### Evidence

- `src/ts/router.ts:218-223` accepts the requested path during generation.
- `src/ts/router.ts:635-639` clears stores for a missing character without
  committing a canonical route.
- Router coverage handles a missing chat under an existing character but not a
  missing character.

### Acceptance criteria

- Missing-character routes canonicalize to the documented safe route.
- Canonicalization does not stop or retarget background generation.
- Browser history and selected stores remain consistent.

### Required tests

- Extend `src/ts/router.test.ts` with missing-character navigation during an
  active generation and back/forward history assertions.

---

## Audit validation baseline

The audit was performed with a clean worktree. At the time of verification:

- `pnpm check` completed with zero errors and warnings.
- Twelve focused frontend test files passed: 413 tests.
- Two focused Fastify test files passed: 258 tests.
- `git diff --check HEAD~4..HEAD` passed.

These results do not invalidate the findings. Most existing tests exercise one
chat at a time, switch chats only after generation has already started, or test
global stores without concurrent sessions. Each work item therefore requires a
targeted regression that owns its specific asynchronous interleaving.

## Resolution log

Record completed items here as they land.

| ID | Commit | Regression tests | Notes |
| --- | --- | --- | --- |
