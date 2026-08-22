# Server Resources And Bridges

Last audited: 2026-08-18.

This guide owns the Fastify-to-browser resource boundary: root and targeted REST
reads, hash-verified cache substitution, lazy body hydration, invalidation and
recovery, durable command dispatch, and compatibility bridges. Start from the
[architecture index](README.md) for adjacent ownership.

## Bootstrap And Initial Resources

`src/ts/bootstrap.ts` coordinates startup:

- Before writer-intent bootstrap, startup reads any single unambiguous pending
  mutation owner and can adopt that writer session so recoverable local work is
  not orphaned by a new browser session.
- `fetchServerBootstrap()` sends writer intent to `GET /api/v1/bootstrap`.
  When another writer still has an identified event stream open, bootstrap
  returns `409 active_writer_connected`; the browser prompts before retrying
  with explicit permission to disconnect that client. A successful bootstrap
  is deliberately runtime-only metadata: initialization state, revision/schema
  version, database lineage, durable writer epoch, the pre-takeover writer
  verdict, asset base URL, generation-operation protocol and projections,
  running generation jobs, writer-scoped finalization/effect recovery, and
  running plus bounded recent terminal message/greeting translations. It does
  not carry durable application data.
- When bootstrap reports `initialized: false`, the browser attempts
  `POST /api/v1/commands/state/initialize`. The server re-runs the classifier in
  the command transaction and accepts only genuinely empty state; conflicting
  prior-install evidence fails closed. The winning client reuses the runtime
  metadata and accepted revision it already has, while a client that lost an
  initialization race retries bootstrap read-only.
- After bootstrap/initialization, startup establishes the shared draft-recovery
  scope, then prepares the mutation outbox against
  the writer session and database lineage, flushes its durable server-receipt
  acknowledgements, and replays pending intents. Same-session rows survive a
  writer-epoch reclaim. Transient and genuine stale-writer failures retain their
  encrypted intents. Same-lineage foreign-writer rows remain dormant, while
  old-lineage rows are discarded during preparation. Only retained or unreadable
  rows owned by the current writer and lineage block root-resource hydration;
  terminal disposal and notices are contract-specific.
- `loadInitialServerResources()` concurrently reads settings, collections, and
  characters through their hash-aware POST resources (with compatible full GET
  fallback), plus `/api/v1/inlay-assets`. All four responses must report one
  common revision. Concurrent writes that split the revisions cause the
  complete read set to retry, up to `FULL_RESOURCE_REFRESH_MAX_ATTEMPTS`.
- The consistent response set is applied through one trusted resource scope.
  The settings, collections, and characters state objects keep their own
  revision/status/error metadata. The character list contains message-free chat
  rows; chat messages, per-chat Hypa V3 data, and reroll alternates remain lazy.
- The collection response carries prompt-preset and legacy bot-preset shells.
  Startup hydrates the selected modern prompt-template owner separately before
  enabling normal command/event reconciliation; legacy preset bodies remain
  on-demand.
- Startup seeds the known-server and applied-resource revision cursors, enables
  the resource write guard, records operation/job projections, starts
  generation reattach and pending-effect recovery, starts message/greeting
  translation recovery and active-chat hydration, installs the bridge lifecycle
  flush, and subscribes to `/api/v1/events`.
- Generation recovery treats the lineage-scoped operation projection as durable
  authority. Active jobs are live attachment hints and local activities are
  observer state. Runtime read-only bootstrap probes are epoch-fenced and
  bounded; a foreground probe may supersede an older suspended request while
  preserving the last successfully applied projection on failure. A current,
  accepted probe advances the known-server command cursor before transcript and
  effect reconciliation, while the applied-resource cursor remains event-owned.
  Terminal or expired jobs are not cleared until their affected transcript has
  been authoritatively hydrated, and the snapshot's finalization/effect projections
  are reconciled in the same recovery pass.
- Command success reconciliation and foreign command SSE events both flow through the
  same serialized resource path. Contiguous response-confirmed optimistic
  effects can advance their resource fences without a read; authoritative reads
  still apply in command-event order for every other event.

