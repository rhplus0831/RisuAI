# Server Resources And Bridges

Last audited: 2026-07-13.

Fastify owns durable state. The browser reads concrete REST resources into
Svelte-owned settings, collections, and characters state, fetches large bodies
only when needed, and routes persistent edits through command helpers or
explicit server-owned mutation routes.

## Bootstrap And Initial Resources

`src/ts/bootstrap.ts` coordinates startup:

- `fetchServerBootstrap()` sends writer intent to `GET /api/v1/bootstrap`.
  Bootstrap is deliberately runtime-only metadata: initialization state,
  revision/schema version, asset base URL, running generation jobs, and active
  message translations. It does not carry durable application data.
- Empty state triggers `POST /api/v1/commands/state/initialize`, followed by a
  read-only bootstrap check.
- `loadInitialServerResources()` concurrently reads `GET /api/v1/settings`,
  `GET /api/v1/collections`, and `GET /api/v1/characters`. All three responses
  must report one common revision. Concurrent writes that split the revisions
  cause the complete read set to retry, up to
  `FULL_RESOURCE_REFRESH_MAX_ATTEMPTS`.
- The consistent response set is applied through one trusted resource scope.
  The settings, collections, and characters state objects keep their own
  revision/status/error metadata. The character list contains message-free chat
  rows; chat bodies remain lazy.
- Startup seeds the known-server and applied-resource revision cursors, enables
  the resource write guard, records runtime jobs, starts active-generation and
  active-translation recovery, starts active-chat hydration, installs the
  bridge lifecycle flush, and subscribes to `/api/v1/events`.
- Command success reconciliation and foreign SSE events both flow through the
  same serialized resource-invalidation path, so authoritative reads apply in
  command-event order.

