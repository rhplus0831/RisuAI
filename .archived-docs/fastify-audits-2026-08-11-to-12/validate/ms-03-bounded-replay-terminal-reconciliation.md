# MS-03 validation: bounded replay and terminal reconciliation

Validated: 2026-08-11

Finding: MS-03 in the [Fastify multi-chat and mobile stability audit](../fastify-multichat-mobile-stability-audit-2026-08-11.md#ms-03--bounded-replay-and-terminal-reconciliation-disagree)

Status: **Confirmed, not fixed**

Severity: **High**

Validated source: `e43f5da431f8d2099da6e5fd0e5cc5a7d471a25c`. The MS-03-relevant files are unchanged from the consolidated audit's recorded revision, `9afde4658ea5b277493e9d7f6ef7aaf387544165`.

## Executive conclusion

MS-03 is a real cross-layer consistency bug in durable chat generation. The server intentionally bounds the generation replay window by discarding old, unprotected `token` frames. It also correctly retains the full raw completion in the protected terminal `done.result`. The reconnecting browser nevertheless assumes that any replayed token history is complete: it rebuilds text from the retained token suffix and consults `done.result` only if **zero** token text survived.

As a result, a non-empty retained suffix takes precedence over the complete terminal result. The browser can write that suffix into the assistant row, report a successful generation, notify plugins, run IGP against it, and feed it to notification/emotion processing. The SQLite transcript is normally correct because server finalization uses the full provider result before emitting `done`; an independent `generation.persisted` hydration can repair the browser later. That later read is not ordered as a barrier before terminal callbacks, so it is mitigation rather than correctness.

The minimal safe repair is client-side: for every durable stream, a present `done.result` must unconditionally replace replay-accumulated raw text and be enqueued as the last cumulative stream snapshot **before** the token stream closes and before terminal consumers run. `done.postGeneration.finalText`, when present, remains a second transformation applied after that full raw baseline.

## What exactly is the bug?

The two sides of the durable stream implement incompatible assumptions:

- The server implements a **lossy replay window**. `token` is deliberately unprotected, so old token frames can be evicted when replay exceeds 512 events or 2 MiB. `done`, prompt metadata, patches, warnings, and progress frames are protected ([replay limits](../../../server/fastify/src/streamJobs.ts#L15-L17), [protected set](../../../server/fastify/src/streamJobs.ts#L80-L90), [eviction loop](../../../server/fastify/src/streamJobs.ts#L221-L241)).
- The browser implements a **lossless replay assumption**. After an internal durable reconnect it resets `tokenResult` to empty because it expects replay to contain the entire token history ([reconnect reset](../../../src/ts/process/request/serverChat.ts#L696-L724)). A reload-based reattach starts with the same empty accumulator.
- Replayed token frames are concatenated into that accumulator and emitted as cumulative snapshots ([token handling](../../../src/ts/process/request/serverChat.ts#L826-L839)).
- The terminal handler uses the complete `done.result` only when `tokenResult.length === 0`. If even one suffix token survived, the full result is ignored ([terminal handling](../../../src/ts/process/request/serverChat.ts#L884-L894)).

In compact form, the faulty rule is:

```text
terminal text = replayed token text, if non-empty
                otherwise done.result
```

The durable contract requires the opposite precedence:

```text
terminal raw text = done.result, if present
                    otherwise replayed token text
```

This is not a delta-versus-cumulative misunderstanding in the UI stream. `serverChat.ts` deliberately converts provider token deltas into cumulative snapshots, and `consumeStreamResponse` correctly treats every incoming value as the latest complete display value. The defect is that the cumulative value was rebuilt from an incomplete replay window.

### Exact trigger conditions

The incorrect result requires all of the following:

1. The generation is durable and continues on the server while the original viewer is disconnected, suspended, evicted, or reloaded.
2. Enough frames accumulate to cross either the 512-event replay limit or the 2 MiB replay-byte limit.
3. Eviction removes at least one early `token` frame while leaving at least one later `token` frame.
4. The browser attaches or reconnects and receives that non-empty token suffix plus the protected `done` frame.
5. For the visible assistant row and terminal callbacks to remain suffix-based, authoritative `generation.persisted` hydration must not win the separate race first. This is especially plausible during mobile suspension or network recovery.

If eviction removes **all** token frames, the current empty-accumulator fallback uses `done.result` and the MS-03 truncation does not occur. Likewise, if server post-processing changes the text and supplies `done.postGeneration.finalText`, terminal row reconciliation can repair the visible row; however, the earlier streamed result passed into stage 4 remains suffix-derived.

### Direct reproduction of both caps

A temporary source-level probe against the current `JobRegistry` produced the following results. The probe was removed after execution; it called the production replay methods directly.

| Probe | Input | Retained replay | Current client decision |
| --- | --- | --- | --- |
| Event limit | `prompt`, `info`, 600 small token frames, `done` | 512 total frames; token frames 91 through 599 survived; the full terminal result also survived | Suffix is non-empty, so `done.result` is ignored |
| Byte limit | `prompt`, `info`, 256 token frames of about 6 KiB each, `done` | 2,092,813 bytes; only token frames 164 through 255 survived; terminal result length was 1,537,024 characters | Suffix is non-empty, so `done.result` is ignored |

The byte case occurs because durable replay temporarily holds both the token frames and the duplicate full result in `done`. Adding `done` forces old token frames out until the buffer fits, but can still leave a non-empty suffix alongside the full terminal snapshot.

## What is canonical at each stage?

There are four relevant text representations, and the fix must not conflate them:

| Representation | Owner | Meaning |
| --- | --- | --- |
| Token accumulator | Provider transport and browser relay | Raw provider completion assembled from token deltas; on replay the browser's copy may be only a suffix |
| `done.result` | Server terminal contract | Full raw provider completion for durable/replayable streams |
| `done.postGeneration.finalText` | Server post-generation | Final combined/display text after trimming, `editoutput`, Agent Preset final output, run-vars, and output-trigger changes; omitted when unchanged |
| Persisted assistant row | Fastify/SQLite | Canonical finalized message, including mode-aware send/continue/regenerate semantics and post-generation changes |

The provider transport accumulates every token into `result`, runs server post-generation, and then emits `done.result` unless duplicate omission was explicitly negotiated ([provider accumulator and terminal](../../../server/fastify/src/prompt/providerTransport.ts#L83-L125)). The durable route does not enable result omission ([durable dispatch](../../../server/fastify/src/routes/generationChat.ts#L3765-L3809)).

Server post-generation reformats the complete raw result, applies the post-generation transforms, and computes `textChanged` against that reformatted baseline ([post-generation pass](../../../server/fastify/src/prompt/assemble.ts#L2982-L3056)). The terminal `postGeneration.finalText` field is intentionally emitted only when `textChanged` is true ([frame construction](../../../server/fastify/src/routes/generationChat.ts#L2041-L2067)). Therefore absence of `finalText` means “the full streamed raw result is already the correct baseline,” not “whatever replay suffix the browser currently has is correct.”

For `continue`, `done.result` is the complete newly generated fragment, while the browser's stream projection combines it with the existing assistant-row prefix. For `send` and `regenerate`, it is the complete new provider result. Replacing the raw accumulator from `done.result` is therefore correct for all three modes; the existing mode-aware projection code still owns prefixing and target selection.

## How does the bug affect users?

### Visible transcript

`consumeStreamResponse` writes `reformatContent(prefix + result)` into the generation-owned assistant row ([stream application](../../../src/ts/process/postGeneration/streamResponse.ts#L239-L260)). For a normal `send`, `prefix` is empty, so the replay suffix replaces the earlier partial or empty row. For `continue`, only the retained generated suffix is appended to the pre-existing assistant prefix. For `regenerate`, the replacement candidate receives only the retained suffix.

If `postGeneration.finalText` is absent, `applyServerBackedTerminal` uses the assistant row's current data as its base, so terminal reconciliation preserves the suffix ([terminal base text](../../../src/ts/process/serverBackedSendChat.ts#L775-L817)). The UI then reports successful completion even though its local projection is incomplete.

### Plugin output listeners

After terminal application, the client locates the final assistant and calls every chat output listener ([listener dispatch](../../../src/ts/process/serverBackedSendChat.ts#L962-L983)). Listeners receive a clone of the current chat and cannot recover text that was never reconciled ([listener snapshot](../../../src/ts/plugins/chatOutputListeners.ts#L26-L41)). When `finalText` is absent and hydration has not already won, plugins observe the suffix as if it were a successful full reply.

This can produce durable secondary effects inside plugins even after later hydration repairs the visible row. Hydration cannot retract an external plugin action already taken from truncated input.

### IGP

The coordinator runs IGP after `applyServerBackedTerminal` and uses the terminal-selected assistant row as its stable target ([IGP ordering](../../../src/ts/process/index.svelte.ts#L570-L607)). The target captures the row's current `expectedData`; `evaluateIgp` verifies that exact value and persists `expectedData + appended` ([IGP compare-and-append](../../../src/ts/process/postGeneration/igp.ts#L41-L78)). Under MS-03, IGP can therefore derive from and append to the suffix, potentially turning a temporary projection error into a new message update command.

### Notifications and emotion selection

The raw `orchestrate.result` is captured before terminal row reconciliation and is later passed to stage 4 ([coordinator ordering](../../../src/ts/process/index.svelte.ts#L538-L629)). Stage 4 uses it as the default desktop-notification body and as the input to embedding- or LLM-based emotion fallback ([stage 4](../../../src/ts/process/postGeneration/runStage4.ts#L44-L105), [LLM emotion input](../../../src/ts/process/postGeneration/emotionFallbackLlm.ts#L56-L84), [embedding emotion input](../../../src/ts/process/postGeneration/emotionFallbackEmbedding.ts#L12-L19)). Those consumers can receive the suffix even when a later `postGeneration.finalText` repairs the row.

### What is normally not lost

The authoritative server row is normally complete. Durable post-generation resolves and persists from the full provider completion before `done` is emitted ([durable finalization](../../../server/fastify/src/routes/generationChat.ts#L3367-L3540)). Persistence emits a `generation.persisted` command event ([persistence event](../../../server/fastify/src/routes/generationChat.ts#L3127-L3158)). The browser's separate resource pipeline converts that event into a generation-anchored transcript read ([invalidation planning](../../../src/ts/server/resourceInvalidation.ts#L607-L609), [targeted read](../../../src/ts/server/resourceInvalidation.ts#L1112-L1121)) and can apply the authoritative message payload.

Server-owned automatic translation and terminal TTS are also derived from the server's finalized message/full primary text rather than from the browser suffix. They may be attached to a temporarily suffix-based browser projection, but their source text is not truncated by MS-03.

The distinction matters: MS-03 is usually a browser projection and side-effect consistency failure, not primary SQLite data loss. It is still high severity because successful terminal callbacks can act irreversibly before the later repair.

## Exact code sequence

### Server sequence

1. A persisting chat request starts a durable job. The server creates a `JobRegistry` entry, enables replay, records its chat/mode, attaches the initial viewer, and launches a detached runner ([durable job creation](../../../server/fastify/src/routes/generationChat.ts#L3883-L3943)).
2. Provider token deltas pass through `emitProviderChunks`, which appends them to the server's complete `result` string and emits `token` events ([provider tokens](../../../server/fastify/src/prompt/providerTransport.ts#L132-L155)).
3. Every formatted event is pushed through `JobRegistry.pushRaw`. Durable replay retains the frame even while a viewer is attached; replay is therefore available after a later disconnect ([raw replay append](../../../server/fastify/src/streamJobs.ts#L321-L369)).
4. On overflow, the replay loop repeatedly removes the earliest unprotected frame. Because `token` is unprotected and prompt/info/done are protected, the replay naturally becomes metadata + a token suffix ([eviction](../../../server/fastify/src/streamJobs.ts#L221-L241)).
5. The provider finishes. Server post-generation runs against the complete `result`, persists the derived assistant row and related mutations, and emits `generation.persisted`.
6. `emitProviderChunks` emits protected side-effect frames and a protected `done` whose `result` is the complete raw provider output. `postGeneration.finalText` is included only if the server transformed the display text.
7. The runner marks the job done and closes live viewers. If no viewer is attached, the terminal replay remains available during the grace interval ([runner completion](../../../server/fastify/src/routes/generationChat.ts#L3854-L3873)).

### Browser sequence

1. The original viewer is lost. A still-running in-process request sees an SSE read failure/EOF and attempts a durable reconnect; a reloaded browser discovers the job from bootstrap and opens the same reattach route.
2. On successful internal reconnect, `serverChat.ts` sets `tokenResult = ''` to avoid duplicating replayed tokens. A reload starts from the same empty state.
3. The server replays its retained frames. Each surviving `token` appends to `tokenResult`, producing only the retained suffix.
4. The browser receives `done.result = fullText`, but `needsTerminalResult` is false because the suffix is non-empty. No full terminal snapshot is enqueued.
5. The token stream closes. `consumeStreamResponse` drains it first and writes the last cumulative value—the suffix—into the owned assistant row. It returns the suffix as `orchestrate.result` and in its projection record ([stream return](../../../src/ts/process/postGeneration/streamResponse.ts#L344-L357)).
6. Only after stream consumption does the coordinator await and apply the separate terminal promise. `done.result` is still present in that terminal object, but `applyServerBackedTerminal` never uses it as a fallback; it uses `postGeneration.finalText` or the current assistant data.
7. Output listeners run. IGP may run next. Stage 4 later receives the suffix-valued `orchestrate.result`.
8. Independently, the command-event connection and a targeted REST read may hydrate the complete persisted row. There is no await or fence tying that read to steps 5–7.

## Root cause

The immediate defect is one conditional in `serverChat.ts`, but the architectural cause is that replay completeness is implicit:

- Frames have no replay sequence/cursor visible to the browser.
- Eviction records no “gap occurred” marker.
- The client cannot distinguish a complete token replay from a suffix replay.
- `done.result` is documented as the full durable fallback but is treated as a fallback only for an entirely empty replay.
- Terminal handling is split between a token `ReadableStream` and a separate promise, making it possible to retain the correct terminal payload without ever applying its text to the streamed projection.

The implementation has all data needed for the minimal fix; it simply gives the lossy representation higher precedence than the canonical one.

## What changes are needed?

### Required minimal fix

Change the `done` case in `src/ts/process/request/serverChat.ts` so a present full result is canonical for a durable/replayable stream:

1. Parse `donePayload` as today.
2. If this request watches a durable job and `donePayload.result` is a string, assign it to `tokenResult` regardless of whether replayed token text is non-empty.
3. If that assignment changed the accumulated text, enqueue one final cumulative stream snapshot for ordinary streaming. Continue to enqueue at terminal for half-streaming.
4. Perform this replacement/enqueue before resolving the terminal promise, clearing progress, closing the token stream, or running terminal consumers.
5. Preserve the existing inline negotiated contract: an inline stream may omit `done.result`, in which case its accumulated token text remains authoritative.

Conceptually:

```ts
const previousTokenResult = tokenResult
if (watchesDurableJob && typeof donePayload.result === 'string') {
  tokenResult = donePayload.result
}
const terminalSnapshotChanged = tokenResult !== previousTokenResult

if (halfStreaming || terminalSnapshotChanged) {
  enqueueToken({ [streamKey]: tokenResult })
}
```

The production change should retain the current done-only behavior too: when no token was ever emitted and `done.result` exists, the terminal result must still be enqueued.

This placement makes the existing ordering work in the application's favor. `consumeStreamResponse` drains the final queued snapshot before its reader observes stream completion, so the owned assistant projection becomes full before `applyServerBackedTerminal`, output listeners, IGP, and stage 4 proceed.

### Terminal reconciliation hardening

As defense in depth, `applyServerBackedTerminal` should either receive the canonical raw terminal text explicitly or assert that the stream projection already matches durable `done.result` after the mode-aware reformat/prefix step. It should not independently write raw `done.result` without mode context: `continue` needs the existing row prefix, and `postGeneration.finalText` may be the canonical transformed whole-row value.

A useful invariant is:

```text
before successful terminal callbacks:
  local raw projection == mode-aware rendering of done.result
  then, if present, local final projection == postGeneration.finalText
```

If that invariant cannot be established, terminal success should pause for authoritative hydration rather than running success callbacks on uncertain text.

### Stronger protocol fix

The more robust long-term design is to make replay loss explicit:

- add monotonically increasing frame sequence numbers or replay cursors;
- record when eviction creates a gap;
- send a protected `replay_gap`/snapshot frame containing the current complete accumulated raw text, or expose a canonical snapshot endpoint;
- make reattach fail closed or fetch the snapshot when its requested cursor predates the retained window; and
- compact progress/state frames so the server can enforce a real hard memory limit.

This would support correct in-flight display before `done` exists, while the minimal fix guarantees correctness at successful terminal settlement.

### Do not use resource hydration as the fix

Waiting for the existing `generation.persisted` invalidation “most of the time” is insufficient. It is a different connection and request, can be delayed by the same mobile lifecycle event that caused reattach, and cannot undo plugin/IGP/notification/emotion work that already ran. Hydration should remain a consistency backstop, not the terminal text source of last resort when `done.result` is already in hand.

## How should the fix be validated?

Validation must prove equality at every consumer, not only in SQLite.

### 1. Replay-registry unit coverage

Add durable replay tests to `server/fastify/__tests__/streamJobs.test.ts`. Existing cap tests exercise only the generic `pendingEvents` buffer, while durable `replayEvents` coverage checks only Agent Preset snapshot deduplication ([current replay test](../../../server/fastify/__tests__/streamJobs.test.ts#L254-L277), [current pending cap tests](../../../server/fastify/__tests__/streamJobs.test.ts#L306-L325)).

Add separate cases for:

- more than 512 small `token` frames plus protected prompt/info/done;
- fewer than 512 large token frames whose duplicate terminal result crosses 2 MiB;
- UTF-8/multibyte content so byte accounting is tested with `Buffer.byteLength` rather than JavaScript character count;
- a terminal result larger than the replay-byte limit; and
- protected-only overflow, which is also needed for the additional issue below.

For MS-03, assert that the retained token history is a non-empty suffix and that `done.result` remains complete.

### 2. Browser request-layer regression

Add a focused case to `src/ts/process/request/tests/serverChat.test.ts` whose reattach response contains:

```text
token: "retained suffix"
done.result: "evicted prefix retained suffix"
```

Assert all of the following:

- the final `ReadableStream` value is the complete result;
- the stream closes only after that complete value is readable;
- the terminal promise still exposes the same `done.result`;
- no `prefix + prefix` duplication occurs on a normal complete replay;
- an inline stream with omitted `done.result` still completes from token text; and
- half-streaming emits exactly one complete terminal snapshot.

The current mobile-drop test cannot catch MS-03 because its replay includes the original `partial` prefix before ` recovered`; it proves reset/no-duplication, not gap recovery ([existing mobile replay test](../../../src/ts/process/request/tests/serverChat.test.ts#L652-L724)). The done-only and compact-done tests likewise do not combine a non-empty suffix with a different complete terminal result ([existing terminal tests](../../../src/ts/process/request/tests/serverChat.test.ts#L726-L845)).

### 3. Mode and post-generation matrix

Exercise `send`, `continue`, and `regenerate` with both:

- unchanged post-generation text, where `postGeneration.finalText` is absent; and
- changed post-generation text, where it is present.

Also cover `removeIncompleteResponse`, half-streaming, an empty provider result, and a provider that emits one large token frame. Assertions should distinguish the raw complete fragment from the final whole-row text for `continue`.

### 4. Cross-layer terminal-consumer test

Use the server-backed send fixture with authoritative hydration deliberately delayed until after terminal callbacks. Force a replay gap, then assert equality among:

- the visible assistant row before hydration;
- the stream consumer's returned result;
- the cloned chat observed by output listeners;
- IGP's `expectedData` and persisted compare-and-append base;
- desktop notification input;
- embedding/LLM emotion input; and
- the server's persisted assistant row.

Every applicable value must contain the complete response, not the suffix. Then release hydration and assert it is an idempotent no-op with respect to text.

### 5. Real Fastify durable integration

Extend `server/fastify/__tests__/durableGeneration.test.ts` with a provider fixture that emits more than 512 deltas, and another that crosses the byte limit before terminal completion. The flow should:

1. start a durable generation;
2. detach the initial viewer before overflow;
3. allow the server to complete and persist;
4. reattach within terminal grace;
5. verify replay has a suffix and full `done.result`; and
6. verify the authoritative message is complete.

Pair that server test with the client request-layer/cross-layer test above. A server-only assertion that `done.result` is complete is necessary but cannot prove the browser uses it.

### 6. Browser/mobile lifecycle acceptance

Add a production-stack Playwright journey for mid-stream connection loss, full reload, `pagehide/pageshow`, offline/online, and simulated process loss. Run it with resource-event delivery delayed or temporarily disconnected so successful behavior cannot be attributed to hydration winning a race.

For each lifecycle case, assert:

- one assistant row, with the complete text;
- no duplicate prefix after reattach;
- no suffix-only transient at successful terminal settlement;
- one output-listener invocation with complete text;
- one IGP invocation against complete text;
- complete authoritative server text; and
- no remaining active job/recovery marker after completion.

### Focused verification run during this investigation

The following existing suites pass on the validated source:

```text
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/durableGeneration.test.ts

2 files passed; 98 tests passed

pnpm exec vitest run \
  src/ts/process/request/tests/serverChat.test.ts \
  src/ts/process/serverBackedSendChat.findMessage.test.ts

2 files passed; 80 tests passed
```

These passing results confirm that the existing lifecycle contracts remain green; they do **not** invalidate MS-03 because none of the selected tests presents the client with a non-empty truncated replay suffix and a different full durable terminal result.

## Additional issues discovered outside the consolidated audit

Yes. Two additional, directly related issues were found. Neither is documented as a separate finding in the consolidated audit.

### Additional issue A: cancelled durable jobs are terminally reported as successful completion

Confidence: **Confirmed**

When a durable provider stream is explicitly cancelled, `emitProviderChunks` returns `status: 'aborted'` without emitting a terminal event. The durable runner persists the accumulated raw partial text, then emits an ordinary `done` containing that partial result so a reattached observer does not hang ([cancel finalization](../../../server/fastify/src/routes/generationChat.ts#L3810-L3831)). The locked `DoneEvent` contract has no completed/cancelled discriminator ([server event type](../../../server/fastify/src/prompt/sseEvents.ts#L179-L193), [client mirror](../../../src/ts/process/request/serverChatEvents.ts#L294-L308)).

The observer consequently classifies the frame as `status: 'done'` and `reattachOutcome: 'completed'` ([done handling](../../../src/ts/process/request/serverChat.ts#L884-L923)). It then follows the normal successful terminal path: it can run output listeners, IGP, desktop notification, and emotion processing over the intentionally partial cancelled text. The cancelling browser usually follows its local abort path and does not see this, but another attached tab/client or a reattaching observer does.

Existing coverage asserts only that the observer receives a `done` and the stream ends; it does not assert cancellation semantics or that success callbacks are suppressed ([current cancel-observer test](../../../server/fastify/__tests__/durableGeneration.test.ts#L1137-L1168)).

Recommended follow-up:

- add an additive terminal disposition such as `outcome: 'completed' | 'cancelled'` to `done`, or add a dedicated protected cancellation terminal event;
- let the observer reconcile the server-persisted partial row without classifying the operation as successful generation completion;
- suppress output listeners, IGP, completion notifications, automatic emotion processing, and resend logic on cancelled terminals; and
- add a two-viewer test where one client cancels and the other proves both stream closure and callback suppression.

This is separate from MS-04. MS-04 concerns a Stop request that cannot address the server job before the job ID arrives. This issue occurs after cancellation successfully reaches and aborts the known job.

### Additional issue B: the durable replay “limits” are soft for protected frames

Confidence: **Confirmed at the replay-registry layer**

The cap loop removes only unprotected frames. If the replay remains above 512 events or 2 MiB and no droppable frame exists, `droppableIndex` is `-1` and the loop breaks while the replay is still above the configured limit ([cap loop](../../../server/fastify/src/streamJobs.ts#L231-L241)).

This can happen when:

- protected progress/warning/patch/side-effect frames alone exceed the event limit; or
- a single protected `done` frame containing the full result is larger than 2 MiB.

The issue does not cause MS-03's suffix bug when all tokens are gone—the client then uses `done.result`—but it invalidates the claimed hard memory bound. Durable generation also wraps its own `JobRegistry` and does not apply the proxy route's 64-active-job admission guard ([generation registry](../../../server/fastify/src/generationJobs.ts#L20-L23), [durable creation](../../../server/fastify/src/routes/generationChat.ts#L3900-L3923)). Multiple detached jobs with oversized protected replay can therefore create avoidable process-memory pressure.

Recommended follow-up:

- define a hard per-job and aggregate durable-generation replay budget;
- compact replaceable progress frames into latest-state snapshots;
- store or fetch oversized canonical terminal results outside the in-memory frame window;
- emit an explicit replay-gap/snapshot contract rather than preserving every protected frame indefinitely; and
- add tests asserting the chosen hard-bound behavior when protected frames alone exceed each limit.

Risk severity should be triaged separately because practical provider output and execution limits constrain ordinary cases, but the current constants are not enforceable upper bounds.

## Historical comparison with pre-Fastify RisuAI

This failure mode is migration-specific. The pre-Fastify chat path called provider adapters directly from the browser, created the streaming assistant row locally, and treated each provider stream value as the latest cumulative snapshot ([legacy dispatch and stream setup](../../../../Risuai/src/ts/process/index.svelte.ts#L1554-L1619), [legacy stream consumption](../../../../Risuai/src/ts/process/index.svelte.ts#L1682-L1759)). OpenAI-compatible parsing accumulated deltas before enqueuing them ([legacy accumulation](../../../../Risuai/src/ts/process/request/openAI/requests.ts#L978-L985), [legacy enqueue](../../../../Risuai/src/ts/process/request/openAI/requests.ts#L1036-L1052)). The legacy documentation likewise describes cumulative text under key `"0"` ([legacy pipeline](../../../../Risuai/docs/chat-pipeline.md#streaming)).

There was no durable chat-generation job, bootstrap discovery, bounded SSE replay, or terminal full-result reconciliation. A browser disconnect cancelled or failed the local stream rather than letting a detached server job finish and later replay. The old generic proxy-stream job buffer is infrastructure precedent only; it did not own chat transcript finalization.

The compatibility lesson is narrow: retain the cumulative-snapshot contract consumed by the chat renderer, but ensure a durable terminal snapshot replaces any lossy replay reconstruction before successful post-processing.

## Final assessment

MS-03 should remain **High / Confirmed** until the client treats durable `done.result` as canonical and cross-layer cap-overflow tests prove that every terminal consumer sees the same complete response as SQLite. A server-only replay test or eventual hydration assertion is not sufficient.

The investigation also found two separate follow-ups: cancelled durable jobs lack a non-success terminal disposition, and protected replay frames can escape the configured memory bounds. Both should be tracked independently so the MS-03 patch does not accidentally declare the broader terminal/replay contract complete.
