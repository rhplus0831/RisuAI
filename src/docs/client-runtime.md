# Client Runtime Guide

Last audited: 2026-08-09.

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

`src/main.ts` installs the router, push-notification navigation listener, and
document-root viewport scroll guard before mounting `App.svelte`. It then
optionally installs the Fastify browser smoke hook, calls `loadData()`,
initializes hotkeys, and removes the preloading element.

`loadData()` in `src/ts/bootstrap.ts` performs the visible startup work:

1. Adopt the sole pending-mutation writer identity, if one exists, then fetch
   `/api/v1/bootstrap` for initialization, revision, database-lineage/writer
   metadata, active generation jobs, and message/greeting translation recovery
   entries.
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
4. Fetch `/api/v1/settings`, `/api/v1/collections`, `/api/v1/characters`, and
   `/api/v1/inlay-assets` in parallel. The first three use hash-aware POSTs when
   IndexedDB/Web Crypto are available and otherwise fall back to full GETs.
   Retry all four when revisions do not match, then apply the consistent set.
5. Seed selected-character state only when the persisted character is visible
   as the selected character, reset body hydration, record
   already-resident lorebook coverage, and hydrate the selected prompt-template
   owner before caching the common resource revision.
6. Enable guarded resource writes and command-event reconciliation.
7. Seed active generation jobs and separate message/greeting translation
   recovery state, then start both translation refreshers and durable generation
   reattach.
8. Start chat-message hydration, fetch the active chat body, start bridge patch
   lifecycle flushing, and subscribe to server events.
9. Initialize the push coordinator and reconcile both enabled and disabled
   notification states.
10. Load plugins and start plugin runtime synchronization.
11. Update color scheme, text theme, reduced-motion/animation state, height mode, error
    handling, and GUI size CSS variables.
12. Show the one-time insecure-origin warning when the page lacks a secure
    context, then apply startup UI state such as `botSettingAtStart`.
13. Set `loadedStore`, select the persisted character, start DOM observers,
    register dynamic models, and run module update. RisuRealm terms are requested only at the Realm download boundary.

Visible startup bugs often sit at the boundary between `loadedStore`,
`selectedCharID`, resource application, route application, lazy body reads, and
CSS variable updates.

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

This flow is different from database-lineage and pending-mutation recovery
failures, which still force a reload. When a mounted app suddenly stops all
network work, inspect `activeWriterSession.ts`, `events.ts`, and the writer-loss
styles in `src/styles.css` before treating each caller as independently broken.

## Generation Client

`sendChat` in `src/ts/process/index.svelte.ts` is the browser coordinator for
chat generation UI. In Fastify mode it uses server prompt assembly and server
provider dispatch.

Important files:

- `src/ts/process/index.svelte.ts` owns `doingChat`, `chatProcessStage`,
  active abort controller state, and the high-level `sendChat` coordinator used
  by `DefaultChatScreen.svelte`.
- `src/ts/process/request/providerCapability.ts` and
  `src/ts/process/request/serverPromptAssembly.ts` decide whether the selected
  request can run on the server.
- `src/ts/process/serverBackedSendChat.ts` builds server requests, maps legacy
  inlay ids to server asset refs, calls `/api/v1/generate/chat` or the preview
  route, applies server message patches, and returns terminal data.
- `src/ts/process/request/serverChat.ts` parses chat SSE frames:
  `job_accepted`, stage, prompt, patch, info, token, side-effect,
  `agent_preset_progress`, `post_generation_progress`, warning, error, and
  done. It updates the scoped progress stores consumed by
  `AgentPresetProgress.svelte` and `PostGenerationScriptProgress.svelte`.
- `src/ts/process/halfStreamingProgress.ts` owns half-streaming token counts and
  throughput for the active character/chat/generation target.
- `src/ts/process/reattach.ts` uses bootstrap `activeGenerationJobs`, including
  job mode and regenerate target when present, to reattach the current chat to
  durable server jobs.

Before prompt assembly or provider fetch, `sendChat` awaits the character-owned
maintenance batch from `sendChatContext.ts`, the pending chat generation-settings
save, and the pending selected-persona update. A rejected/retained persistence
gate aborts the send before server assembly. For “send never reached fetch,”
inspect `setupSendChatContext`, `waitForPendingChatGenerationSettingsSave`, and
`flushPendingSelectedPersonaUpdate` before debugging the provider adapter.

Durable sends such as send, continue, and regenerate set `durable: true` when
allowed. Disconnect detaches from durable jobs; abort/cancel uses the durable
DELETE path when a job exists. The live adapter retains the accepted job id and
boundedly reattaches after an unrequested SSE EOF/read failure, rebuilding
replayed token deltas from zero and deduplicating replayed non-token effects.
Foreground, page-show, and online lifecycle probes refresh bootstrap job
metadata so a mounted mobile tab can recover even when its original connection
was discarded before the id reached JavaScript. Terminal `postGeneration` data
can advance the revision cache, apply a server-owned `messagePatch`, render the
inlay screen over `finalText`, request `resendChat`, or surface an Agent Preset
error as a failed terminal result. Generation results are persisted server-side,
so the browser suppresses the old generation-result command in server-backed
paths.

When an `info` frame carries `halfStreaming: true`,
`src/ts/process/request/serverChat.ts` marks the stream as half-streaming and
buffers provider text in `tokenResult` instead of enqueueing it into the visible
stream. Progress remains live through `src/ts/process/halfStreamingProgress.ts`:
token frames use cumulative server-tokenized `generatedTokens` and
provider-dispatch `elapsedMs` when present, preserving throughput across
gateway-batched chunks, with frame counting as the older server fallback. The
buffered text is enqueued once on `done`.

Generation persistence failures also carry a browser reconciliation contract.
A terminal `persistenceDisposition: rejected` clears the provisional
persistence marker, removes or restores only the still-owned streamed
projection, and force-hydrates the chat. A retryable `queued` disposition keeps
the provisional generation marked until an authoritative chat hydration
contains it. Conflicting post-generation script mutations arrive as warning
frames but do not erase successfully persisted generated message text.

Provider/profile resolution is canonical in
[Providers And Models](../../docs/structure/providers-and-models.md), prompt
construction in
[Prompt Assembly And Scripting](../../docs/structure/prompt-assembly-and-scripting.md),
and Agent execution in
[Agents And Presets](../../docs/structure/agents-and-presets.md).

When generation UI is wrong, inspect both the Svelte surface
`src/lib/ChatScreens/DefaultChatScreen.svelte` and the runtime files above. Its
visible ownership is documented in [Svelte Chat UI](svelte-chat-ui.md).

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
- Route effects run only after `loadedStore`; a pre-load store write may not
  mean the URL or visible shell has caught up.
- CSS variables are applied after resources and settings load. A theme bug may
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
