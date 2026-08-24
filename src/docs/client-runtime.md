# Client Runtime Guide

Last audited: 2026-08-18.

This file covers browser TypeScript coordinators that influence visible Svelte
UI. For component ownership and UI triage, start with the
[Svelte UI index](README.md).

The runtime is Fastify-backed. The browser loads durable settings, collections,
character rows, and the standalone inlay catalog through REST resources,
renders Svelte UI from reactive resource state, sends command mutations to
Fastify, listens for invalidation events, and fetches large bodies such as chat
messages on demand.

## Client TypeScript Areas

| Path                                                                                                                                                                           | Runtime ownership                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ts/server/`                                                                                                                                                               | Fastify browser adapters: runtime bootstrap, encrypted pending-mutation outbox/replay, REST resource reads, resource state/invalidation, commands, hydration, events, active writer, provider/media operations, assets, backups, Realm import, bridge watchers, push notifications, stale-operation guards, diagnostics, smoke hooks. |
| `src/ts/storage/`                                                                                                                                                              | Server-backed auth/storage compatibility, resource-database accessors, `.risu` helpers, backup helpers, and auto-storage selection.                                                                                                                                                                                                   |
| `src/ts/process/`                                                                                                                                                              | `sendChat`, server-backed generation bridge, durable reattach, files/MCP/memory/embedding/post-generation helpers, retained parity helpers.                                                                                                                                                                                           |
| `src/ts/process/request/`                                                                                                                                                      | Provider/server-routing classifiers, chat/completion/memory request adapters, SSE parsing, message patch helpers.                                                                                                                                                                                                                     |
| `src/ts/model/`, `src/ts/horde/`                                                                                                                                               | Browser model registry, durable profile records/resolver/UI state, and provider catalog helpers used by settings and generation preflight.                                                                                                                                                                                            |
| `src/ts/plugins/`                                                                                                                                                              | Browser plugin loading/runtime and Plugin V3 API host. Fastify stores plugin records but does not execute plugins.                                                                                                                                                                                                                    |
| `src/ts/process/mcp/`                                                                                                                                                          | Browser MCP clients, internal tools, Risu access tools, and plugin MCP clients.                                                                                                                                                                                                                                                       |
| `src/ts/media/`, `src/ts/parser/`, `src/ts/gui/`, `src/ts/setting/`, `src/ts/translator/`, `src/ts/network/`, `src/ts/kei/`, `src/ts/util/`                                    | Focused helper domains that feed visible UI and tests.                                                                                                                                                                                                                                                                                |
| `src/ts/stores.svelte.ts`, `src/ts/globalApi.svelte.ts`, `src/ts/characters.ts`, `src/ts/characterCards.ts`, `src/ts/characterFolderOpening.ts`, `src/ts/hotkey.ts`, `src/ts/lite.ts`, `src/ts/observer.svelte.ts` | Cross-cutting browser stores, compatibility helpers, character/card and folder-opening utilities, hotkeys, lite mode, and observers.                                                                                                                                                                   |

Retained compatibility and parity helpers still exist under `src/ts/process/`,
but they are not a selectable browser-local runtime. `src/ts/platform.ts`
hard-codes Fastify mode.

### Server-owned operation adapters

Browser code must use the fixed authenticated Fastify adapters when an operation
needs stored credentials or a server-owned upstream contract:

`src/ts/server/providerOperations.ts`, `embeddingOperations.ts`,
`imageGeneration.ts`, `openAITranscription.ts`, `tts.ts`, and
`mcpOAuthRefresh.ts` are the browser boundaries. `src/ts/process/tts.ts` also
cancels superseded/stopped requests and ignores late audio before playback.
Endpoint, credential, provider, limit, and result contracts belong in
[Providers And Models](../../docs/structure/providers-and-models.md#server-owned-provider-and-media-operations).

## Startup Sequence

`src/main.ts` installs the router, push-notification listeners, viewport/root
scroll coordinators, and shared completion-audio context unlocking before mounting
`App.svelte`. It then optionally installs the Fastify browser smoke hook, calls
`loadData()`, initializes hotkeys, and removes the preloading element.

`src/ts/startupReadiness.ts` owns the startup coordinator and measurement
timeline. It publishes a Svelte-readable snapshot plus `canRenderShell`,
`canApplyRoutes`, `canMutate`, `pluginsReady`, and `canGenerate` selectors,
attempt/failure diagnostics, and completed-step state. Successful startup steps
are retained across retries, so a plugin or later-runtime failure does not
repeat writer recovery, pending-mutation replay, resource loading, event
subscription, or another completed runtime step. `App.svelte`, commands, and
generation operations consume the narrow capabilities directly.

`loadData()` in `src/ts/bootstrap.ts` performs the visible startup work:

1. Adopt the sole pending-mutation writer identity, if one exists, then fetch
   `/api/v1/bootstrap`. If a different writer still has an identified event
   connection open, ask the new client whether to disconnect it before retrying
   with explicit takeover confirmation. The successful response supplies
   initialization, revision, database-lineage/writer metadata, generation
   operation/job projections, writer-scoped finalization/effect recovery, and
   message/greeting translation entries.
2. If bootstrap reports `initialized: false`, issue the initialization command.
   The server's transactional classifier accepts only genuinely empty state and
   rejects conflict state. The winning client reuses the returned revision;
   only a client that lost the initialization race refetches read-only bootstrap
   metadata.
3. Initialize the shared lineage/writer-scoped draft-recovery scope, then
   prepare the encrypted pending-mutation outbox for the authenticated writer
   epoch and database lineage, flush saved receipt acknowledgements, and replay
   its dependency-ordered commands. Secure contexts use a non-extractable
   WebCrypto key; plain-HTTP contexts use a separately stored raw AES key and
   the fallback cipher. Startup stops if retryable or unreadable rows remain.
4. Enable the compatibility resource write guard, then fetch
   `/api/v1/settings`, `/api/v1/collections`, the version 1 character
   summary projection at `/api/v1/characters`, and
   `/api/v1/inlay-assets` in parallel. The first three use hash-aware POSTs when
   IndexedDB/Web Crypto are available and otherwise fall back to full GETs.
   Character summaries use a protocol-versioned cache namespace and exact
   shared validation before becoming marker-bearing list shells. Retry all four
   when revisions do not match, then apply the consistent set.
5. Seed selected-character state only when the persisted character is visible
   as the selected character, reset body hydration, record
   already-resident lorebook coverage, and hydrate the selected prompt-template
   owner before caching the common resource revision. Start bounded selected
   character-detail hydration after that revision is installed. While a summary
   shell remains selected, the chat screen shows localized loading/retry state
   and does not mount detail-only controls.
6. Install the authoritative revision cursors and command reconciliation, apply
   the root shell's visual settings, and publish `observer-ready`.
7. Seed generation operations/jobs, writer-scoped generation-finalization and
   pending-effect state, and separate message/greeting translation recovery;
   then start operation reconciliation, effect recovery, refreshers, and live
   runner reattach.
8. Start chat-message hydration and bridge patch lifecycle flushing, then
   subscribe to server events from the coherently applied resource revision.
   A successful subscription publishes `writer-ready`, which makes the shell,
   ordinary commands, and persistence-capable route effects available.
9. Initialize the push coordinator and reconcile both enabled and disabled
   notification states.
10. Load plugins and start plugin runtime synchronization.
11. Reconcile recovered generation effects, then hydrate the selected character
    detail and active chat. Publish `chat-ready`; `canGenerate` becomes true only
    when these dependencies are coherent. Selection changes rerun fenced
    hydration, and a specific character/chat failure remains localized.
12. Update error handling and show one-time nightly or insecure-origin warnings.
    Set the background-compatibility `loadedStore`, reselect the persisted
    character, install store/module effects and DOM observers, register dynamic
    models, and publish `background-ready`. RisuRealm terms are requested only
    at the Realm download boundary.

`loadedStore` no longer controls visible rendering or route application. It is a
temporary background-readiness compatibility alias for the bootstrap loop,
notification reconciliation, and browser-smoke helpers. Remove it after those
callers use explicit `background-ready` state; do not add new consumers.
Visible startup bugs often sit at the boundary between coordinator
capabilities, `selectedCharID`, resource application, route application, lazy
body reads, and CSS variable updates.

## Server Resources And Durable Mutations

The browser composes its compatibility projection from settings, collections,
and characters in `src/ts/server/resourceState.svelte.ts`; the inlay catalog in
`src/ts/server/inlayCatalog.ts` is a fourth, standalone root projection. Large
chat, lorebook, legacy-preset, and prompt-template bodies hydrate only when a
workflow needs them. The authoritative-state invariant is canonical in
[Project Structure](../../STRUCTURE.md#repository-wide-invariants), while
[Server Resources And Bridges](../../docs/structure/server-resources-and-bridges.md)
owns the endpoint, cache, hydration, invalidation, and durable-mutation
contracts.

The compatibility facade keeps a stable proxy identity, but `getDatabase()` no
longer subscribes callers to an implicit whole-database epoch. Reactive callers
track the settings, collection, character, chat, and message fields they
actually read. The explicit `getResourceDatabaseFacadeEpoch()` accessor remains
available for diagnostics or compatibility observers that intentionally need
an any-resource signal. A trusted write to one background chat must therefore
not wake a mounted transcript for another chat.

The main client boundaries are:

| Path                                                                                                                                   | Responsibility                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/ts/server/resourceReads.ts`, `resourceCache.ts`                                                                                   | Root/targeted reads and the disposable authenticated-hash cache.            |
| `src/ts/server/hydrationReads.ts`, `chatMessageHydration.svelte.ts`, `characterShellHydration.svelte.ts`, `promptTemplateHydration.ts` | Lazy owner-body and shell hydration.                                        |
| `src/ts/server/commands.ts`, `events.ts`, `resourceInvalidation.ts`, `resourceRefresh.ts`                                              | Serialized commands, SSE reconciliation, targeted reads, and full recovery. |
| `src/ts/server/pendingMutationOutbox.ts`, `durableMutationDispatch.ts`, `pendingMutationReplay.ts`                                     | Encrypted crash-recovery intents and pre-hydration replay.                  |
| `src/ts/server/greetingTranslations.svelte.ts`                                                                                         | Character-scoped greeting projection, refresh, manual translation, and job recovery. |
| `src/ts/server/resourceWriteGuard.svelte.ts`                                                                                           | Guards direct writes to the compatibility view.                             |
| `src/ts/server/*Bridge.svelte.ts`                                                                                                      | Converts compatibility/UI mutations into command-backed writes.             |

