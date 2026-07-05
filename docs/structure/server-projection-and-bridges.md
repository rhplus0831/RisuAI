# Server Projection And Bridges

Last audited: 2026-07-06.

The browser is a projected client. Fastify owns durable state; Svelte receives a
lean projection, hydrates heavy fields on demand, and routes persistent edits
through command helpers or explicit server-owned mutation routes.

## Bootstrap And Resync

`src/ts/bootstrap.ts` coordinates startup:

- `fetchServerBootstrapProjection()` sends writer intent and reads
  `/api/v1/bootstrap`.
- `src/ts/server/bootstrap.ts` prepares the body-cache request and merges
  returned module/plugin body-cache payloads through `bootstrapBodyCache.ts`
  before `src/ts/bootstrap.ts` applies the projection.
- Empty bootstrap (`database: null`) triggers
  `POST /api/v1/commands/state/initialize`, then a read-only bootstrap refetch.
- The projection is merged with any bootstrap body-cache entries, applied through
  trusted write scopes, revision cache is seeded, projection write guard is
  enabled, active generation jobs are handed to reattach logic, active message
  translations are recorded for row-level busy state and refresh polling,
  character shell and prompt-template hydration start, chat hydration starts,
  and `/api/v1/events` subscribes.
- Full recovery uses `fetchServerBootstrapProjectionReadOnly()` so passive
  resync does not steal writer ownership from another browser session.
- Startup also installs `setServerCommandSuccessReconciler()`, so successful
  local command responses can reconcile their command event immediately; later
  SSE own echoes or already-reconciled revisions are skipped.

`projectionResync.ts` coalesces concurrent full-resync requests, reads bootstrap
with `cacheRevision: false`, applies the fresh database, caches the new
revision before stale hydration checks, syncs selected character state, seeds
active generation reattach state, refreshes active message translations, resets
chat/lorebook hydration, records already-hydrated lorebooks, force-hydrates the
active chat/lorebook and selected character shell, then restarts prompt-template
hydration. Newer resync requests during an in-flight pass cause another pass
after the first settles.

| Path                                             | Role                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `src/ts/server/bootstrap.ts`                     | Validates bootstrap payloads and exposes writer-intent/read-only variants.                                 |
| `src/ts/server/bootstrapBodyCache.ts`            | Merges module/plugin heavy bodies from bootstrap cache manifests and local cache.                          |
| `src/ts/server/projection.ts`                    | Targeted projection, chat/lorebook hydration, character-selection and collection projections.              |
| `src/ts/server/projectionResync.ts`              | Full-bootstrap recovery for event replay misses, projection gaps, backup restore, partial-success repairs. |
| `src/ts/server/characterShellHydration.svelte.ts` | Hydrates inactive/selected character shell rows through `characterRow`.                                    |
| `src/ts/server/promptTemplateHydration.ts`       | Hydrates stripped prompt-template bodies for selected/requested prompt-preset owners and the compatibility projection. |
| `src/ts/server/messageTranslationJobs.ts`        | Tracks active detached raw-message translation rows from bootstrap and refresh polling.                    |
| `src/ts/process/reattach.ts`                     | Reattaches active durable generation jobs from bootstrap.                                                  |

## Event Reconcile

`src/ts/server/events.ts` subscribes to `/api/v1/events` with the cached
revision as `sinceRevision` / `Last-Event-ID`. Clean closes and stream errors
schedule reconnects with exponential backoff and jitter capped at 30s; malformed
command frames force a read-only full resync before reconnect. `src/ts/bootstrap.ts`
processes command events serially:

- Own echoes are skipped once their revision is already reconciled or applied;
  an own-origin event that arrives before the command response can still
  reconcile immediately.
