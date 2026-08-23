# CODEX track — lifecycle, Stop, retry, and reattach compatibility

Audit basis: current `HEAD` versus fork-point worktree `71c476e9c`, limited to user-visible lifecycle outcomes in Brief D. This is a static source audit; existing tests were inspected as evidence, but no test suite was run because the brief permits writes only to this report.

## D-1 — Retrying an interrupted accepted send can append and transform the user turn a second time

**Severity:** high

**Current behavior.** An operation retry reloads the original stored intent (`server/fastify/src/routes/generationOperations.ts:858-886`) and, for a send, validates only that the current tail has the accepted message ID and the `user` role—not that its data still equals the raw submitted text (`server/fastify/src/routes/generationOperations.ts:887-893`). The reconstructed assembly input consequently contains the original raw `intent.message.data` (`server/fastify/src/routes/generationOperations.ts:455-474`). Prompt assembly always runs the input trigger, appends/deduplicates the user row, and runs `editinput` again (`server/fastify/src/prompt/assemble.ts:2437-2449`). Deduplication is by raw data and null name, not by `acceptedMessageId` (`server/fastify/src/prompt/assemble.ts:1022-1068`); after the first attempt persisted an `editinput` rewrite, the transformed tail no longer matches the raw input, so retry appends a second user row. The new row is transformed again (`server/fastify/src/prompt/assemble.ts:1214-1255`), and the resulting replacement is persisted (`server/fastify/src/routes/generationChat.ts:1525-1527`, `server/fastify/src/routes/generationChat.ts:1548-1604`). The input trigger also sees the already-transformed first row as history because its exclusion check is likewise raw-data based (`server/fastify/src/prompt/assemble.ts:1088-1103`), so trigger-visible effects can repeat.

**Baseline behavior.** Original Risu runs the input trigger, appends exactly one user row, and applies `editinput` once in the submit handler (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:183-213`). Its provider retry loop clones the already-assembled prompt (`/home/codex/risu-baseline-71c476e9c/src/ts/process/request/request.ts:217-224`) and repeats only request-trigger/provider work (`/home/codex/risu-baseline-71c476e9c/src/ts/process/request/request.ts:230-337`); it does not return to submit-time input hooks or append another transcript row.

**Consequence and repro.** Configure `editinput` so `hello` becomes `[edited] hello`. Send `hello`, then restart Fastify after submit assembly has persisted the rewrite and provider dispatch has begun but before a terminal result. Choose **Retry reply** on the abandoned operation. Current HEAD passes the tail-ID check, assembles from raw `hello`, and persists two consecutive transformed user rows before the reply; the baseline retry path leaves one transformed user row and retries only the request. Input-trigger variable or transcript effects may also execute twice.

**Charter classification:** `fix` — key retry idempotency to the accepted message identity and do not rerun already-committed submit transforms.

**Confidence:** high.

## D-2 — A settled Stop can hide the Stop control for a later live Continue or Regenerate

**Severity:** high

**Current behavior.** Once a protocol Stop settles, its cancellation control is retained as `settled_cancelled`/`settled_completed` rather than removed (`src/ts/server/generationOperations.ts:652-712`). The chat screen selects the last cancellation control for the chat without relating it to the currently active generation (`src/lib/ChatScreens/DefaultChatScreen.svelte:392-395`). A settled control makes `currentChatCancellationReleasesGenerationClaim` true, and that condition overrides both a live chat activity and a live job when computing `currentChatOwnsGeneration` (`src/lib/ChatScreens/DefaultChatScreen.svelte:412-428`); the Stop button is rendered only when that ownership flag is true (`src/lib/ChatScreens/DefaultChatScreen.svelte:2559-2582`). This is exposed by Continue/Regenerate because the compatibility durable route creates a protocol-0 legacy operation (`server/fastify/src/routes/generationChat.ts:5001-5048`), while cancellation projection synchronization only updates an already-existing cancellation control (`src/ts/server/generationOperations.ts:652-655`), so the old settled protocol-1 control remains the selected one while the new generation is live.

**Baseline behavior.** Original Risu shows the cancel button whenever `$doingChat` is true (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:658-665`). Continue creates a new AbortController and passes it to `sendChat` (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:302-313`), and the same visible cancel button aborts that controller (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:330-334`). No prior cancellation state can mask a later live request.

