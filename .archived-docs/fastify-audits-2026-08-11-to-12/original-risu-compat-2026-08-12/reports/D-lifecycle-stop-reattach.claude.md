# Brief D — Generation lifecycle: Stop, cancel, retry, reattach (CLAUDE track)

Audit of `f2dc174f4..HEAD` against fork point `71c476e9c`
(baseline worktree `/home/codex/risu-baseline-71c476e9c`).
Scope per brief: user-observable lifecycle outcomes — Stop end states per
phase, retry behavior/confirmations, reload/restart leftovers, reattach
outcomes. CA-OR-3 (cancel persists raw text) and CA-OR-4 (post-token failure
restore) are treated as adjudicated and only their *new* wave-4/5 layers are
reported.

## Baseline lifecycle model (established for all findings)

At the fork point the whole lifecycle is client-local and synchronous:

- Stop is `abortController.abort()` wired directly to the button —
  `/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:330-334`,
  button always enabled at `:661`. Stop cannot fail, has no pending state,
  and never requires further interaction.
- The user row is pushed synchronously before the request
  (`DefaultChatScreen.svelte:191-206`) and no code path ever removes it.
- Streaming: an empty `char` row is pushed as soon as the stream response
  opens (`src/ts/process/index.svelte.ts:1540-1548`); abort cancels the
  reader and returns `false` with the row (and whatever per-chunk
  `editoutput`-processed text it accumulated) left in the transcript
  (`:1553-1601`). Nothing removes an empty row.
- Pre-response abort: `requestChatData` returns `{type:'fail', result:'Aborted'}`
  (`src/ts/process/request/request.ts:232-237`, `:274-279`) but the
  `abortSignal.aborted` check at `index.svelte.ts:1524-1526` returns `false`
  *before* the fail branch, so an aborted buffered/pre-response send is
  silent: no row, no error.
- Abort in the post-stream window (after the read loop, before `:1599`)
  keeps the full streamed text but silently skips rerolls (`:1603`), the
  output trigger (`:1607`), inlay (`:1614`) and TTS (`:1622`).
- Context overflow is trimmed silently (`index.svelte.ts:1080-1088`,
  `[Start a new chat]` marker at `:776-782`); no confirmation of any kind
  exists anywhere in the send/stop/retry loop.

## Findings

### D-1 — Stop on a durable send is an acknowledged, failable server lifecycle instead of the fork's instant client abort (med)