| Path                                           | Role                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/ts/server/bootstrap.ts`                   | Validates the small runtime bootstrap and exposes writer-intent/read-only variants.      |
| `src/ts/server/resourceReads.ts`               | Browser wrappers and response validation for settings, collections, and character reads. |
| `src/ts/server/resourceState.svelte.ts`        | Svelte resource owners, per-slice revisions/status/errors, and the aggregate compatibility view. |
| `src/ts/server/resourceInvalidation.ts`        | Initial/full reads, event-to-endpoint planning, targeted reads, revision checks, and applies. |
| `src/ts/server/resourceRefresh.ts`             | Coalesced complete refresh for replay gaps, restores, and other broad recovery paths.    |
| `src/ts/server/hydrationReads.ts`              | Browser wrappers for chat, lorebook, legacy-preset, and prompt-template bodies.          |
| `src/ts/server/chatMessageHydration.svelte.ts` | Active/ranged/bulk chat hydration and character-lorebook hydration.                      |
| `src/ts/server/characterShellHydration.svelte.ts` | Fetches a full character row when a consumer encounters a shell row.                   |
| `src/ts/server/promptTemplateHydration.ts`     | Fetches the template owned by a selected or explicitly requested prompt preset.          |
| `src/ts/server/messageTranslationJobs.ts`      | Tracks detached raw-message translation rows from bootstrap and refresh polling.         |
| `src/ts/process/reattach.ts`                   | Reattaches running durable generation jobs reported by bootstrap.                        |

`getResourceDatabase()` and the `getDatabase()` adapter compose the three
resource owners into a transitional aggregate `Database` view. This view is not
a second persistence layer. New code should read or update the owning resource
slice whenever practical, and all durable writes still go through API commands.

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
- Asset events require no application-data read; the applied revision still
  advances.
- Broad `state`/`lorebook` events, unknown resources, missing required owner
  ids, and event revision gaps use a complete
  settings/collections/characters refresh.

Targeted responses must be at least as new as the invalidating event. Per-slice,
per-collection, character-list, character-row, and hydrated-body revisions stop
older responses from overwriting newer resident state. Pending plugin-storage
operations are replayed over an incoming authoritative storage map until their
command promises finish. A successful local chat-generation-settings save
reconciles its canonical response without a GET; its pending-value guard still
protects a newer edit while an authoritative character row is in flight.

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

All endpoints below require auth. The bulk endpoints are read-only POSTs and are
classified that way in `server/fastify/src/routeManifest.ts`.

| Data                                      | Endpoint                                                       | Browser owner                                               |
| ----------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| Scalar/settings fields                    | `GET /api/v1/settings`                                         | `resourceReads.ts`, `settingsResourceState`                 |
| One settings group                        | `GET /api/v1/settings/:group`                                  | Event-driven targeted invalidation                          |
| Every split collection                    | `GET /api/v1/collections`                                      | `resourceReads.ts`, `collectionsResourceState`              |
| One split collection                      | `GET /api/v1/collections/:name`                                | Event-driven targeted invalidation                          |
| Message-free character list/order/current | `GET /api/v1/characters`                                       | `resourceReads.ts`, `charactersResourceState`               |
| Character order only                      | `GET /api/v1/characters/order`                                 | Character-order invalidation                                |
| Character selection/interaction           | `GET /api/v1/characters/:id/selection`                         | Character-selection invalidation                            |
| One character row                         | `GET /api/v1/characters/:id`                                   | Targeted invalidation and character-shell hydration         |
| Full, tail, ranged, or generation-suffix chat body | `GET /api/v1/chats/:id/messages` with optional `tail`, `start`/`limit`, or `generationMessageId` | `hydrateActiveChat*()` and event invalidation |
| Many chat bodies                          | `POST /api/v1/chats/messages/bulk`                              | `ensureAllChatsHydrated()`                                  |
| One character lorebook                    | `GET /api/v1/characters/:id/lorebook`                           | `hydrateActiveCharacterLorebook()` and invalidation         |
| Many character lorebooks                  | `POST /api/v1/characters/lorebooks/bulk`                        | `ensureAllCharacterLorebooksHydrated()`                     |
| One legacy bot-preset body                | `GET /api/v1/legacy-presets/:id`                                | `ensureBotPresetHydrated()`                                 |
| One prompt-preset template                | `GET /api/v1/prompt-presets/:id/template`                       | `ensurePromptTemplateHydrated()`                            |

The collection names are `modules`, `plugins`, `modelPresets`,
`promptPresets`, `botPresets`, `promptTemplate`, `personas`, `loadouts`,
`loreBook`, `translatorPresets`, `hypaV3Presets`, and
`pluginCustomStorage`. Provider secrets are masked before settings,
collections, or character responses leave Fastify.

Modern `promptPresets[].promptTemplate` is the normal prompt-template owner.
The selected preset's template is fetched by id and copied into the aggregate
compatibility field for older consumers; fetching a background owner updates
only that preset. A selected modern prompt preset with no template owns the
disabled/missing state and must not fall through to stale top-level data.

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

The guard also advances a server-resource-apply epoch. Settings, character,
chat, lorebook, and script-definition bridge watchers use that epoch to refresh
their baselines after passive API updates without echoing them back as commands.
Prompt-template drafts instead combine hydration state with cached
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

| File                               | Role                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `bridgeFlush.ts`                   | Flushes pending bridge patches on `pagehide` / hidden visibility with `keepalive`. |
| `settingsBridge.svelte.ts`         | Debounced settings groups through `PATCH /commands/settings/:group`, equality-noop suppression, rollback-aware patches. |
| `characterBridge.svelte.ts`        | Character profile/draft bridging through `PATCH /commands/characters/:id`.         |
| `chatBridge.svelte.ts`             | Chat metadata and chat-folder bridging through `PATCH /commands/chats/:id` and chat-folder routes. |
| `lorebookBridge.svelte.ts`         | Global/character/chat/module lorebook replacement routes with hydrated-lorebook guards. |
| `promptTemplateBridge.svelte.ts`   | Prompt item/settings routes, selected-prompt-preset ownership, optimistic writes, rollback, and hydration/revision-aware reconciliation. |
| `scriptDefinitionBridge.svelte.ts` | Character/module script and trigger `PUT` routes.                                  |

Common requirements are to capture snapshots, suppress no-op updates, respect
the appropriate resource epoch or revision gate, debounce noisy edits, roll
back on failure/conflict, and use trusted optimistic writes only in helpers that
intentionally update local resource state before the server response.

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