**Consequence and repro.** Start an accepted send, click Stop mid-stream, and wait for it to settle cancelled. Then choose Continue (or Regenerate) in the same chat. The later generation is active, but the previous settled control makes `currentChatOwnsGeneration` false, so current HEAD shows the normal Send control instead of Stop and the user cannot cancel the new generation from the composer. The fork-point UI shows Stop for the whole later request.

**Charter classification:** `fix` — scope cancellation controls to the exact active operation/job, or ignore a settled control when a newer live activity exists.

**Confidence:** high.

## D-3 — Restarting while an acknowledged Stop is `stopping` can discard the streamed partial

**Severity:** high

**Current behavior.** Stop transitions an owned operation to `stopping` and aborts its job (`server/fastify/src/routes/generationOperations.ts:757-817`). The runner persists accumulated text only after the aborted transport returns and only while the operation still reads as `stopping` (`server/fastify/src/routes/generationChat.ts:4697-4736`). There is therefore a durable gap before `persistRawCancelledResult` creates/commits the cancellation finalization record. Graceful shutdown closes that gap incorrectly by changing a registered `stopping` operation directly to `cancelled` before deleting/aborting the job and awaiting its runner (`server/fastify/src/app.ts:281-314`); the runner then takes the “not stopping” no-result branch. After an abrupt crash, startup reconciliation makes the same terminal decision for a `stopping` operation with no matching result/journal (`server/fastify/src/generationOperations.ts:1261-1279`, `server/fastify/src/generationOperations.ts:1298-1309`). The operation is terminal, so no retry recovery remains to restore the partial.

**Baseline behavior.** Original Risu appends the assistant row before consuming the stream (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1531-1549`), updates it on every chunk (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1572-1585`), and on abort merely exits after clearing `isStreaming`; it never removes the non-empty row (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1592-1600`). The UI Stop is the local controller abort (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:330-334`), so a server-process restart cannot pre-terminalize and suppress that local retained row.

**Consequence and repro.** Stream `partial reply`, click Stop, and restart Fastify after the cancellation route has committed `stopping` but before the runner enters `persistRawCancelledResult`. On graceful shutdown the operation is first forced to `cancelled`; on crash/startup the sweep does likewise when no journal exists. After projection refresh/reload, current HEAD has the user turn but no partial assistant row and offers no operation retry. The fork-point cancelled session retains `partial reply`. This is a new protocol-wave race layered on cancellation, not a re-report of CA-OR-3's raw-versus-processed partial or CA-OR-4's generic post-token transport-failure restoration.

**Charter classification:** `fix` — do not terminalize `stopping` without either a committed result or a confirmed replayable cancellation-finalization record.

**Confidence:** high on the state-machine race; medium-high on exact UI timing because it was not fault-injected dynamically.

## D-4 — Pre-token Stop removes the assistant placeholder that Original Risu retained

**Severity:** med

**Current behavior.** Current streaming creates an empty assistant row (`src/ts/process/postGeneration/streamResponse.ts:139-169`), but its finalizer removes an owned empty generated row on abort or empty termination (`src/ts/process/postGeneration/streamResponse.ts:266-275`, `src/ts/process/postGeneration/streamResponse.ts:329-345`). The behavior is explicitly pinned by the current test that expects a pre-token abort to restore a transcript containing only the user row (`src/ts/process/__tests__/streamResponse.test.ts:379-397`).

**Baseline behavior.** Original Risu also appends an empty assistant row as soon as a streaming response is classified (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1531-1549`), but its abort cleanup only resets `isStreaming` and returns false; it never splices the placeholder (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1553-1600`).

**Consequence and repro.** Have the provider open a streaming response but hold its first token. Click Stop after the response is classified and the placeholder is rendered. Current HEAD removes the assistant row; Original Risu leaves an empty assistant row with generation metadata in the transcript. These are observably different row shapes at the same cancellation phase.