- Contiguous foreign events fetch `GET /api/v1/projection/:resource`.
- Narrow resources are defined by `RESOURCE_PROJECTION_FIELDS` plus route
  special cases in `server/fastify/src/routes/projection.ts`. Notable special
  cases: `characterSelection` is a narrow fields refresh, `characterRow`
  hydrates one character shell, `message` events hydrate one chat and return
  projection mode `chat-messages`, `preset?id=...` hydrates one bot preset body,
  `asset` advances revision without projected fields, `generation.persisted`
  events are keyed by chat id and may return `generation-chat`, and
  `characterLorebook` uses the lorebook hydration branch. Field-map resources
  also include examples such as `globalLorebook`, `modelPreset`,
  `promptPreset`, `modelProfile`, `agentPreset`, `agentPresetDeleted`,
  `translatorPreset`, `loadout`, `persona`, `plugin`, `moduleUpdated`,
  `moduleEnabled`, and `moduleReordered`. Known
  sprawling resources such as `settings`, `state`, `pluginStorage`, and
  `prompt` intentionally return full-bootstrap mode.
  Applying `fields.characters` re-stubs chat/lorebook-heavy character rows and
  forces relevant hydration state to reset.
- Gaps, replay-unavailable responses, projection failures, unknown resources, or
  server-requested full mode fall back to read-only full bootstrap.
- Memory events bypass projection refresh and update Hypa V3 job/progress UI
  through `memoryJobEvents.ts`; `memoryJobRefresh.ts` polls active jobs for the
  modal when needed.

Server replay is backed by SQLite `command_events` and retained for
`COMMAND_EVENT_HISTORY_LIMIT` revisions. The server subscribes to live command
events before replay, queues any live events that arrive during the replay
flush, then switches to live delivery; heartbeat and memory-event fanout are
armed only after replay succeeds, and slow-consumer overflow tears down the
stream. Memory events are live progress notifications and are not replayed.

## Hydration

Bootstrap and broad targeted projections contain lazy bodies: chat metadata is
present while messages, per-chat `hypaV3Data`, and reroll alternates hydrate on
demand; inactive character rows can be shells; prompt templates and active preset
prompt templates can be stripped; bot presets can be stubs; module/plugin bodies
can be delivered through bootstrap body cache.

Modern `promptPresets[].promptTemplate` is the normal prompt-template owner.
`GET /api/v1/projection/promptItem` can hydrate/project the selected prompt
preset or an explicitly requested prompt-preset owner, and the browser keeps the
top-level `DBState.db.promptTemplate` aligned only as a compatibility
projection/mirror for legacy callers and bridge reconciliation. A selected
modern prompt preset with no `promptTemplate` owns that disabled/missing state;
it should not fall through to stale top-level data.

Agent Preset projection is narrow for normal preset/default edits through
`agentPreset`, returning `agentPresets` and `agentPresetDefaultId`. Deletes use
`agentPresetDeleted` because one command can also clear matching chat
generation settings and loadout references. Browser helpers reconcile those
fields through the regular projection/event path; the Settings editor and chat
selection UI do not mutate `DBState.db.agentPresets` directly.

| Flow                                      | Endpoint                                                        | Browser code                                              |
| ----------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| Active chat tail/range windows            | `GET /api/v1/projection/chatMessages?id=...&tail=...` or `start`/`limit` | `hydrateActiveChatWindow()` via `hydrateActiveChat()`     |
| Complete active chat transcript           | `GET /api/v1/projection/chatMessages?id=...`                            | `hydrateActiveChatFully()`                                |
| Read-many chat histories                  | `POST /api/v1/projection/chatMessages/bulk`                     | `ensureAllChatsHydrated()`                                |
| Active character lorebook                 | `GET /api/v1/projection/characterLorebook?id=...`               | `hydrateActiveCharacterLorebook()`                        |
| Read-many lorebooks                       | `POST /api/v1/projection/characterLorebooks/bulk`               | `ensureAllCharacterLorebooksHydrated()`                   |
| Inactive/selected character shell         | `GET /api/v1/projection/characterRow?id=...`                    | `hydrateSelectedCharacterShell()`                         |
| Prompt-template collection fields         | `GET /api/v1/projection/promptItem`, with `parentId` for explicit prompt-preset owner hydration | `promptTemplateHydration.ts`, owner-keyed by selected/requested prompt preset when present |
| Active preset body                        | `GET /api/v1/projection/preset?id=...`                          | `ensureBotPresetHydrated()` / `fetchServerPresetProjection()` |
| Module/plugin heavy body cache            | `/api/v1/bootstrap` body-cache manifest                         | `bootstrapBodyCache.ts`                                   |