If a component shows stale or missing data, confirm whether the data is:

- absent from the settings/collections/characters/inlay-catalog response by design;
- waiting on a chat, lorebook, character row, legacy preset, or prompt-template
  endpoint;
- hidden by a route/store condition;
- optimistically changed but awaiting command confirmation;
- retained for replay after a retryable command failure, or rolled back after a
  terminal/non-durable failure;
- superseded by an SSE-triggered targeted read or full resource refresh.

Chat/message compatibility writes in `src/ts/chatCommands.ts` classify a list
change into the narrowest safe command: append, single-message update, prefix
truncate, single delete, or tail replacement after a known persisted anchor.
Fully hydrated incompatible edits can fall back to full replacement, but a
placeholder-bearing transcript is not broadly replaced. At send time,
`src/ts/process/sendChatContext.ts` assigns ids locally to missing rows in a
fully loaded transcript, but persists those backfilled ids only when they form a
contiguous suffix following a persisted anchor. Other shapes remain local for
that send.

Mutation-facing UI must consume the helper outcome instead of assuming that an
awaited dispatch means success. `queued` is retained local intent, not server
acceptance; keep the user's newer draft and surface `accepted`, `queued`, or
`failed` without prematurely closing the surface.

`src/ts/server/persistenceActivity.svelte.ts` aggregates in-flight mutations
and this writer's unacknowledged outbox rows. `SavePopupIcon.svelte` displays
that shared state when the retained `showSavingIcon` preference permits it.
Individual controls keep their disabled/busy state and failure feedback, while
queued outcomes use the shared indicator and notification flow instead of
mounting transient status rows throughout the UI.

