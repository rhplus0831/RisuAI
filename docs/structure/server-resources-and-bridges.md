# Server Resources And Bridges

Last audited: 2026-07-20.

Fastify owns durable state. The browser reads concrete REST resources into
Svelte-owned settings, collections, and characters state plus a standalone
inlay-catalog projection, fetches large bodies only when needed, and routes
persistent edits through command helpers or explicit server-owned mutation
routes.

## Bootstrap And Initial Resources

`src/ts/bootstrap.ts` coordinates startup:

- Before writer-intent bootstrap, startup reads any single unambiguous pending
  mutation owner and can adopt that writer session so recoverable local work is
  not orphaned by a new browser session.
- `fetchServerBootstrap()` sends writer intent to `GET /api/v1/bootstrap`.
  Bootstrap is deliberately runtime-only metadata: initialization state,
  revision/schema version, database lineage, durable writer epoch, the
  pre-takeover writer verdict, asset base URL, running generation jobs, and
  active message translations. It does not carry durable application data.
- Empty state triggers `POST /api/v1/commands/state/initialize`. The winning
  client reuses the runtime metadata and accepted revision it already has; a
  read-only bootstrap retry is needed only when another client won the
  initialization race.
- After bootstrap/initialization, startup prepares the mutation outbox against
  the writer session and database lineage, flushes its durable server-receipt
  acknowledgements, and replays pending intents. Same-session rows survive a
  writer-epoch reclaim. Transient and genuine stale-writer failures retain their
  encrypted intents; conclusive request, lineage, receipt-id, and malformed
  permanent-status failures discard them only with an explicit user-visible
  notice. Any retained or unreadable raw row blocks root-resource hydration so
  unresolved local work is not hidden by fresh reads.
- `loadInitialServerResources()` concurrently reads settings, collections, and
  characters through their hash-aware POST resources (with compatible full GET
  fallback), plus `/api/v1/inlay-assets`. All four responses must report one
  common revision. Concurrent writes that split the revisions cause the
  complete read set to retry, up to `FULL_RESOURCE_REFRESH_MAX_ATTEMPTS`.
- The consistent response set is applied through one trusted resource scope.
  The settings, collections, and characters state objects keep their own
  revision/status/error metadata. The character list contains message-free chat
  rows; chat bodies remain lazy.
- The collection response carries prompt-preset and legacy bot-preset shells.
  Startup hydrates the selected modern prompt-template owner separately before
  enabling normal command/event reconciliation; legacy preset bodies remain
  on-demand.
- Startup seeds the known-server and applied-resource revision cursors, enables
  the resource write guard, records runtime jobs, starts active-generation and
  active-translation recovery, starts active-chat hydration, installs the
  bridge lifecycle flush, and subscribes to `/api/v1/events`.
- Command success reconciliation and foreign SSE events both flow through the
  same serialized resource path. Contiguous response-confirmed optimistic
  effects can advance their resource fences without a read; authoritative reads
  still apply in command-event order for every other event.