**Current:** For protocol sends, `abortActiveGeneration()` no longer aborts
the local controller at all — it routes exclusively through
`stopGenerationOperation`
(`src/ts/process/generationStop.svelte.ts:14-26`; the local-abort branch was
deleted by `0692762b9`, see the removed block in
`src/ts/process/index.svelte.ts` in that commit's diff). The Stop flow is:
stage a durable cancel intent (`stop_staging`), detach the SSE viewer only
after staging (`src/ts/server/generationOperations.ts:1245-1255`), PUT the
cancellation with a 10s deadline (`:48`, `:1105-1168`), then reconcile with
backoff polls of 250ms–5s (`:49`, `:1024-1042`) until the operation is
terminally cancelled. UI: the composer button shows "Stopping…" and is
disabled while pending or finalizing
(`src/lib/ChatScreens/DefaultChatScreen.svelte:2562-2581`), and a failed
acknowledgement renders a red "Stop could not be acknowledged. The
generation may still be running." panel with **Retry Stop** / **Refresh**
buttons (`DefaultChatScreen.svelte:2366-2392`,
`src/lang/en.ts:95-100`). Server ack dispositions in
`server/fastify/src/routes/generationChat.ts:5284-5320` (202 `cancelling`,
wave 4). If the cancel PUT cannot reach the server (offline, writer-stale,
timeout), the state is `stop_failed` and the generation genuinely keeps
running server-side until Retry/Refresh or a wake event succeeds
(`generationOperations.ts:1296-1345`).

**Baseline:** `DefaultChatScreen.svelte:330-334` + `index.svelte.ts:1553-1558`
— Stop is synchronous, infallible, always enabled, freezes the stream in the
same tick, and never presents follow-up UI.

**User-visible consequence / repro:** Send a message on any streaming
provider, click Stop mid-stream. Current: tokens can continue to render
until the intent finishes staging, then the button flips to a disabled
"Stopping…" until the server acknowledges; with the server unreachable the
user gets a failure panel and two new buttons where the fork had a
guaranteed instant stop. Repro of the failure arm: kill the Fastify process
(or drop the network) between `job_accepted` and clicking Stop.

**Charter:** `decide` (recommend `keep` for the acknowledged core — a
client-local abort cannot stop a server-owned durable job, and the protocol
is additive infrastructure — but the Stopping…/disabled-button/Retry-Stop
surfaces are new user-visible lifecycle UI at surface 5 and need explicit
sign-off). **Confidence:** high (code-traced both sides; smoke-matrix
journeys "acknowledged Stop desktop/mobile" exercise it,
`server/fastify/browser-smoke/acceptedSendProtocol.spec.ts`).

### D-2 — Stop before server acceptance rolls the user's own message back out of the transcript (med)

**Current:** An accepted send optimistically appends the user row at staging
time (`src/ts/server/generationOperations.ts:416-467`, append at `:453`).
A Stop that lands before the submit is accepted — reachable from the normal
composer Stop button, because the staged operation is discoverable via the
`state === 'none'` cancellation record
(`generationOperations.ts:322-333`; Stop button shown for it via
`DefaultChatScreen.svelte:424`) — produces the server tombstone disposition
`cancelled_before_acceptance`
(`server/fastify/src/routes/generationOperations.ts:731`, `:739`), and the
client then **rolls back the optimistic user message**
(`generationOperations.ts:1084-1091`; also on rejected submit replay at
`:1456-1459`). The composer draft is not lost (it is only cleared on
acceptance, `acceptedSendCoordinator.svelte.ts:354-358` →
`DefaultChatScreen.svelte:995-1002`), and the submit-rejected arm can
additionally surface the "queued message was not accepted" toast
(`coordinateAtomicAcceptedChatSend` → `notifyAppendFailed`,
`acceptedSendCoordinator.svelte.ts:354-356`; string at
`src/lang/en.ts:81`) even though the user themself initiated the Stop.

**Baseline:** the user row is pushed before the request and survives every
abort path unconditionally
(`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:191-206`;
abort paths in `index.svelte.ts:1524-1601` never touch it).

**User-visible consequence / repro:** Go offline (or throttle so the submit
POST is in flight), hit Send — the message appears in the transcript — then
hit Stop. After the cancel intent replays (it is replayed with priority
before the submit, per wave 4), the user's message disappears from the
transcript; at the fork point the message always stayed and only the reply
was aborted. A fast double-click Send→Stop online can hit the same window.

**Charter:** `decide` — genuine transcript-content divergence at surface 1
with a real tradeoff ("Stop = never sent" vs the fork's "Stop = keep my
message, kill the reply"). An alternative that matches the fork is to keep
the accepted row and cancel only the generation. Introduced by `0692762b9`.
**Confidence:** high on the mechanism (code-traced end to end); medium on
how often real users hit the window online (offline/reload path is
deterministic).

### D-3 — Sends that would trim context now block on a confirmation dialog the fork never showed (med)

**Current:** When the prompt budget would drop older chat rows and Hypa
memory is not enabled for the chat, the server refuses the generation with
`HYPA_CONTEXT_TRUNCATION_CONFIRMATION_REQUIRED`
(`server/fastify/src/routes/generationChat.ts:1049-1052`, `:1363-1380`;
`server/fastify/src/prompt/budgetFinalize.ts`) and the client raises a
blocking `alertConfirm` — "Older messages may be omitted … Continue without
Hypa Memory?" — before acknowledging per-chat and retrying
(`src/ts/process/serverBackedSendChat.ts:488-512`,
`src/lang/en.ts:26-27`). Declining aborts the send.

**Baseline:** context over budget is trimmed silently in the assembly loop
(`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1080-1088`);
no dialog exists.

**User-visible consequence / repro:** Any migrating user with a long chat
and no Hypa memory clicks Send: current interposes a modal question (once
per chat, persisted via `hypaContextTruncationAcknowledged`) where the fork
proceeded silently. This is exactly the brief's "flow now requires user
interaction where the fork point silently proceeded". Introduced in-delta by
`656be4b1e` (2026-08-08).

**Charter:** `decide` — deliberate product feature, but under the 2026-08-12
bar a new blocking interaction on the primary send path needs individual
maintainer sign-off (and it is not recorded in ADJUDICATION.md).
**Confidence:** high.

### D-4 — Stop during finalization: completion can now win over Stop, and the fork's "keep text, skip post-effects" window is gone (low)

**Current:** A Stop that lands while the operation is `finalizing` is
acknowledged as `completion_finalizing` or `cancelled_finalizing`
(`server/fastify/src/routes/generationOperations.ts:789`;
`server/fastify/src/routes/generationChat.ts:5282-5296` for the job route)
— it does not stop anything. On completion-won, the *full* reply plus the
complete server-side post-generation pass (editoutput, output trigger,
run-vars, persistence) lands, and the UI shows a "reply is waiting to be
saved" banner (`DefaultChatScreen.svelte:2400-2406`); on cancelled-partial
finalization the UI shows "Stopped. Saving the partial reply…"
(`:2393-2399`) and the partial save can itself fail loudly
(`generation_cancel_persistence_failed` error frame,
`server/fastify/src/routes/generationChat.ts:4784-4796`). The Stop button is
disabled throughout `stopped_finalizing` (`DefaultChatScreen.svelte:2568`).

**Baseline:** an abort in the equivalent window (after the last chunk,
before the `:1599` check) kept the full streamed text but silently skipped
rerolls/output trigger/inlay/TTS
(`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1599-1624`);
past the check, abort was simply ignored. Neither retention nor saving could
ever fail (the text was already in the local DB), and no interim banners
existed.

**User-visible consequence / repro:** Click Stop within the finalization
window (deterministic with the smoke-matrix fault seams; in production a
slow SQLite write). Current: transcript ends with the fully processed reply
(output trigger *ran*) plus a status banner; fork: raw-ish full text with
post-effects skipped and no banner. Script-visible state (output trigger,
run-vars) differs from the fork's abort-in-window outcome.

**Charter:** `keep` (recommended) — the fork behavior in this window was a
race artifact; current is strictly more consistent and truthfully labeled.
Layered by `0692762b9`/`317c0d2ea`, so it is a new delta on the adjudicated
CA-OR-3 surface and is listed for completeness. **Confidence:** high.

### D-5 — Failed sends leave a persistent in-transcript recovery banner with "Retry reply" instead of only the fork's transient error (low)

**Current:** When an accepted send's generation fails to start (or the
authority probe cannot confirm completion), the coordinator records a
recovery (`acceptedSendCoordinator.svelte.ts:239-252`) and the chat renders
a persistent red banner — "Your message was saved, but its reply could not
be started. Retry without sending the message again." — with a **Retry
reply** button (`DefaultChatScreen.svelte:2459-2487`,
`src/lang/en.ts:83-94`), in addition to the immediate error report from
`sendChat` itself. The banner also survives reloads via the durable
operation projection (`acceptedSendRecoveryState.ts:158-249`).

**Baseline:** a failed send produced one transient `throwError` alert
(`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1527-1529`);
the retry affordance was implicit (press Send again with an empty composer —
`DefaultChatScreen.svelte:170-181` skips appending when the tail is already
a user row).

**User-visible consequence / repro:** point the profile at an unreachable
provider and send: current shows the error *and* a persistent banner+button;
fork showed only the error. Transcript content is identical (user row kept
on both sides). Introduced by wave 3 `8c822bf35` (in-delta).

**Charter:** `keep` (recommended) — additive failure-path UI; transcript
parity holds. **Confidence:** high.

### D-6 — Server restart/shutdown marks operations `abandoned` and recovery adds a billing-aware retry confirmation (low)

**Current:** Shutdown transitions running operations to `abandoned`
(`server/fastify/src/app.ts:281-309`) and the boot sweep does the same for
stale rows (`server/fastify/src/generationOperations.ts:1234-1290`). The
client renders "Your message was saved, but its reply was interrupted by a
server restart. You can retry the reply." with a Retry button
(`DefaultChatScreen.svelte:2467-2475`, `src/lang/en.ts:88-91`); when
`providerMayHaveRun` is set, Retry first asks "…Retrying may create another
billed request. Retry anyway?" via `alertConfirm`
(`src/ts/process/acceptedSendCoordinator.svelte.ts:459-463`).

**Baseline:** no server exists; a mid-generation interruption (browser
death) silently lost the request, and re-sending was fully manual with no
dialogs (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:136-215`).

**User-visible consequence / repro:** restart Fastify mid-generation, reload
the client: a recovery chip and (when the provider call had started) a
billing confirm appear — interactions with no fork counterpart, in a
scenario the fork could not survive at all.

**Charter:** `keep` (recommended) — additive recovery per the charter's
additive-abilities carve-out; the confirmation only gates the *extra*
ability and never fires on an ordinary send. Transcript side effects of a
confirmed retry equal a fresh fork-point send. Listed because the brief
asks the interaction question explicitly. **Confidence:** high.

## Pre-delta observation (out of delta scope, flagged for the Stage-4 ledger)

- **Pre-token Stop row presence.** Fork: Stop between stream-open and the
  first token leaves a permanent *empty* assistant bubble
  (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1540-1548`
  push; no removal on abort `:1599-1601`). Current: the empty placeholder is
  explicitly removed (`src/ts/process/postGeneration/streamResponse.ts:266-275`,
  `:334-338`) and a zero-token cancel persists nothing
  (`server/fastify/src/routes/generationChat.ts:4716` guard,
  `:4253-4260` doc comment — non-streaming cancel likewise persists
  nothing, matching the fork's silent no-row abort at `index.svelte.ts:1524-1526`).
  Both current behaviors predate the delta (`761639c8f`, `dbe560bf8`,
  `75090363f` — all ancestors of `f2dc174f4`) and are adjacent to, but not
  explicitly covered by, the CA-OR-3 adjudication (which is about text
  processing, not row presence). Not re-reported as a delta finding.

## Areas swept and found clean

- **Reattach row identity / duplication.** A replayed stream reuses the
  existing generation row by `generationId` instead of appending a second
  one (`src/ts/process/postGeneration/streamResponse.ts:140-150`); continue
  replays extend the continue row, regenerate targets its slot via the
  operation's mode/targetMessageId (`src/ts/process/reattach.ts:169-192`,
  `:546-559`). No duplicate-row path found; the 8-journey production matrix
  asserts authoritative transcripts (`server/fastify/browser-smoke/acceptedSendProtocol.spec.ts`,
  `e96a0f792`).
- **Replayed side effects.** Completion sound, IGP and TTS are routed
  through the idempotent effect ledger (`src/ts/process/index.svelte.ts:603-616`,
  `:665-669`; `src/ts/process/serverBackedSendChat.ts:888-902`; wave
  `1dd9f9123`), so a reattached/recovered terminal does not re-fire them.
- **Stale-observer resurrection.** Epoch-fenced projections and the
  authority tuple (projectionEpoch, stateVersion, attemptNo, jobId) drop
  lower-epoch applications atomically (`src/ts/process/reattach.ts:208-238`,
  `:425-454`); 409 `stale_generation_attempt` reconnects boundedly (≤3) to
  the current attempt only (`src/ts/process/request/serverChat.ts:453-463`).
  No path found that re-displays cancelled text after its terminal.
- **Cancel transcript content vs adjudication.** Wave 4 changed only the
  acknowledgement wrapper; the cancel persist itself is unchanged raw-partial
  (`persistRawCancelledResult`, `server/fastify/src/routes/generationChat.ts:4261-4312`,
  pre-delta `75090363f`) — no *new* transcript-content delta layered on
  CA-OR-3.
- **Continue/regenerate Stop.** Non-protocol durable jobs keep the near-fork
  behavior: immediate local controller abort plus a typed job-ID DELETE
  (`src/ts/process/generationStop.svelte.ts:23-26`,
  `src/ts/process/request/serverChat.ts:697-701`); the acknowledged
  lifecycle applies only to protocol `send` operations.
- **Send availability after Stop.** The composer releases the generation
  claim at `stopped_finalizing`/settled states
  (`DefaultChatScreen.svelte:412-428`) and the server clears the per-chat
  submission lock at cancel (`server/fastify/src/routes/generationChat.ts:4880-4883`),
  so a new send is possible about as promptly as the fork's post-abort state.
- **Reload mid-generation leftovers.** Fork left an orphaned processed
  partial (whatever autosave caught); current either resumes the live stream
  or persists the complete reply with full server-side post-gen — the final
  transcript equals an uninterrupted session, which is the charter's
  additive-recovery requirement. Error display parity on failed starts is
  immediate on both sides (`reportSendChatError` fires inside `sendChat`;
  the ≤10s authority probe delays only the recovery banner,
  `acceptedSendCoordinator.svelte.ts:80`, `:202-237`).
- **Stop error display.** Fork streaming/pre-response aborts were silent
  (checked order at baseline `index.svelte.ts:1524`, `:1599`); current
  acknowledged cancels are likewise silent on success (done-frame
  `outcome:'cancelled'`, no error toast) — parity holds.

## Could not verify

- **Physical mobile devices.** The matrix runs Pixel-7 emulation only; the
  memory notes a physical-device pass is still the open closure condition.
- **Legacy (non-protocol) recovery double-generation corner.** The legacy
  branch of `retryAcceptedChatSend` runs `attemptGeneration` *before* a
  fresh authority probe (`src/ts/process/acceptedSendCoordinator.svelte.ts:486-507`);
  if a reply had actually completed but the client's projection was stale, a
  Retry could start a second generation for the same user row (fork
  equivalent: pressing Send twice — but fork never offered the button).
  Needs a live repro against a stale-bootstrap fixture; flagged for Stage 4.
- **`stop_failed` × `retryable` UI overlap.** `refreshGenerationOperationCancellation`
  reports `stop_failed` while the operation is `retryable`/`abandoned`
  (`src/ts/server/generationOperations.ts:1324-1341`), so a "Stop could not
  be acknowledged — may still be running" panel and a "reply could not be
  started — Retry" banner can coexist for a settled generation. Both states
  are truthful individually; whether the combination renders simultaneously
  in the live DOM was not driven in a browser this session.
- **Offline replay ordering end-to-end.** The cancel-before-submit priority
  replay (wave 4) was verified in code and unit tests
  (`src/ts/server/pendingMutationReplay.test.ts` additions in `0692762b9`)
  but not re-driven live in this session; D-2's offline repro relies on it.