### All-Chats Export Fence

The destructive reset coordinator is fenced to the exact transcript state that
was exported. `exportAllChats()` strictly hydrates every chat, serializes the
download, and returns a fence containing the chat set, each message count, and
the final message id and serialized-message hash. After both confirmations,
`src/lib/SideBars/SideChatList.svelte` calls
`matchesAllChatsExportFence()` against live state; any mismatch aborts before
`dispatchResetChatsWithOutcome()` applies its optimistic replacement.
User-facing export/reset semantics belong in
[Assets And Saves](../../docs/structure/assets-and-saves.md#chats-and-datasets),
and the controls belong in [Svelte Navigation UI](svelte-navigation-ui.md).

### Loadout Apply Sequencing

`src/ts/loadout.ts` applies selected loadout scopes only after flushing pending
owner writes. It fences the target, runs the required durable commands as one
ordered sequence, and rolls back or reapplies still-owned projections according
to accepted, queued, or failed outcomes;
`src/ts/server/loadoutCanonical.ts` validates canonical response state.
`characterIds` records recent character use only: applying a loadout does not
select or navigate to a character. Guards are `src/ts/loadout.test.ts` and
`src/lib/Others/LoadoutModal.svelte.test.ts`. The shared queue/outcome contract
is owned by
[Server Resources And Bridges](../../docs/structure/server-resources-and-bridges.md#durable-mutation-recovery-command-queue-and-local-acknowledgements).

## Draft Recovery Stores

Editing recovery is deliberately separate from the pending-mutation outbox.
These records are scoped to the current database lineage and writer session;
they are drafts, not durable commands, server receipts, or proof of acceptance.

- `DefaultChatScreen.composerDrafts.ts` keeps the five composer fields per
  transcript in `sessionStorage`. Records survive reload, use generation-fenced
  clearing, and are bounded to 50 entries, seven days, 256 KiB per record, and
  2 MiB total.
- `src/ts/server/moduleEditorDraftStore.ts` keeps module-editor drafts in a
  separate AES-GCM IndexedDB store. It is bounded to 20 records, 30 days,
  16 MiB per record, and 64 MiB total. `ModuleSettings.svelte` rebases a restored
  draft onto current canonical state and offers copy/export/discard recovery when
  the target disappeared.

Only an accepted save for the exact draft generation clears its recovery row.
Queued, failed, or superseded work remains available so newer edits are not
discarded.

## Async Freshness And Import Guards

`src/ts/server/staleStateGuards.ts` is the shared helper for browser async work
that must not apply after the user changes selection, resource refreshes, or a
newer operation supersedes it. It provides latest-operation tokens,
destructive-refresh epochs, attempted-field/list rollback helpers, and dirty
draft merge helpers used by command bridges and UI import flows.

Specialized guards under `src/ts/server/` cover current import and fetch
surfaces:

- `biasImport.ts`, `colorSchemeImport.ts`, `naiVibeImport.ts`, and
  `seperateParametersImport.ts` parse imported JSON and apply it only when the
  selected prompt preset, display scheme, provider/model context, or parameter
  slot still matches the captured snapshot.
- `nanoGPTDashboardFetch.ts` prevents stale NanoGPT balance/subscription fetches
  from persisting subscription state after the API key changes.
- `characterAdditionalAssetUpload.ts`, `characterEmotionUpload.ts`,
  `characterFolderImageUpload.ts`, `characterNotificationImageUpload.ts`,
  `characterTtsAssetUpload.ts`,
  `moduleAssetUpload.ts`, `personaIconUpload.ts`, `promptPresetIconUpload.ts`,
  and `settingsMediaAssetUpload.ts` apply uploaded asset ids only if the current
  owner and field snapshots still match.

These guards are client-side freshness checks. Server persistence still happens
through asset upload routes, command helpers, or settings patches after the
freshness check passes.

## Push Notification Coordinator

The notification setting is a serialized device/server transaction owned by
`src/ts/server/pushNotificationSetting.ts`. It registers or removes browser and
server subscriptions through `src/ts/server/pushNotifications.ts`; failed setup
compensates the durable setting back to disabled. Unresolved cleanup endpoints
and local-subscription-inspection state persist in IndexedDB through
`src/ts/server/pushNotificationRetryStorage.ts`, then hydrate and retry after
reload. `public/service-worker.js` owns notification display plus the
focus/open and message/ack handshake. A mounted app routes in place through
`src/ts/server/pushNotifications.ts`; service-worker navigation/openWindow are
fallbacks when no client acknowledges. On initial load and whenever the app
returns to the foreground, the browser coordinator also closes chat-completion
notifications from the current device's service-worker registration.

The guard set is `src/ts/server/pushNotificationSetting.test.ts`,
`src/ts/server/pushNotificationRetryStorage.test.ts`,
`src/ts/server/pushNotifications.test.ts`,
`src/ts/server/serviceWorker.test.ts`, and
`src/lib/Setting/Pages/Display/NotificationToggle.svelte.test.ts`. The visible
states belong in [Svelte Settings UI](svelte-settings-ui.md); server
subscription persistence remains in
[Backend Map](../../docs/structure/backend.md#route-family-index).

## Active Writer Loss

`src/ts/server/activeWriterSession.ts` owns the browser response to another
session taking the single-writer lease. A live `writer` SSE frame, or a
validated `423 active_writer_stale` response, latches writer loss immediately,
blocks new mutations, stops resource events, chat hydration, translation
refresh, and generation reattach, then asks the user to refresh or stay
offline. Refresh retakes ownership through normal bootstrap. Staying offline
freezes editable controls and adds a reload banner while leaving text
selectable for recovery.

Before that handoff, the event stream carries the browser's writer session so
the server can tell whether the current writer is still connected. A new client
must confirm the `409 active_writer_connected` bootstrap response before the
server changes ownership; a durable owner with no live event connection is
reclaimed without prompting.

This flow is different from database-lineage and pending-mutation recovery
failures, which still force a reload. When a mounted app suddenly stops all
network work, inspect `activeWriterSession.ts`, `events.ts`, and the writer-loss
styles in `src/styles.css` before treating each caller as independently broken.

## Generation Client

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
  compatibility path when the server does not advertise this protocol.
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
  re-arms the exact live attempt and can retire its old browser viewer without
  issuing Stop. Absent jobs are cleared only after strict transcript hydration;
  pending finalization/effect recovery comes from the same bootstrap snapshot.
  `generationJobLifecycles` records attached, retrying, exhausted-dead,
  completed, and cancelled observer state plus the last transport error. Retry,
  Refresh, and Stop resolve a stale control through its recorded operation/chat
  lineage to the current exact authority.
- `src/ts/process/generationEffectLedger.ts` claims and receipts client effects
  for the exact persisted generation. `recoveredGenerationEffects.ts` retries
  missing durable effects after bootstrap; late ephemeral effects are skipped.

Before prompt assembly or provider fetch, `sendChat` awaits the character-owned
maintenance batch from `sendChatContext.ts`, the pending chat generation-settings
save, and the pending selected-persona update. A rejected/retained persistence
gate aborts the send before server assembly. For “send never reached fetch,”
inspect `setupSendChatContext`, `waitForPendingChatGenerationSettingsSave`, and
`flushPendingSelectedPersonaUpdate` before debugging the provider adapter.

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
`messageCompletionSound.ts` lazily shares one decoded bundled-audio buffer and
`AudioContext`. `installCompletionAudioUnlock()` resumes and prepares that
context from an eligible pointer or keyboard activation without starting an
audio source, then suspends it while idle. Each actual generation- or
translation-completion ding uses a disposable `AudioBufferSourceNode`; ended or
superseded nodes are disconnected and the context is suspended again. Browsers
without Web Audio construct an `HTMLAudioElement` only for actual playback and
unload it afterward. Web Push remains the independent background-notification
path and is not enabled by completion-audio settings.

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

Provider/profile resolution is canonical in
[Providers And Models](../../docs/structure/providers-and-models.md), prompt
construction in
[Prompt Assembly And Scripting](../../docs/structure/prompt-assembly-and-scripting.md),
and Agent execution in
[Agents And Presets](../../docs/structure/agents-and-presets.md).

When generation UI is wrong, inspect both the Svelte surface
`src/lib/ChatScreens/DefaultChatScreen.svelte` and the runtime files above. Its
visible ownership is documented in [Svelte Chat UI](svelte-chat-ui.md).

## Intermediate Display Bridge

Before final markup rendering, `ParseMarkdown()` keeps its first browser asset
pass and asks the negotiated display-source bridge to perform only the
intermediate `editdisplay` stages. `src/ts/server/displaySources.ts` batches
same-chat mounted rows, reports an ephemeral page id plus language and viewport,
and fences each result by request key, source hash, context fingerprint, target
identity, and projection epoch. `ChatBodyParseMemo` remains above this bridge,
so a browser memo hit performs no request and the existing last-good body stays
visible while a replacement is pending. Because a Lua display hook may persist
chat scriptstate, each complete display batch shares the global command revision
lane and ingests every chunk response revision before later mutations dispatch.

The full client `processScriptFull` path remains the correctness fallback for
browser edit hooks, unsupported fuzzy dynamic assets, missing protocol support,
stale writer/revision/context, and network failure. Growing generation prefixes
are marked as streaming: pending duplicate prefixes coalesce and server results
bypass the shared stable-row LRU. Final Markdown, CSS scoping, DOMPurify, blob
URLs, metadata, and DOM activation remain browser-owned.

## Rendered Markup Sanitization

The normal `ParseMarkdown()` path in `src/ts/parser/parser.svelte.ts` encodes
style blocks before Markdown rendering, then `trimMarkdown()` sanitizes the
rendered markup. Because `decodeStyle()` can reintroduce decoded CSS/markup, a
changed decoded result is passed through `DOMPurify.sanitize()` again with
`FORCE_BODY: true` before the string is returned for rendering. Keep this
second pass when changing the parser; the first sanitation pass alone does not
cover decoded output.

## Adjacent Runtime Owners

| Topic                                                        | Browser entrypoints                                                                                                           | Canonical guide                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Assets, inlay catalog, saves, backups, Realm, legacy storage | `src/ts/server/assets.ts`, `inlayCatalog.ts`, `backups.ts`, `realmImport.ts`; `src/ts/storage/backup.ts`, `fastifyStorage.ts` | [Assets And Saves](../../docs/structure/assets-and-saves.md)                       |
| Plugins, modules, MCP                                        | `src/ts/plugins/`, `src/ts/moduleIntegration.ts`, `src/ts/process/modules.ts`, `src/ts/process/mcp/`                          | [Plugins And MCP](../../docs/structure/plugins-and-mcp.md)                         |
| Providers, prompt assembly, and Agents                       | `src/ts/model/`, `src/ts/process/request/`, `src/ts/process/promptAssembly/`                                                  | [Providers And Models](../../docs/structure/providers-and-models.md), [Prompt Assembly And Scripting](../../docs/structure/prompt-assembly-and-scripting.md), [Agents And Presets](../../docs/structure/agents-and-presets.md) |
| Retired/browser-local surfaces                               | `src/ts/platform.ts`                                                                                                          | [Generated Files And Legacy Caveats](../../docs/structure/generated-and-legacy.md) |

`src/ts/moduleIntegration.ts` parses and deduplicates the
comma-separated module references shared by prompt and Agent Presets.
`src/ts/process/modules.ts` combines the effective prompt-preset and Agent
Preset references with global, chat, and character module selections; the
reactive signature in `src/ts/stores.svelte.ts` reruns `moduleUpdate()` when
either preset selection or integration field changes. Prompt and Agent
precedence stays in the focused guides linked above.

## Runtime Risks For UI Work

- Direct compatibility-view mutation can fail under the resource write guard or
  be lost on a later REST refresh. Use command helpers or bridge utilities.
- Character resources intentionally provide message-free chat rows and can
  provide lorebook stubs. Active chat messages and lorebooks hydrate later from
  their concrete endpoints.
- Route effects run only while `canApplyRoutes`; writer loss leaves the coherent
  shell readable but prevents route-owned persistent selection changes.
- CSS variables are applied before the conservative `writer-ready` shell
  boundary. A theme bug may
  be runtime state, not component markup.
- Plugins can add visible menu items and buttons. Check plugin stores before
  assuming a component owns every visible control.
- Full-stack visible bugs often need `pnpm dev:agent` or browser smoke because
  unit tests with fetch mocks can miss auth, SSE, resource refresh, and asset URL
  wiring.

## Verification Pointers

Use the smallest command that covers the touched area. The lane semantics and
full matrix are in
[Testing And Operations](../../docs/structure/testing-and-operations.md#tests-and-checks).

```sh
pnpm check
pnpm test
pnpm test:gates
pnpm coverage:ui-map
pnpm smoke:fastify-browser
```

For the client declaration, server, and browser-smoke TypeScript lane:

```sh
pnpm check:server
```