Stale-response drops, hydration-generation resets, and reroll alternate seeding
live in `src/ts/server/chatMessageHydration.svelte.ts`. Character lorebook
hydration is active only when experimental `enableLorebookStubs` is on; the
lorebook bridge tracks hydrated characters to avoid persisting stubs as deletes.

## Projection Write Guard

`src/ts/server/projectionWriteGuard.svelte.ts` wraps server-owned projection
state after Fastify bootstrap. Ordinary UI code should not mutate durable
`DBState.db` fields directly.

Trusted write scopes are for bootstrap/targeted projection application,
chat-message and character-lorebook hydration, command helpers that
intentionally perform optimistic writes, and bridge/draft helpers that can
restore snapshots after failure. The guard swaps server-owned projection state
into a writable working proxy for trusted writes, then refreezes it as a fresh
read-only proxy.

The guard also advances a projection-apply epoch. Settings, character, chat,
lorebook, and script-definition bridge watchers use that epoch to refresh
baselines after passive projection updates without echoing them back as
commands. Prompt-template drafts instead combine hydration state with cached
command-revision reconciliation.

Tests for guard, hydration, event reconcile, or watcher changes that affect
rendered state should follow the visible-state policy in
`testing-and-operations.md`.

## Bridge Watchers

| File                               | Role                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `bridgeFlush.ts`                   | Flushes pending bridge patches on `pagehide` / hidden visibility with `keepalive`. |
| `settingsBridge.svelte.ts`         | Debounced settings groups through `PATCH /commands/settings/:group`, equality-noop suppression, rollback-aware patches. |
| `characterBridge.svelte.ts`        | Character profile/draft bridging through `PATCH /commands/characters/:id`.         |
| `chatBridge.svelte.ts`             | Chat metadata and chat-folder bridging through `PATCH /commands/chats/:id` and chat-folder routes. |
| `lorebookBridge.svelte.ts`         | Global/character/chat/module lorebook replacement routes, hydrated-lorebook guards. |
| `promptTemplateBridge.svelte.ts`   | Prompt item/settings routes, selected-prompt-preset ownership, optimistic writes, rollback, hydration-aware and revision-gated reconciliation. |
| `scriptDefinitionBridge.svelte.ts` | Character/module script and trigger `PUT` routes.                                  |

Common requirements: capture snapshots, suppress no-op updates, respect the
appropriate projection epoch or revision gate, debounce noisy edits, roll back
on failure/conflict, and use trusted optimistic writes only in helpers that
intentionally update local projection before the server response.

## Active Writer And Diagnostics

Active writer is server-side. The latest writer-intent bootstrap owns
`risu-writer-session`; stale guarded mutations receive `423 active_writer_stale`.
Projection write guard is client-side and catches accidental local mutation.

Read-only bootstrap, projection fetches, event streams, durable-generation
reattach, and immutable asset reads do not require writer ownership. Browser
writer-session handling lives in `src/ts/server/activeWriterSession.ts`.

Server protocol metrics are opt-in with `RISU_PROTOCOL_METRICS=1` (also accepts
`true`, `yes`, or `on`). Browser protocol debug logs are opt-in with
`localStorage.setItem('risu:protocol-debug', '1')`. Browser diagnostics include
full-bootstrap resync reasons/resources, hydration concurrency and stale-drop
counters, and asset byte-read fanout counters. Memory job SSE and refresh paths
gate updates through ordering checks, record terminal jobs, and suppress stale
or non-active terminal refresh updates. Relevant files:
`server/fastify/src/protocolMetrics.ts`,
`src/ts/server/protocolDiagnostics.ts`, `src/ts/server/assets.ts`,
`chatMessageHydration.svelte.ts`, `memoryJobRefresh.ts`, and
`projectionResync.ts`.