**Charter classification:** `fix` — retain the fork-point placeholder in compatibility mode (even though removal is cleaner behavior).

**Confidence:** high.

## D-5 — Stop-before-submit rolls the sent row back into the composer instead of retaining the turn

**Severity:** med

**Current behavior.** Atomic send stages its intent, appends an optimistic user message, and creates a local cancellation control before submitting to the server (`src/ts/server/generationOperations.ts:416-466`), which makes Stop available while the operation is still local (`src/lib/ChatScreens/DefaultChatScreen.svelte:419-428`, `src/lib/ChatScreens/DefaultChatScreen.svelte:2559-2582`). If cancellation reaches the server first, it creates an unbound `cancel_requested` tombstone (`server/fastify/src/routes/generationOperations.ts:719-731`); the later submit binds that tombstone without accepting the message (`server/fastify/src/routes/generationOperations.ts:312-338`). The client then removes the optimistic row (`src/ts/server/generationOperations.ts:1063-1091`). Composer clearing happens only after an accepted append (`src/lib/ChatScreens/DefaultChatScreen.svelte:972-1007`), and the non-accepted result instead takes the append-failed path (`src/ts/process/acceptedSendCoordinator.svelte.ts:342-358`). The no-row/no-provider outcome is also pinned server-side (`server/fastify/__tests__/durableGeneration.test.ts:1053-1105`).

**Baseline behavior.** Original Risu applies input hooks, appends the user row, clears the composer, and writes the transcript before starting `sendChatMain` (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:183-213`). A subsequent Stop only aborts the generation controller and has no rollback path (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:302-334`).

**Consequence and repro.** Delay `POST /generation-operations` after the optimistic row appears, then immediately click Stop so the cancellation PUT wins. Current HEAD removes the sent turn, keeps its text in the composer, and reports the append failure path; the closest fork-point immediate cancellation keeps the user row in the transcript with the composer cleared. The early cancellability is additive, but its transcript/composer outcome does not match a user-cancelled fork-point send.

**Charter classification:** `fix` — cancelling generation before acceptance should not reinterpret the already-visible user action as an unsent draft in compatibility mode.

**Confidence:** high for current behavior and the baseline end state; medium-high for the phase comparison because the fork-point exposed Stop only after local dispatch began.

## D-6 — A network failure while stopping becomes a Retry/Refresh error state instead of an immediate local abort

**Severity:** med

**Current behavior.** For a protocol operation, the UI Stop deliberately does not abort its activity controller; it delegates to acknowledged operation cancellation (`src/ts/process/generationStop.svelte.ts:14-24`), a contract pinned by `src/ts/process/index.svelte.stop.test.ts:36-51`. Failure to stage the cancellation or receive its acknowledgement produces `stop_failed` (`src/ts/server/generationOperations.ts:1192-1241`, `src/ts/server/generationOperations.ts:1255-1283`), and a failed status refresh also projects `stop_failed` (`src/ts/server/generationOperations.ts:1296-1341`). The chat displays “Stop could not be acknowledged” with **Retry Stop** and **Refresh** actions (`src/lib/ChatScreens/DefaultChatScreen.svelte:2366-2392`) and converts the composer control into a retry state (`src/lib/ChatScreens/DefaultChatScreen.svelte:2559-2582`). The 503-then-retry behavior is pinned in `src/ts/server/generationOperations.test.ts:248-318`.

**Baseline behavior.** Original Risu's Stop synchronously calls `AbortController.abort()` (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:302-334`). The stream listener cancels its reader and exits without a Stop acknowledgement or Stop-specific error UI (`/home/codex/risu-baseline-71c476e9c/src/ts/process/index.svelte.ts:1553-1600`); the composer displays only the normal in-progress cancel control (`/home/codex/risu-baseline-71c476e9c/src/lib/ChatScreens/DefaultChatScreen.svelte:658-665`).

**Consequence and repro.** While a protocol-v1 reply is running, make the cancellation PUT return 503 or take the browser offline and click Stop. Current HEAD can leave the generation server-owned and present an acknowledgement-failure workflow requiring Retry/Refresh; if staging succeeded, it has already detached the viewer before the failed PUT (`src/ts/server/generationOperations.ts:1245-1258`). Original Risu immediately stops the local request and presents no failure workflow.