| Path                                              | Role                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/ts/server/bootstrap.ts`                      | Validates the small runtime bootstrap and exposes writer-intent/read-only variants.                                                  |
| `src/ts/server/resourceReads.ts`                  | Browser wrappers and response validation for settings, collections, characters, and the inlay catalog.                               |
| `src/ts/server/resourceCache.ts`                  | Disposable, non-authoritative SHA-256 manifests and verified IndexedDB values used only after authenticated hash confirmation.       |
| `src/ts/server/pendingMutationOutbox.ts`          | AES-GCM-encrypted intent payloads plus plaintext scope/order indexes and durable receipt-acknowledgement rows.                       |
| `src/ts/server/durableMutationDispatch.ts`        | Persists an intent before dispatch, classifies replay outcomes, and completes accepted intents before acknowledging server receipts. |
| `src/ts/server/pendingMutationReplay.ts`          | Replays staged mutations after authenticated bootstrap and before resource hydration.                                                |
| `src/ts/server/resourceState.svelte.ts`           | Svelte resource owners, per-slice revisions/status/errors, and the aggregate compatibility view.                                     |
| `src/ts/server/resourceInvalidation.ts`           | Initial/full reads, event-to-endpoint planning, targeted reads, revision checks, and applies.                                        |
| `src/ts/server/resourceRefresh.ts`                | Coalesced complete refresh for replay gaps, restores, and other broad recovery paths.                                                |
| `src/ts/server/commands.ts`                       | One global browser mutation queue, command response decoding, local-effect capture, and reconciliation batching.                     |
| `src/ts/server/hydrationReads.ts`                 | Browser wrappers for chat, lorebook, legacy-preset, and prompt-template bodies.                                                      |
| `src/ts/server/chatMessageHydration.svelte.ts`    | Active/ranged/bulk chat hydration and character-lorebook hydration.                                                                  |
| `src/ts/server/characterShellHydration.svelte.ts` | Fetches a full character row when a consumer encounters a shell row.                                                                 |
| `src/ts/server/promptTemplateHydration.ts`        | Fetches the template owned by a selected or explicitly requested prompt preset.                                                      |
| `src/ts/server/messageTranslationJobs.ts`         | Tracks detached raw-message translation rows from bootstrap and refresh polling.                                                     |
| `src/ts/server/inlayCatalog.ts`                   | Standalone browser projection and revision-aware writes for inlay metadata.                                                          |
| `src/ts/process/reattach.ts`                      | Reattaches running durable generation jobs reported by bootstrap.                                                                    |

`getResourceDatabase()` and the `getDatabase()` adapter compose the settings,
collections, and characters owners into a transitional aggregate `Database`
view. The inlay catalog remains standalone. Neither is a second persistence
layer. New code should read or update the owning resource slice whenever
practical, and all durable writes still go through API commands.

## Durable Mutation Recovery, Command Queue, And Local Acknowledgements

Three related artifacts have separate jobs:

- The browser durable mutation intent is an IndexedDB recovery record staged
  before dispatch: its command payload is encrypted, while scope/order indexes
  are plaintext. It is non-authoritative and is retained across transient
  failures so bootstrap can replay it in dependency order.
- The server mutation receipt is an SQLite idempotency record keyed by mutation
  id within the current database lineage. Replaying that id returns the original
  revision/event/extras without repeating side effects; the browser acknowledges
  it only after durably deleting the accepted intent.
- The compact local-effect acknowledgement is response-supplied canonical
  keys/digests/certificates plus event ownership and client fences. It can
  acknowledge already-visible optimistic state without a GET, but it is neither
  the durable intent nor the server receipt.

Durable helpers stage before network dispatch (and before a debounced control
waits to send). Semantic owner keys and explicit dependency keys preserve
predecessor order across commands; Web Locks coordinate tabs when available and
same-tab locks provide the local fallback. Only the allowlisted command shapes
in `pendingMutationOutbox.ts` are eligible. If IndexedDB or Web Crypto is
unavailable, the command still uses the ordinary unreceipted transport path,
but it cannot rely on crash recovery.

Every ordinary browser command domain shares the same server revision, so
`src/ts/server/commands.ts` serializes high-level mutations through one global
queue. `runServerCommandSequence()` keeps a multi-step optimistic mutation in
one queue unit: each accepted response advances the base-revision cursor before
the next command factory runs, unrelated mutations cannot interleave, and a
first failure rolls back before the accepted earlier events are released.

Accepted response events and matching own-session SSE echoes are accumulated by
revision and reconciled once after the queued work drains. A response-supplied
local effect can advance the applied-resource cursor without a GET only when it
is the next contiguous revision and its event type, resource, and stable owner
ids match. Effects that depend on an unchanged optimistic target also carry the
relevant settings-group, collection, character-row/lorebook, lorebook-page, or
prompt-owner projection epoch and reject tainted targets.

The acknowledgement path covers settings patches; character, selection,
order, chat-structure, chat-message, and translation mutations; plugin storage
and plugin/module collections; prompt items and split/legacy presets; Agent
Preset, persona, translator-preset, loadout, lorebook, and script-definition
edits. Each helper canonicalizes only the accepted fields or fences an exact
optimistic owner, retaining any newer queued edit. Missing/unsafe response data,
an epoch change, a revision gap, or a foreign event falls back to authoritative
resource invalidation. A complete refresh advances the destructive-refresh
token before applying its first slice, so even a partial failed apply cannot
later acknowledge stale optimism.

Mutation-facing UI must distinguish `accepted`, `queued`, and `failed` helper
outcomes. `queued` means recoverable local intent was retained, not that the
server accepted it; callers should keep newer drafts, surface the outcome, and
must not close an editor or announce success merely because dispatch began.

## Event Invalidation And Recovery

`src/ts/server/events.ts` subscribes to `/api/v1/events` with the applied
resource revision as `sinceRevision` and `Last-Event-ID`. The separate known
server revision can advance from a command response, asset upload, generation,
or Realm completion without making an unapplied event look complete. Clean
closes and stream errors reconnect with exponential backoff plus jitter, capped
at 30 seconds. A malformed command frame forces a complete resource refresh
before reconnect.

`refreshInvalidatedServerResources()` sorts and normalizes a single event or a
coalesced event batch, then converts each resource key into concrete reads:

- Valid grouped settings events read `/api/v1/settings/:group`; broader
  settings-like resources still read `/api/v1/settings`.
- Collection events read only the needed `/api/v1/collections/:name` entries.
- Character selection and order read their narrow resources; only broad
  character events read `/api/v1/characters`. Row-scoped character, script,
  trigger, chat-metadata, and chat-folder events read
  `/api/v1/characters/:id`.
- Message and transcript events read the affected full chat body. A single
  `generation.persisted` event uses `generationMessageId` to read only the
  changed suffix; ambiguous coalesced generations safely fall back to one full
  chat read. Single-chat invalidation retains authoritative reroll alternates.
- Character lorebook events read the single or bulk lorebook endpoint.
- Legacy preset row events fetch only the changed hydrated body. Membership
  events read the shell collection plus only the affected bodies at one common
  revision, preserving already-hydrated unchanged rows and concurrent local
  fields.
- Prompt-item events refresh their explicit modern prompt-preset owner (or the
  top-level compatibility collection); prompt-preset selection/update/delete
  events refresh the selected owner when ownership may have changed.
- Inlay-catalog events read `/api/v1/inlay-assets`; catalog entries are a
  standalone projection and are not folded into the aggregate database view.
- Asset events require no application-data read; the applied revision still
  advances.
- Broad `state`/`lorebook` events, unknown resources, missing required owner
  ids, and event revision gaps use a complete
  settings/collections/characters/inlay-catalog refresh.

Targeted responses must be at least as new as the invalidating event. Per-slice,
per-collection, character-list, character-row, hydrated-body, and prompt-owner
revisions stop older responses from overwriting newer resident state. Pending
plugin-storage operations are replayed over an incoming authoritative storage
map until their command promises finish. Chat-generation-settings also keeps a
pending-value guard so an older authoritative character row cannot replace a
newer edit while its serialized save is in flight.

After a complete refresh, chat and lorebook hydration identities reset because
the character endpoint intentionally carries message-free chat rows. The active
chat is fetched again, selected-character identity is preserved by stable id
when possible, generation reattach is retriggered, and runtime job metadata is
refreshed through read-only bootstrap.

Server replay is backed by SQLite `command_events` and retained for
`COMMAND_EVENT_HISTORY_LIMIT` revisions. The server subscribes to live command
events before replay, queues live events that arrive during the replay flush,
then switches to live delivery. Heartbeats and memory-event fanout begin only
after replay succeeds, and slow-consumer overflow tears down the stream. Memory
events are live progress notifications and are not replayed; they update Hypa
V3 job/progress UI through `memoryJobEvents.ts` rather than refreshing database
resources.

## Read And Hydration Endpoints

All endpoints below require auth. Cache POSTs and bulk endpoints are read-only
POSTs and are classified that way in `server/fastify/src/routeManifest.ts`.

For cache-capable resources, protocol v2 sends
`{cache:{version:2,hashes:{resource:[sha256,...]}}}`. Cache POST bodies have a
1 MiB route limit. Hash arrays are content inventories rather than positional
claims, so reordering does not resend an unchanged row. Fastify hashes the final
JSON wire value after secret masking and shell/body projection and always
returns the current resource revision. Every array position is unambiguous: a
hit is `{hash: sha256}` and a miss is `{value: json}`. Whole-value resources use
the hash string for a hit and the complete JSON value for a miss. The browser
accepts a hit only when that hash's IndexedDB bytes re-hash correctly.
Missing/corrupt entries, unsupported POSTs, malformed cache responses,
unavailable IndexedDB, or unavailable Web Crypto fall back to the full GET.
The `risu-resource-cache-v1` database is disposable and non-authoritative;
cached data is never used offline or without an authenticated server response
confirming its hash. It is separate from the mutation outbox, whose retained
encrypted intents represent unsent local work and must not be cleared as a cache.

The inlay catalog intentionally bypasses the hash cache. Its read joins
`inlay_catalog` metadata to authoritative `assets` metadata; revisioned PUT and
DELETE commands are documented in
[Assets And Saves](assets-and-saves.md#inlay-catalog).

| Data                                               | Endpoint                                                                                         | Browser owner                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Persisted settings fields                          | Cache `POST /api/v1/settings`; full `GET` fallback                                               | `resourceReads.ts`, `settingsResourceState`         |
| One settings group                                 | Cache `POST /api/v1/settings/:group`; full `GET` fallback                                        | Event-driven targeted invalidation                  |
| Every split collection                             | Cache `POST /api/v1/collections`; full `GET` fallback                                            | `resourceReads.ts`, `collectionsResourceState`      |
| One split collection                               | Cache `POST /api/v1/collections/:name`; full `GET` fallback                                      | Event-driven targeted invalidation                  |
| Message-free character list/order/current          | Cache `POST /api/v1/characters`; full `GET` fallback                                             | `resourceReads.ts`, `charactersResourceState`       |
| Inlay metadata catalog                             | `GET /api/v1/inlay-assets`                                                                       | `inlayCatalog.ts`                                   |
| Character order only                               | `GET /api/v1/characters/order`                                                                   | Character-order invalidation                        |
| Character selection/interaction                    | `GET /api/v1/characters/:id/selection`                                                           | Character-selection invalidation                    |
| One character row                                  | `GET /api/v1/characters/:id`                                                                     | Targeted invalidation and character-shell hydration |
| Full, tail, ranged, or generation-suffix chat body | `GET /api/v1/chats/:id/messages` with optional `tail`, `start`/`limit`, or `generationMessageId` | `hydrateActiveChat*()` and event invalidation       |
| Many chat bodies                                   | `POST /api/v1/chats/messages/bulk`                                                               | `ensureAllChatsHydrated()`                          |
| One character lorebook                             | Cache `POST /api/v1/characters/:id/lorebook`; full `GET` fallback                                | `hydrateActiveCharacterLorebook()` and invalidation |
| Many character lorebooks                           | `POST /api/v1/characters/lorebooks/bulk`                                                         | `ensureAllCharacterLorebooksHydrated()`             |
| One legacy bot-preset body                         | Cache `POST /api/v1/legacy-presets/:id`; full `GET` fallback                                     | `ensureBotPresetHydrated()`                         |
| One prompt-preset template                         | Cache `POST /api/v1/prompt-presets/:id/template`; full `GET` fallback                            | `ensurePromptTemplateHydrated()`                    |

The collection names are `modules`, `plugins`, `modelPresets`,
`promptPresets`, `botPresets`, `promptTemplate`, `personas`, `loadouts`,
`loreBook`, `translatorPresets`, `hypaV3Presets`, and
`pluginCustomStorage`. Provider secrets are masked before settings,
collections, or character responses leave Fastify.

Settings and plugin custom storage use one whole-value hash. Array collections,
character rows, prompt-template rows, and lorebook rows use per-item hashes;
legacy presets use one hash for the complete masked body. Aggregate and targeted
`promptTemplate` collection projections have separate browser manifests because
the aggregate response can intentionally suppress the selected compatibility
body. In addition to the 1 MiB POST limit, the browser bounds each request
inventory and retains at most 512 current resource manifests with 8,192 hashes
per manifest. It keeps at most 32,768 unique content-addressed entries, pruning
unreferenced values and limiting their UTF-8 serialized JSON to 64 MiB globally
and 32 MiB per value. Those byte limits do not include IndexedDB metadata or
engine overhead.

Settings-group ownership is mirrored between the browser and Fastify; the
dedicated read-only `agents` and `models` exceptions are parity-tested.
`agents` is written by dedicated Agent Preset commands. `models` is an exact
read-only model-profile slice, while writable `providers` is its superset;
because those projections overlap, applying either response advances both group
fences, while a models response preserves unrelated provider acknowledgement
taint. One providers read subsumes a simultaneous models invalidation. The
`language` read includes the command-owned `translatorPresetId` pointer.
`hypaV3Presets` is collection-owned even though memory settings commands can
change it, so the memory group response excludes it and its cross-resource event
reads the collection separately.

Modern `promptPresets[].promptTemplate` is the normal prompt-template owner.
Collection reads strip every modern preset template into a shell and, on the
aggregate initial read, suppress the duplicate selected top-level compatibility
body. The selected preset's template is fetched by id and copied into the
aggregate compatibility field for older consumers; fetching a background owner
updates only that preset. A selected modern prompt preset with no template owns
the disabled/missing state and must not fall through to stale top-level data.
Legacy `botPresets` likewise arrive as stable-id metadata shells and hydrate
through `ensureBotPresetHydrated*()` only when a legacy workflow needs their
settings body.

Stale-response drops, hydration-generation resets, range stitching, and reroll
alternate seeding live in `chatMessageHydration.svelte.ts`. Character lorebook
hydration is lazy only when experimental `enableLorebookStubs` is enabled; the
lorebook bridge tracks hydrated characters so an absent stub is never persisted
as a deletion.

## Resource Write Guard

`src/ts/server/resourceWriteGuard.svelte.ts` scopes writes to the API-backed
aggregate compatibility view. Ordinary UI code should use the owning settings,
collections, or characters resource instead of mutating that aggregate view
directly.

Trusted write scopes are reserved for authoritative REST application,
chat-message and character-lorebook hydration, command helpers that
intentionally perform optimistic writes, and bridge/draft helpers that restore
snapshots after failure. The guard delegates to the resource state owner so
those compatibility writes remain scoped and observable.

The guard also advances a broad server-resource-apply epoch. Settings,
character, chat, lorebook, and script-definition bridge watchers use that epoch
to refresh their baselines after passive API updates without echoing them back
as commands. Resource state additionally maintains narrower projection epochs
and acknowledgement-taint flags for settings groups, collections, character
rows/lorebooks, the lorebook page, and prompt-template owners. Prompt-template
drafts combine those owner fences with hydration state and cached
command-revision reconciliation.

Compatibility chat mutations in `src/ts/chatCommands.ts` choose the narrowest
safe message command: append, single-message update, prefix truncate, single
delete, or tail replacement after a known persisted anchor. Fully hydrated
shapes that cannot use a narrow form may replace the transcript. A list
containing server message placeholders is never broadly replaced.

`src/ts/server/chatGenerationSettingsResourceGuard.ts` handles one narrower
race. `dispatchSaveChatGenerationSettings()` registers the optimistic value
while its serialized save is pending, and a character-row resource apply keeps
that value until the save settles.

Tests for resource guards, hydration, event invalidation, or watcher changes
that affect rendered state should follow the visible-state policy in
`testing-and-operations.md`.

## Bridge Watchers

| File                               | Role                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bridgeFlush.ts`                   | Flushes pending bridge patches on `pagehide` / hidden visibility with `keepalive`.                                                                                                   |
| `pendingBridgeFlushRegistry.ts`    | Registers lazily loaded/component-owned pending writes for page-exit and owner-targeted flushes without importing every feature at bootstrap.                                        |
| `settingsBridge.svelte.ts`         | Debounced settings groups through `PATCH /commands/settings/:group`, equality-noop suppression, rollback-aware patches.                                                              |
| `characterBridge.svelte.ts`        | Character profile/draft bridging through `PATCH /commands/characters/:id`.                                                                                                           |
| `chatBridge.svelte.ts`             | Chat metadata and chat-folder bridging through `PATCH /commands/chats/:id` and chat-folder routes.                                                                                   |
| `lorebookBridge.svelte.ts`         | Global/character/chat/module lorebook replacement routes with hydrated-lorebook guards.                                                                                              |
| `promptTemplateBridge.svelte.ts`   | Prompt item/settings routes, selected-prompt-preset ownership, optimistic writes, rollback, and hydration/revision-aware reconciliation.                                             |
| `scriptDefinitionBridge.svelte.ts` | Global/character/module script and trigger watchers; compact create/update/delete/reorder classification, response-digest checks, projection fencing, and full-replacement fallback. |