| Path                                                       | Role                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/ts/server/bootstrap.ts`                               | Validates the small runtime bootstrap and exposes writer-intent/read-only variants.                                                  |
| `src/ts/server/resourceReads.ts`                           | Browser wrappers and response validation for settings, collections, characters, and the inlay catalog.                               |
| `src/ts/server/resourceCache.ts`                           | Disposable, non-authoritative SHA-256 manifests and verified IndexedDB values used only after authenticated hash confirmation.       |
| `src/ts/server/pendingMutationOutbox.ts`                   | AES-GCM-encrypted intent payloads plus plaintext scope/order indexes and durable receipt-acknowledgement rows.                       |
| `src/ts/server/durableMutationDispatch.ts`                 | Persists an intent before dispatch, classifies replay outcomes, and completes accepted intents before acknowledging server receipts. |
| `src/ts/server/pendingMutationReplay.ts`                   | Replays staged mutations after authenticated bootstrap and before resource hydration.                                                |
| `src/ts/server/persistenceActivity.svelte.ts`              | Global saving signal covering queued commands and current-writer pending outbox rows, with a short anti-flicker linger.              |
| `src/ts/server/resourceState.svelte.ts`                    | Svelte resource owners, per-slice revisions/status/errors, and the aggregate compatibility view.                                     |
| `src/ts/server/resourceInvalidation.ts`                    | Initial/full reads, event-to-endpoint planning, targeted reads, revision checks, and applies.                                        |
| `src/ts/server/resourceRefresh.ts`                         | Coalesced complete refresh for replay gaps, restores, and other broad recovery paths.                                                |
| `src/ts/server/lifecycleRecovery.ts`                       | One coalesced visibility/page-show/online/focus dispatcher shared by generation and resource recovery.                              |
| `src/ts/server/commands.ts`                                | One global browser mutation queue, command response decoding, local-effect capture, and reconciliation batching.                     |
| `src/ts/server/hydrationReads.ts`                          | Browser wrappers for chat, lorebook, legacy-preset, and prompt-template bodies.                                                      |
| `src/ts/server/chatMessageHydration.svelte.ts`             | Active/ranged/bulk chat hydration and character-lorebook hydration.                                                                  |
| `src/ts/server/characterShellHydration.svelte.ts`          | Fetches a full character row when a consumer encounters a shell row.                                                                 |
| `src/ts/server/promptTemplateHydration.ts`                 | Fetches the template owned by a selected or explicitly requested prompt preset.                                                      |
| `src/ts/server/messageTranslationJobs.ts`                  | Tracks detached manual or generated-message translation rows from bootstrap and refresh polling.                                     |
| `src/ts/server/greetingTranslations.svelte.ts`             | Character-scoped greeting projection, source/settings fencing, manual translation, refresh, and job recovery.                        |
| `src/ts/server/generationOperations.ts`                    | Operation protocol negotiation, outbox-backed acceptance/cancellation, attempt streams, projections, retries, and bootstrap recovery. |
| `src/ts/process/generationEffectLedger.ts`                 | Claims, leases, and receipts exact-generation client effects.                                                                        |
| `src/ts/process/recoveredGenerationEffects.ts`             | Reconciles pending durable/recomputed effects and permanently skips late ephemeral effects after bootstrap.                           |
| `src/ts/server/settingsGroups.ts`                          | Browser settings-group ownership, including the `sidebar` membership projection.                                                     |
| `src/ts/process/serverGeneratedMessageTranslation.ts`      | Applies translation results embedded in generation completion and seeds the shared translation-job state for running/failure UI.     |
| `src/ts/process/generatedMessageTranslationEligibility.ts` | Prevents the older rendered-row auto trigger from duplicating server-owned generated-message translation.                            |
| `src/ts/server/inlayCatalog.ts`                            | Standalone browser projection and revision-aware writes for inlay metadata.                                                          |
| `src/ts/process/reattach.ts`                               | Reattaches running generation-operation attempts reported by bootstrap.                                                              |
| `src/ts/server/draftRecoveryScope.ts`                      | Shared database-lineage/writer-session scope for non-authoritative editing recovery.                                                  |
| `src/lib/ChatScreens/DefaultChatScreen.composerDrafts.ts`  | Bounded per-transcript composer recovery in `sessionStorage`.                                                                         |
| `src/ts/server/moduleEditorDraftStore.ts`                  | Separately encrypted, bounded IndexedDB recovery for module-editor drafts.                                                            |

`getResourceDatabase()` and the `getDatabase()` adapter compose the settings,
collections, and characters owners into a transitional aggregate `Database`
view. The inlay catalog remains standalone. Neither is a second persistence
layer. New code should read or update the owning resource slice whenever
practical, and all durable writes still go through API commands.

## Durable Mutation Recovery, Command Queue, And Local Acknowledgements

Do not conflate the persistence and acknowledgement artifacts:

| Artifact                         | Storage / protection                                  | Authority and startup effect                                                                                                      |
| -------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Disposable resource cache        | IndexedDB; SHA-256 reverified after authenticated read | Never authoritative or offline state; corruption/misses fall back to full reads.                                                  |
| Durable mutation intent          | IndexedDB; AES-GCM payload plus plaintext scope/order | Non-authoritative pending command work; current-scope unresolved rows replay before hydration and can block hydration.            |
| Composer recovery draft          | Bounded `sessionStorage`; plaintext                   | Lineage/writer-scoped editing recovery only; not a command, receipt, or proof of acceptance.                                      |
| Module-editor recovery draft     | Separate bounded AES-GCM IndexedDB                    | Lineage/writer-scoped editing recovery with rebase/copy/discard UI; not outbox intent.                                             |
| Server mutation receipt          | SQLite; lineage-scoped mutation id                    | Authoritative idempotency record returned on replay; acknowledged after the accepted browser intent is durably removed.           |
| Compact local-effect acknowledgement | Command response plus client projection fences    | May advance already-visible optimistic state without a GET; durable nowhere and distinct from both the intent and server receipt. |

Durable helpers stage before network dispatch (and before a debounced control
waits to send). Semantic owner keys and explicit dependency keys preserve
predecessor order across commands; Web Locks coordinate tabs when available and
same-tab locks provide the local fallback. Same-writer-session and
database-lineage stage requests are cross-tab serialized before encryption; the
scope's committed-order counter advances atomically with visibility of the
complete encrypted row. Browsers without Web Locks retain same-page FIFO order,
while an IndexedDB compare-and-swap prevents a lower order from appearing after
a higher committed row across tabs. Only the allowlisted command shapes in
`pendingMutationOutbox.ts` are eligible. Secure contexts store a non-extractable
WebCrypto key; insecure contexts use a separately stored raw AES-GCM key and
tagged envelopes. If IndexedDB or secure random generation is unavailable, the
outbox cannot provide crash recovery. IndexedDB/key-persistence failure can
fall back to ordinary transport; unavailable secure randomness can fail staging
before dispatch.

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
ids match. Message effects also validate the chat-body projection epoch. Effects
that depend on an unchanged optimistic target carry the
relevant settings-group, collection, character-row/lorebook, lorebook-page, or
prompt-owner projection epoch and reject tainted targets.

The acknowledgement path covers settings patches; character, selection,
order, chat-structure, chat-message, and message-translation mutations; plugin storage
and plugin/module collections; prompt items and split/legacy presets; Agent
Preset, persona, translator-preset, loadout, lorebook, and script-definition
edits. Each helper canonicalizes only the accepted fields or fences an exact
optimistic owner, retaining any newer queued edit. Missing/unsafe response data,
an epoch change, a revision gap, or a foreign event falls back to authoritative
resource invalidation. A complete refresh advances the destructive-refresh
token before applying its first slice, so even a partial failed apply cannot
later acknowledge stale optimism.

The destructive all-chat reset uses `dispatchResetChatsWithOutcome()` in
`src/ts/chatCommands.ts`. It first flushes registered bridge patches, stages
the allowlisted character-owned `PUT` intent, applies one optimistic replacement
chat, and retains or rolls back that projection according to the normal
`accepted`/`queued`/`failed` outcome. The low-level `resetChatsCommand()`
intentionally supplies no compact local effect; its `chats.reset` event
therefore reconciles through the authoritative
`/api/v1/characters/:characterId` row. `src/ts/chatCommands.test.ts` guards the
outcome/rollback path and `src/ts/server/commands.test.ts` guards the wire
contract.

Mutation-facing UI must distinguish `accepted`, `queued`, and `failed` helper
outcomes. `queued` means recoverable local intent was retained, not that the
server accepted it; callers should keep newer drafts, surface the outcome, and
must not close an editor or announce success merely because dispatch began.
The app-wide saving icon is the normal transient feedback channel: it stays
active through command reconciliation and while the current writer still owns
staged outbox work, then lingers for 500 ms to avoid flicker. Per-control status
surfaces retain failures and action-specific busy/disabled semantics rather
than duplicating generic saving/queued rows. The persisted `showSavingIcon`
field defaults to `true` but remains an opt-out without a current settings UI.

## Event Invalidation And Recovery

`src/ts/server/events.ts` subscribes to `/api/v1/events` with the applied
resource revision as `sinceRevision` and `Last-Event-ID`. The separate known
server revision can advance from a command response, asset upload, generation,
or Realm completion without making an unapplied event look complete. Clean
closes and stream errors reconnect with exponential backoff plus jitter, capped
at 30 seconds. A malformed command frame forces a complete resource refresh
before reconnect. Every frame resets a 60-second silence watchdog;
visibility/page-show/online/focus recovery reconnects immediately, successful reconnect
retriggers current-scope outbox replay, and foreign writer frames enter the
takeover flow. Server writer/memory frames are live-only; only command events
are persisted and replayed.

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
- Greeting-translation events read
  `/api/v1/characters/:characterId/greeting-translations` at or beyond the event
  revision.
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

Model-profile and provider-credential events target the `models` group;
well-formed Agent, Agent Preset, and Agent-use events target `agents`.

Targeted responses must be at least as new as the invalidating event. Per-slice,
per-collection, character-list, character-row, hydrated-body, and prompt-owner
revisions stop older responses from overwriting newer resident state. Pending
plugin-storage operations are replayed over an incoming authoritative storage
map until their command promises finish. Chat-generation-settings also keeps a
pending-value guard so an older authoritative character row cannot replace a
newer edit while its serialized save is in flight.

Generic settings, collection, character-list, and character-row reads also
capture their owner projection epochs and resident JSON at request start. A
response is left unapplied when either fence changes while it is in flight, so
an optimistic bridge edit cannot be rewound merely because its cached server
revision has not advanced yet. Complete refreshes use the same per-slice fence:
unaffected slices still refresh, while a concurrently edited slice and its
unsettled durable intent remain available for dispatch or next-bootstrap
replay. Projection replacement alone is never treated as proof that a staged
mutation was accepted; mutation-id settlement is the acknowledgement signal.

After a complete refresh, chat identities reset because character rows are
message-free, lorebook identities reset/reseed separately, and greeting
projections clear. The active chat is fetched again, selected-character identity
is preserved by stable id when possible, generation reattach is retriggered,
and generation/message/greeting job metadata refreshes through read-only
bootstrap.

Server replay is backed by SQLite `command_events` and retained for
`COMMAND_EVENT_HISTORY_LIMIT` revisions. After the writer frame and connected
comment, every successful connection receives an initial `memory_snapshot`
frame before command replay; `memoryJobEvents.ts` uses it to seed current Hypa
V3 job/progress state. The server subscribes to live command events before
replay, queues live events that arrive during the replay flush, then switches to
live delivery. Heartbeats and live memory-event fanout begin only after replay
succeeds, and slow-consumer overflow tears down the stream. Memory progress is
not replayed and does not invalidate database resources. The full SSE ordering
contract is in [Data And Events](data-and-events.md#sse-and-streaming).

## Read And Hydration Endpoints

All endpoints below require auth. Cache POSTs and bulk endpoints are read-only
POSTs and are classified that way in `server/fastify/src/routeManifest.ts`.

### Cache Protocol

For cache-capable resources, protocol v2 sends
`{cache:{version:2,hashes:{resource:[sha256,...]}}}`. Cache POST bodies have a
1 MiB route limit. Hash arrays are content inventories rather than positional
claims, so reordering does not resend an unchanged row. Fastify hashes the final
JSON wire value after any route-specific secret masking and shell/body
projection, and always returns the current resource revision. Every array
position is unambiguous: a
hit is `{hash: sha256}` and a miss is `{value: json}`. Whole-value resources use
the hash string for a hit and the complete JSON value for a miss. The browser
accepts a hit only when that hash's IndexedDB bytes re-hash correctly.
Missing/corrupt entries, unsupported POSTs, malformed cache responses,
unavailable IndexedDB, or unavailable Web Crypto fall back to the full GET.
The `risu-resource-cache-v1` database is disposable and non-authoritative;
cached data is never used offline or without an authenticated server response
confirming its hash. It is separate from the mutation outbox, whose retained
encrypted intents represent unsent local work and must not be cleared as a cache.

Intermediate message display has a separate non-authoritative cache owned by
`server/fastify/src/displaySourceCache.ts`. It stores only completed,
side-effect-free `displaySource` text in one active page/viewport/writer
namespace and is bounded by entry count, aggregate UTF-8 bytes, and per-entry
bytes. Namespace replacement retires the prior LRU; an old in-flight completion
may finish but cannot populate the replacement. Streaming prefixes and Lua runs
that changed durable scriptstate bypass reusable storage. This cache creates no
SQLite rows, revisions, backup data, or hydration fields.

The inlay catalog intentionally bypasses the hash cache. Its read joins
`inlay_catalog` metadata to authoritative `assets` metadata; revisioned PUT and
DELETE commands are documented in
[Assets And Saves](assets-and-saves.md#inlay-catalog).

### Endpoint Index

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
| One character's greeting translations              | `GET /api/v1/characters/:id/greeting-translations`                                               | `greetingTranslations.svelte.ts`                    |
| Full, tail, ranged, or generation-suffix chat body | `GET /api/v1/chats/:id/messages` with optional `tail`, `start`/`limit`, or `generationMessageId` | `hydrateActiveChat*()` and event invalidation       |
| Many chat bodies                                   | `POST /api/v1/chats/messages/bulk`                                                               | `ensureAllChatsHydrated()`                          |
| Derived intermediate display text                  | `POST /api/v1/chats/:id/display-sources`                                                         | `displaySources.ts` batch/fallback bridge           |
| One character lorebook                             | Cache `POST /api/v1/characters/:id/lorebook`; full `GET` fallback                                | `hydrateActiveCharacterLorebook()` and invalidation |
| Many character lorebooks                           | `POST /api/v1/characters/lorebooks/bulk`                                                         | `ensureAllCharacterLorebooksHydrated()`             |
| One legacy bot-preset body                         | Cache `POST /api/v1/legacy-presets/:id`; full `GET` fallback                                     | `ensureBotPresetHydrated()`                         |
| One prompt-preset template                         | Cache `POST /api/v1/prompt-presets/:id/template`; full `GET` fallback                            | `ensurePromptTemplateHydrated()`                    |

### Hydration Workflows

Both bulk hydration endpoints accept at most 32 ids and 64 KiB request bodies.
The browser splits larger hydrate-all operations into 32-id batches while
preserving revision fences.

The active-chat fast path does not fetch the full transcript on every open.
`src/ts/server/chatMessageHydration.svelte.ts` asks for a tail window sized by
`chatLoadInitialPages` (30 messages by default), leaves placeholders for older
rows, and fills only newly visible ranges as the UI expands by
`chatLoadAdditionalPages` (15 by default). Export and other strict whole-chat
workflows call full or batched hydration explicitly. Stale-response drops,
hydration-generation resets, range stitching, reroll-alternate seeding, and
queued-generation-persistence acknowledgement stay scoped to the chat body.

Ranged message application mutates a safe resident array in place: an appended
generation suffix does not copy the loaded prefix, unchanged rows retain object
identity, and malformed ranges fail back into the existing authoritative
recovery path. The generation-specific response omits `hypaV3Data` because a
plain `generation` event cannot own chat-wide Hypa state; events that do change
chat state use the broader `chatTranscript` resource. The browser distinguishes
that omission from an authoritative empty value with `hypaV3DataIncluded`.
Generation reads continue to include reroll alternates because send/continue
clear them and regenerate can replace or extend them atomically with the
message.

Modern prompt-template hydration is owner-specific. The selected preset body is
fetched before normal reconciliation begins; a background owner fetch updates
only that preset and cannot replace the selected compatibility projection.
`src/ts/server/promptTemplateHydration.ts` fences the hydration generation,
owner projection epoch, minimum revision, owner identity, and owner snapshot
before applying a response.

Greeting translations use their own character-scoped projection. The read
returns only rows valid for the current source text and translator-settings
hash. `src/ts/server/greetingTranslations.svelte.ts` additionally fences the
client settings signature and request epoch, then recovers running or recent
terminal jobs through read-only bootstrap polling.

### Collection And Cache Bounds

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

## Settings Groups And Feature Projections

Settings-group ownership is mirrored between the browser and Fastify; the
dedicated read-only `agents` and `models` exceptions are parity-tested.
`agents` contains standalone Agents, Agent Presets, and the default-preset
pointer and is written by dedicated Agent and Agent Preset commands. `models`
contains exactly `providerCredentials`, `modelProfiles`, `modelRoleProfiles`,
and `modelRuntimeDefaults`, while writable `providers` is its superset;
because those projections overlap, applying either response advances both group
fences, while a models response preserves unrelated provider acknowledgement
taint. One providers read subsumes a simultaneous models invalidation. The
`language` read includes the command-owned `translatorPresetId` pointer.
`hypaV3Presets` is collection-owned even though memory settings commands can
change it, so the memory group response excludes it and its cross-resource event
reads the collection separately.

### Prompt Preset And Legacy Bodies

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

Character lorebook hydration is lazy only when experimental
`enableLorebookStubs` is enabled; the lorebook bridge tracks hydrated
characters so an absent stub is never persisted as a deletion.

## Resource Write Guard

`src/ts/server/resourceWriteGuard.svelte.ts` scopes writes to the API-backed
aggregate compatibility view. Ordinary UI code should use the owning settings,
collections, or characters resource instead of mutating that aggregate view
directly.

The aggregate compatibility proxy is stable but does not implicitly read its
broad facade epoch. Nested proxy reads provide ordinary fine-grained Svelte
dependencies; consumers that intentionally observe every resource write must
read `getResourceDatabaseFacadeEpoch()` explicitly.

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
| `bridgeFlush.ts`                   | Directly imports and flushes every built-in bridge on `pagehide` / hidden visibility with `keepalive`, then also invokes registered extension owners.                                 |
| `pendingBridgeFlushRegistry.ts`    | Registers bridge flush/reset callbacks for owner-targeted calls and dynamically loaded owners. Most built-in bridges register here as well as being covered by `bridgeFlush.ts`.      |
| `settingsBridge.svelte.ts`         | Debounced settings groups through `PATCH /commands/settings/:group`, equality-noop suppression, rollback-aware patches.                                                              |
| `characterBridge.svelte.ts`        | Character profile/draft bridging through `PATCH /commands/characters/:id`.                                                                                                           |
| `chatBridge.svelte.ts`             | Chat metadata and chat-folder bridging through `PATCH /commands/chats/:id` and chat-folder routes.                                                                                   |
| `lorebookBridge.svelte.ts`         | Stable-id global/character/chat/module lorebook upsert/delete/reorder planning with hydrated guards and unsafe-diff replacement fallback.                                            |
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
`risu-writer-session`; a still-connected foreign writer requires the explicit
disconnect handshake, and stale guarded mutations receive
`423 active_writer_stale`. The client resource write guard is separate and
catches accidental unscoped local mutation.

Read-only bootstrap, resource reads, event streams, durable-generation
reattach, and immutable asset reads do not require writer ownership. Legacy
storage `write`/`remove` calls do carry the active-writer session because they
mutate server-owned compatibility files. Browser writer-session handling lives
in `src/ts/server/activeWriterSession.ts`.

Server protocol metrics are opt-in with `RISU_PROTOCOL_METRICS=1` (also accepts
`true`, `yes`, or `on`). Browser protocol debug logs are opt-in with
`localStorage.setItem('risu:protocol-debug', '1')` or `'true'`. Browser diagnostics include
complete-resource-refresh reasons, hydration concurrency and stale-drop
counters, asset byte-read fanout counters, bounded generation-recovery events
and counters, and server event-stream frame/byte,
lifetime, and close-reason metrics. Memory job SSE and refresh paths
gate updates through ordering checks, record terminal jobs, and suppress stale
or non-active terminal refresh updates. Relevant files include
`server/fastify/src/protocolMetrics.ts`,
`src/ts/server/protocolDiagnostics.ts`, `src/ts/server/assets.ts`,
`chatMessageHydration.svelte.ts`, `memoryJobRefresh.ts`, and
`resourceRefresh.ts`. Generation recovery diagnostics contain only trigger,
recovery epoch, operation/attempt/job identifiers, state transitions,
disposition, and request UID; they never contain prompts, generated text,
credentials, or bodies.