**Charter classification:** `decide` — exact parity favors immediate local abort, while the current UI truthfully exposes that a durable server-owned request may still run or bill after acknowledgement failure.

**Confidence:** high.

## D-7 — Restart recovery requires an explicit billing confirmation where the fork-point request retry proceeded automatically

**Severity:** med

**Current behavior.** Startup marks interrupted accepted/launching/owned operations `abandoned` and sets `providerMayHaveRun` from provider-dispatch evidence (`server/fastify/src/generationOperations.ts:1282-1295`). The client projects that as an accepted-send recovery (`src/ts/process/acceptedSendRecoveryState.ts:174-203`) and renders an interrupted/retry warning plus a possible-billing warning (`src/lib/ChatScreens/DefaultChatScreen.svelte:2459-2486`). Retrying is blocked on an explicit confirmation whenever `providerMayHaveRun` is true (`src/ts/process/acceptedSendCoordinator.svelte.ts:455-480`). The browser smoke test pins the restart, recovery card, alert dialog, and second provider call (`server/fastify/browser-smoke/acceptedSendProtocol.spec.ts:382-417`).

**Baseline behavior.** Original Risu's provider failure path stays inside `requestChatData`: after a retryable `fail`, it increments the retry count and loops automatically until `requestRetrys` is exceeded (`/home/codex/risu-baseline-71c476e9c/src/ts/process/request/request.ts:230-337`). The loop reuses the previously assembled request and has no billing prompt or user confirmation.

**Consequence and repro.** With `requestRetrys >= 1`, interrupt the process/network after provider dispatch has started but before a usable terminal response. On current HEAD, restart recovery leaves the saved user turn behind and blocks further reply generation on **Retry reply** plus a possible-double-billing confirmation. At the fork point, the analogous retryable provider failure silently issues the next request attempt. This finding concerns the post-recovery interaction gate—not the additive ability to discover the operation after reload.

**Charter classification:** `decide` — silent parity avoids a new blocked workflow, while the confirmation protects users from an otherwise invisible second bill.

**Confidence:** medium-high; the current restart path is integration-pinned, while the baseline comparison is to its retryable provider-failure path because it had no durable server-operation restart state.

## Areas swept and found clean

- Normal mid-stream Stop with at least one token: current retains/reconciles a non-empty partial, and the fork point retains the streamed row. The already-adjudicated difference in raw versus processed cancelled text (CA-OR-3) was intentionally not re-reported.
- Generic post-token transport failure restoration was inspected but not re-reported because it is CA-OR-4. D-3 is narrower: an acknowledged user Stop followed by shutdown/startup terminalization prevents the cancellation finalizer from recording its partial.
- Identified durable stream replay reuses an existing generation row (`src/ts/process/postGeneration/streamResponse.ts:140-150`), and the inspected normal reattach/terminal paths did not reveal a second assistant row, resurrected cancelled text, or repeated success finalization.
- Continue and Regenerate terminal row targeting, replay-gap handling, epoch fencing, already-completed/already-cancelled Stop dispositions, and the completion barrier were swept. No additional transcript delta was verified beyond D-2's stale-control UI ownership bug.
- Reattach-failure Retry/Refresh/Stop controls were inspected. Their ability to recover after reload is additive under the brief; no separate impossible fork-point transcript end state was established.

## Not dynamically verified

- The shutdown window in D-3 and the tail-ID retry sequence in D-1 were established from exact state transitions but were not fault-injected end-to-end, because running the repository suites could create files outside the one permitted report.
- I did not establish a deterministic user-reachable timing for clicking Stop while a completion (rather than cancellation) finalization transaction is in progress; the `completion_finalizing` UI/state was therefore not reported as a separate divergence.
- Multi-instance ownership/reattach behavior and mobile process-kill timing were reviewed statically but not exercised against a deployed multi-node environment.

Co-Authored-By: Codex <noreply@openai.com>
