# Client Runtime Guide

Last audited: 2026-08-27.

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

`src/main.ts` is the thin entry boundary. It records the entry milestone,
installs required baseline globals/polyfills through `src/ts/polyfill.ts`, and
uses `src/ts/entryStartup.ts` to dynamically import `src/appStartup.ts`. Entry
or preload failures stay on the localized preloader/reload surface owned by
`src/ts/entryLoadError.ts`.

`src/appStartup.ts` installs the router, push-notification listeners,
viewport/root-scroll coordinators, and shared completion-audio context unlocking
before mounting `App.svelte`. It then optionally installs the Fastify browser
smoke hook, calls `loadData()`, initializes hotkeys and likely-route warming,
and removes the preloading element.

`src/ts/startupReadiness.ts` owns the startup coordinator and measurement
timeline. It publishes a Svelte-readable snapshot plus `canRenderShell`,
`canApplyRoutes`, `canMutate`, `pluginsReady`, and `canGenerate` selectors,
attempt/failure diagnostics, and completed-step state. Successful startup steps
are retained across retries, so a plugin or later-runtime failure does not
repeat writer recovery, pending-mutation replay, resource loading, event
subscription, or another completed runtime step. `App.svelte`, commands, and
generation operations consume the narrow capabilities directly.

`loadData()` in `src/ts/bootstrap.ts` performs the visible startup work:

1. Start the best-effort startup telemetry publisher. If the temporary observer
   rollout is enabled, perform a read-only bootstrap without caching its
   revision as command authority, install the resource write guard, and load
   `GET /api/v1/resources/shell`. A coherent initialized shell may publish
   `observer-ready` and render the dedicated read-only observer UI while writer
   acquisition continues. A failed or uninitialized observer read falls back to
   the conservative writer-first boundary.
2. Adopt the sole pending-mutation writer identity, if one exists, then fetch
   writer-intent `/api/v1/bootstrap`. If a different writer still has an
   identified event connection open, ask whether to disconnect it before
   retrying with explicit takeover confirmation. The successful response
   supplies initialization, revision, database-lineage/writer metadata,
   generation/display-source protocol projections, operation/job projections,
   writer-scoped finalization/effect recovery, translation entries, and the
   optional startup-telemetry configuration.
3. If bootstrap reports `initialized: false`, issue the initialization command.
   The server's transactional classifier accepts only genuinely empty state and
   rejects conflict state. The winning client reuses the returned revision;
   only a client that lost the initialization race refetches read-only bootstrap
   metadata.
4. Initialize the shared lineage/writer-scoped draft-recovery scope, then
   prepare the encrypted pending-mutation outbox for the authenticated writer
   epoch and database lineage, flush saved receipt acknowledgements, and replay
   its dependency-ordered commands. Secure contexts use a non-extractable
   WebCrypto key; plain-HTTP contexts use a separately stored raw AES key and
   the fallback cipher. Startup stops if retryable or unreadable rows remain.
5. Load `GET /api/v1/resources/shell` into the explicit settings and character
   owners. The exact version-1 response contains one
   revision, allowlisted initial visual/account/sidebar settings, and the
   versioned character-summary projection at that same revision. It excludes
   collections, provider credentials, selected detail, prompt bodies, chats,
   and inlays. When an observer projection was already visible, this post-replay
   read must replace it at an equal or newer revision.
6. Seed selected-character identity from the summary projection, reset body and
   lorebook hydration, install the known-server and applied-event revision
   cursors, configure command reconciliation, apply the shell's visual settings,
   and publish `observer-ready` if the earlier optional path did not already do
   so. Marker-bearing summaries remain distinct from full character rows.
7. Seed generation operations/jobs, writer-scoped generation-finalization and
   pending-effect state, and separate message/greeting translation recovery;
   install owner-mutation lifecycle flushing and the hydration runtimes, then subscribe to server
   events from the coherently applied shell revision. Only an accepted
   subscription publishes `writer-ready`, which makes ordinary commands and
   persistence-capable route effects available. The shell was already visible
   only when the observer rollout permitted it.
8. Route application resolves `RESOURCE_SURFACE_MANIFEST` and loads the current
   route's settings groups, collections, standalone settings, selected detail,
   chat, and prompt owner through `routeResourceLoader.ts`. A newer navigation
   aborts the older generation, compatible concurrent requirements share one
   request, and failure remains local to a route Retry surface.
9. Initialize the push coordinator and reconcile both enabled and disabled
   notification states.
10. Load plugins and start plugin runtime synchronization.
11. Reconcile recovered generation effects, then hydrate the selected character
    detail, active chat, and selected prompt owner declared by the chat-generation
    runtime surface. Publish `chat-ready`; `canGenerate` becomes true only when
    these dependencies and plugins are coherent. Selection changes rerun fenced
    hydration, and a specific character/chat failure remains localized.
12. Update error handling and show one-time nightly or insecure-origin warnings.
    Reselect the persisted character, install store/module effects and DOM
    observers, register dynamic models, reconcile the projected notification
    state, and publish `background-ready`. RisuRealm terms are requested only at
    the Realm download boundary.

