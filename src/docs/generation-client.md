# Generation Client

Last audited: 2026-08-29.

This guide owns the browser side of durable chat generation: operation
acceptance, streaming, cancellation, reattach, terminal reconciliation,
generation effects, half-streaming, and completion audio. Visible transcript,
composer, progress, and confirmation behavior belongs in
[Svelte Chat UI](svelte-chat-ui.md); Fastify operation/job/timer ownership belongs
in [Backend Map](../../docs/structure/backend.md#generation-and-background-work).

## Coordinator And Key Files

`sendChat` in `src/ts/process/index.svelte.ts` is the browser coordinator for
chat generation UI. In Fastify mode it uses server prompt assembly and server
provider dispatch.

Important files:

- `src/ts/process/generationActivity.svelte.ts` owns the chat-keyed client
  activity registry, including independent stages and abort controllers.
  `src/ts/process/index.svelte.ts` owns the high-level `sendChat` coordinator;
  `doingChat`, `chatProcessStage`, and `activeGenerationTarget` remain aggregate
  compatibility projections rather than the per-chat UI source of truth.
- `src/ts/server/generationOperations.ts` owns protocol-v1 atomic
  send/continue/regenerate acceptance, encrypted outbox replay, optimistic user
  rows, operation projections, attempt-fenced streams, cancellation, retries,
  and bootstrap reconciliation. The lower-level chat endpoint remains the
  compatibility path when the server does not advertise this protocol. For an
  accepted send, it validates the response's append event, buffers matching
  own-session SSE echoes until response reconciliation finishes, and applies a
  typed optimistic-message effect only while its chat-body projection epoch is
  still current. Invalid or stale event/effect data falls back to authoritative
  resource reconciliation instead of replacing the optimistic transcript.
- `src/ts/process/request/providerCapability.ts` and
  `src/ts/process/request/serverPromptAssembly.ts` decide whether the selected
  request can run on the server.
- `src/ts/process/serverBackedSendChat.ts` builds server requests, maps legacy
  inlay ids to server asset refs, selects the advertised generation-operation
  protocol or lower-level `/api/v1/generate/chat` path, applies server message
  patches, and returns terminal data.
- `src/ts/process/request/serverChat.ts` parses chat SSE frames:
  `job_accepted`, stage, prompt, patch, info, token, side-effect,
  `agent_preset_progress`, `post_generation_progress`, warning, error, and
  done. It updates the scoped progress stores consumed by
  `AgentPresetProgress.svelte` and `PostGenerationScriptProgress.svelte`.
- `src/ts/process/halfStreamingProgress.ts` owns half-streaming token counts and
  throughput for the active character/chat/generation target.
- `src/ts/process/generationDisplayProjection.svelte.ts` owns transient,
  attempt-fenced display text for negotiated targeted regenerate. It never
  writes `Message.data`; presentation aliases let the generated message inherit
  the target row key during terminal authority handoff.
- `src/ts/process/reattach.ts` coordinates background recovery by durable
  `(databaseLineage, operationId)` authority. `jobId` and `attemptNo` remain
  expiring stream descriptors, while local viewer/activity state is only an
  observation projection. Foreground bootstrap reads have a bounded deadline
  and recovery epoch: visibility, page-show, online, and focus wakeups coalesce,
  supersede pre-suspension reads, and reject late responses. A successful probe
  re-arms the exact live attempt and retires its old browser viewer without
  issuing Stop before it awaits transcript hydration, so a stalled resource
  read cannot retain the old activity spinner. Strict recovery hydration shares
  the foreground deadline and abort signal; absent-job lifecycles settle only
  after that hydration. Pending finalization/effect recovery comes from the same
  bootstrap snapshot.
  `generationJobLifecycles` records attached, retrying, exhausted-dead,
  completed, and cancelled observer state plus the last transport error. Retry,
  Refresh, and Stop resolve a stale control through its recorded operation/chat
  lineage to the current exact authority. While a durable generation remains
  active, a failed foreground lifecycle probe receives bounded retries after
  500 ms, 2 s, and 5 s. A newer lifecycle signal, successful probe, settled
  activity, or teardown supersedes that retry sequence.
- `src/ts/process/generationEffectLedger.ts` claims and receipts client effects
  for the exact persisted generation. `recoveredGenerationEffects.ts` retries
  missing durable effects after bootstrap; late ephemeral effects are skipped.

## Preflight Persistence Gates

Before prompt assembly or provider fetch, `sendChat` awaits the character-owned
maintenance batch from `sendChatContext.ts`, the pending chat
generation-settings save, the pending selected-persona update, and a flush of
the selected character's debounced script-definition draft. A queued or failed
script save blocks generation just like another rejected/retained persistence
gate. For “send never reached fetch,” inspect `setupSendChatContext`,
`waitForPendingChatGenerationSettingsSave`,
`flushPendingSelectedPersonaUpdate`, and
`waitForPendingCharacterScriptDefinitionSave` before debugging the provider
adapter.

## Operations, Streams, And Reattach

Durable sends such as send, continue, and regenerate use operation-addressed
streams when protocol v1 is advertised; job-ID-only attachment remains a
compatibility fallback. Disconnect is an observation failure and does not imply
generation failure. Explicit Stop uses the exact operation (or the compatibility
job when no operation exists). The live adapter performs one immediate,
replay-aware reopen after an unrequested SSE EOF/read failure, rebuilding
replayed token deltas from zero and deduplicating replayed non-token effects.
Because that replay window may contain only a token suffix, a durable
`done.result` replaces the accumulator as the last cumulative raw snapshot
before stream closure. After an explicit replay gap, the canonical terminal can
also establish readiness when hard caps evicted `prompt` or `info`. Extend-mode
Continue carries its immutable pre-generation base in `info` and the terminal
fallback, so an outer reattach retry cannot capture its already-rendered partial
as a new prefix. An additive cancelled outcome still reconciles the persisted
partial projection, but bypasses output listeners, IGP, notifications, emotion
work, rerolls, resend, terminal TTS/inlay work, and completion sound.
Foreground visibility, page-show, online, and focus probes refresh operation,
job, finalization, transcript, and pending-effect authority so a mounted mobile
tab can recover even when its original connection was discarded before the id
reached JavaScript. A stale-attempt response redirects only to an exact newer
live descriptor; terminal/non-live responses and compatibility 404s force
authority and transcript reconciliation before observer UI is settled. Viewer
transport failures never use the ordinary provider-error/inlay path until
durable authority proves a terminal generation failure. Terminal `postGeneration` data
can advance the revision cache, apply a server-owned `messagePatch`, render the
inlay screen over `finalText`, request `resendChat`, or surface an Agent Preset
error as a failed terminal result. Generation results are persisted server-side,
so the browser suppresses the old generation-result command in server-backed
paths. The configured message-completion sound is emitted once through its
ledgered successful terminal lifecycle, rather than from the selected chat
component, so background and reattached generations retain the same behavior.

## Projection And Terminal Reconciliation

Stream writes, terminal message patches, cancelled-partial restoration, and
delayed inlay finalization resolve the stable live character/chat identity each
time. Chat-body projection and message-mutation-intent epochs detach an older
stream when authoritative hydration or a newer user edit wins; cleanup then
removes or restores only data still owned by that stream. This prevents late
tokens, terminal patches, or effect work from resurrecting or overwriting newer
authority.

### Targeted Regeneration

For `regenerateTargetProjection: 1`, targeted admission registers a preparing
projection before prompt assembly finishes. Cumulative provider text updates
that projection instead of appending a synthetic assistant. Terminal handling
installs the generated-id presentation alias, strictly hydrates the committed
chat resource, and removes the projection only after the generated authority is
observable. No-token failure or non-retaining cancellation simply drops the
projection, leaving the original target untouched; retained partials use the
same authoritative terminal handoff. Operation id plus attempt number rejects
late frames, and reattach reuses the same projection rather than appending a
duplicate row.

### Completion Audio

`messageCompletionSound.ts` lazily shares one decoded bundled-audio buffer and
`AudioContext`. `installCompletionAudioUnlock()` resumes and prepares that
context from an eligible pointer or keyboard activation without starting an
audio source, then suspends it while idle. Each actual generation- or
translation-completion ding uses a disposable `AudioBufferSourceNode`; ended or
superseded nodes are disconnected and the context is suspended again. Browsers
without Web Audio construct an `HTMLAudioElement` only for actual playback and
unload it afterward. Web Push remains the independent background-notification
path and is not enabled by completion-audio settings.

## Half-Streaming

When an `info` frame carries `halfStreaming: true`,
`src/ts/process/request/serverChat.ts` marks the stream as half-streaming and
buffers provider text in `tokenResult` instead of enqueueing it into the visible
stream. Progress remains live through `src/ts/process/halfStreamingProgress.ts`:
token frames use cumulative server-tokenized `generatedTokens` and
provider-dispatch `elapsedMs` when present, preserving throughput across
gateway-batched chunks, with frame counting as the older server fallback. The
buffered text is enqueued once on `done`.
Stop keeps a server-backed half-stream viewer attached until the raw buffered
partial and cancelled terminal arrive, then reconciles the exact processed
persisted snapshot. As a fallback, reconciliation can recreate a placeholder
already removed by abort cleanup. A local-provider half-stream has no server
terminal, so its buffered partial is applied through client editoutput before
abort cleanup.

## Persistence And Effect Recovery

Generation persistence failures also carry a browser reconciliation contract.
A terminal `persistenceDisposition: rejected` or `unconfirmed` clears the
provisional persistence marker, removes or restores only the still-owned
streamed projection, and force-hydrates the chat. A retryable `queued`
disposition is accepted only for a confirmed replayable server journal row and
keeps the provisional generation marked until an authoritative chat hydration
contains it. `committed_cleanup_pending` arrives on a successful `done` frame:
the authoritative message already exists and only retry-journal cleanup remains.
Bootstrap reconstructs pending and retained terminal journal state after reload.
Snapshot-safe provisional messages are reapplied after authoritative hydration;
repeated transient failures advance to a stalled marker while continuing capped
backoff retries, and `stalled_legacy` is shown as a distinct non-retrying state.
Conflicting post-generation script mutations arrive as warning frames but do
not erase successfully persisted generated message text.

Generation-finalization indicators retain a flat compatibility store for
bootstrap, polling, and smoke snapshots, while the transcript subscribes to an
independent per-chat projection. Clearing or acknowledging another chat cannot
rebuild the visible row model, and each visible projection builds message-id and
generation-id indexes once instead of scanning the flat list for every row.

Successful accepted sends may also schedule BardWiki automatic confirmation on
the server for the preceding exact `user -> char` source pair when the effective
chat policy enables it. Continue, regenerate, failed/cancelled work, alternates,
and the just-created current send do not qualify. This detached memory work does
not extend the generation stream or mutate the browser transcript; its bounded
status arrives through the BardWiki job projection. See
[BardWiki Memory](../../docs/structure/bardwiki.md#confirmation-and-background-jobs).

The `generation.persisted` read applies its bounded suffix in place. Safe
appends, replacements, and truncations preserve the resident prefix and message
object identity; placeholders are allocated only for genuinely unloaded
indexes. Terminal patches and later authoritative suffixes compare structured
values before assignment, so either delivery order converges without a second
meaningful transcript mutation. Plain generation-suffix responses deliberately
omit chat-wide Hypa state; the decoder carries an explicit inclusion bit so
omission preserves resident Hypa data, while full and ordinary ranged reads
retain the historical absent-means-clear behavior. Reroll alternates remain
included because every generation finalization can clear or replace that
authoritative candidate set.

Ledgered completion callbacks emit development performance entries named
`risu:generation-effect:<kind>:<delivery>`. Best-effort emotion/image and plugin
output work yields through the browser scheduler after the transcript settles
when that API is available; effect claims, leases, completion receipts, and
idempotency keys retain their existing ownership.

## Adjacent Owners And Triage

Provider/profile resolution is canonical in
[Providers And Models](../../docs/structure/providers-and-models.md), prompt
construction in
[Prompt Assembly And Scripting](../../docs/structure/prompt-assembly-and-scripting.md),
and Agent execution in
[Agents And Presets](../../docs/structure/agents-and-presets.md).

When generation UI is wrong, inspect both the Svelte surface
`src/lib/ChatScreens/DefaultChatScreen.svelte` and the runtime files above. Its
visible ownership is documented in [Svelte Chat UI](svelte-chat-ui.md).