Common requirements are to capture snapshots, suppress no-op updates, respect
the appropriate resource epoch or revision gate, debounce noisy edits, stage
durable intent before dispatch, send the narrowest field/row mutation available,
and use trusted optimistic writes only in helpers that intentionally update
local resource state before the server response. Retryable failures retain the
encrypted intent and its optimistic projection for replay. Terminal rejection
rolls back only when the attempted value still owns the target; the
non-durable fallback uses the ordinary rollback path. Multi-command watcher
fan-outs still enter the shared command queue and reconcile their accepted event
batch once.

## Active Writer And Diagnostics

Active writer is server-side. A writer-intent bootstrap owns
`risu-writer-session`; stale guarded mutations receive
`423 active_writer_stale`. The client resource write guard is separate and
catches accidental unscoped local mutation.

Read-only bootstrap, resource reads, event streams, durable-generation
reattach, and immutable asset reads do not require writer ownership. Legacy
storage `write`/`remove` calls do carry the active-writer session because they
mutate server-owned compatibility files. Browser writer-session handling lives
in `src/ts/server/activeWriterSession.ts`.

Server protocol metrics are opt-in with `RISU_PROTOCOL_METRICS=1` (also accepts
`true`, `yes`, or `on`). Browser protocol debug logs are opt-in with
`localStorage.setItem('risu:protocol-debug', '1')`. Browser diagnostics include
complete-resource-refresh reasons, hydration concurrency and stale-drop
counters, and asset byte-read fanout counters. Memory job SSE and refresh paths
gate updates through ordering checks, record terminal jobs, and suppress stale
or non-active terminal refresh updates. Relevant files include
`server/fastify/src/protocolMetrics.ts`,
`src/ts/server/protocolDiagnostics.ts`, `src/ts/server/assets.ts`,
`chatMessageHydration.svelte.ts`, `memoryJobRefresh.ts`, and
`resourceRefresh.ts`.