`backgroundReady()` is the coordinator-owned completion selector for optional
startup work. It consumes the semantic signal rather than the ordered telemetry
phase, so a localized earlier optional-capability failure cannot keep the
bootstrap loop open. It is not a visible-rendering or route-application gate;
those consumers continue to use `canRenderShell` and `canApplyRoutes`.
Visible startup bugs often sit at the boundary between coordinator
capabilities, `selectedCharID`, resource application, route application, lazy
body reads, and CSS variable updates.

The observer flag changes only when `canRenderShell` may open. It never relaxes
`canApplyRoutes`, `canMutate`, or `canGenerate`. During takeover denial or a
writer/bootstrap failure, an authenticated observer remains usable with a
targeted Retry action. A retry shares one promotion attempt, resumes unfinished
writer steps, applies the post-replay shell, installs events, and only then
restores writer capability. A foreign writer event revokes writer capabilities
immediately; with the flag enabled the UI returns to observer state instead of
blanking the authenticated shell. Authentication loss clears the observer
projection and intent, while lineage replacement fences and replaces it.

## Server Resources And Durable Mutations

The browser composes its compatibility projection from settings, collections,
and characters in `src/ts/server/resourceState.svelte.ts`; the inlay catalog in
`src/ts/server/inlayCatalog.ts` is a fourth, standalone root projection. Large
chat, lorebook, legacy-preset, and prompt-template bodies hydrate only when a
workflow needs them. The authoritative-state invariant is canonical in
[Project Structure](../../STRUCTURE.md#repository-wide-invariants), while
[Server Resources And Hydration](../../docs/structure/server-resources-and-bridges.md)
owns endpoint, cache, and hydration contracts. Event reconciliation, the
mutation queue, and durable outbox behavior belong in
[Durable Mutations And Recovery](../../docs/structure/durable-mutations-and-recovery.md).

The compatibility facade keeps a stable proxy identity, but `getDatabase()` has
no whole-database epoch. Reactive callers track the settings, collection,
character, chat, and message fields they actually read. A scoped compatibility
write to one background chat must therefore not wake a mounted transcript for
another chat.

The main client boundaries are:

| Path                                                                                                                                   | Responsibility                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/ts/server/resourceReads.ts`, `resourceCache.ts`                                                                                   | Root/targeted reads and the disposable authenticated-hash cache.            |
| `src/ts/server/shellHydration.ts`, `resourceManifest.ts`, `routeResourceLoader.ts`                                                     | Atomic root shell application and manifest-driven route/runtime resources.  |
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
[Durable Mutations And Recovery](../../docs/structure/durable-mutations-and-recovery.md#durable-mutation-recovery-command-queue-and-local-acknowledgements).

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

Durable send/continue/regenerate acceptance, streaming, cancellation, reattach,
terminal reconciliation, effect delivery, half-streaming, and completion audio
moved to the focused [Generation Client](generation-client.md) guide. Keep
startup, resources, drafts, writer loss, and adjacent runtime ownership here.

## Intermediate Display Bridge

Before final markup rendering, `ParseMarkdown()` keeps its first browser asset
pass and asks the negotiated display-source bridge to perform only the
intermediate `editdisplay` stages. `src/ts/server/displaySources.ts` batches
same-chat mounted rows, reports an ephemeral page id plus language and viewport,
and fences each result by request key, source hash, context fingerprint, target
identity, and projection epoch. `ChatBodyParseMemo` remains above this bridge,
so a browser memo hit performs no request and the existing last-good body stays
visible while a replacement is pending. Server-side Lua display state is
isolated per target: writes may influence the remainder of that target's
intermediate transform, but are discarded before another target runs and never
become chat authority. The current bridge still shares the global command
revision lane to fence each batch against its requested base revision and
ingests every chunk response revision before later mutations dispatch.

Batch scheduling registers same-namespace work before source and context hashes
settle, then waits for all registered preparations before starting the
zero-delay flush. Digest completion order therefore cannot split concurrently
requested same-chat rows into separate revision-lane operations.

Initial transcript mounting assigns the newest two messages critical priority
and the remaining mounted window background priority. The bridge sends the
critical group first and releases its parse/readiness promises before yielding
and entering the background group into the revision lane; targets inside either
group remain serialized because their execution budgets and runtime scope are
mutable. Changing the visible chat resolves queued obsolete work and aborts its
in-flight fetch. Fastify converts that disconnect into an `AbortSignal` for the
display stages, so an old chat cannot keep the new chat queued behind a full
transform batch.

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

Agents use the focused runner only when one exact test or one source file can
answer a concrete implementation question. The user/CI-owned full matrix is in
[Testing And Operations](../../docs/structure/testing-and-operations.md#tests-and-checks).

```sh
pnpm test -- <test-or-source-file>
```

For the protocol/shared-core architecture checks and the independent server and
browser-smoke TypeScript projects:

```sh
pnpm check:server
```
