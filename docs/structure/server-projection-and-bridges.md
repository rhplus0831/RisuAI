# Server Projection And Bridges

Last audited: 2026-07-10.

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
  trusted write scopes, the known-server and applied-projection revision cursors
  are seeded, the projection write guard is enabled, active generation jobs are
  handed to reattach logic, and active message translations are recorded for
  row-level busy state and refresh polling,
  selected-character shell hydration starts and awaits the selected shell, chat
  message hydration starts and hydrates the active chat, prompt-template
  hydration starts, and `/api/v1/events` subscribes.
- Full recovery uses `fetchServerBootstrapProjectionReadOnly()` so passive
  resync does not steal writer ownership from another browser session.
- Startup also installs `setServerCommandSuccessReconciler()`. A lone command
  reconciles before its public promise settles. When high-level mutations queue,
  accepted responses advance the known revision without holding the serialized
  transport lane through projection work; own response/SSE events are coalesced
  until the lane drains, then the latest event triggers authoritative
  reconciliation. Multiple accepted revisions intentionally form one gap and
  one full resync, covering mixed resources in final server order. Every
  coalesced revision is marked only after the projection succeeds, so later SSE
  echoes are skipped, and all batched mutation promises await that reconcile.

`projectionResync.ts` coalesces concurrent full-resync requests, reads bootstrap
with `cacheRevision: false`, applies the fresh database, advances both revision
cursors before stale hydration checks, syncs selected character state, seeds
active generation reattach state, refreshes active message translations, resets
chat/lorebook hydration, records already-hydrated lorebooks, awaits the selected
character shell, force-hydrates the active chat/lorebook, then restarts
prompt-template hydration. Newer resync requests during an in-flight pass cause
another pass after the first settles.

| Path                                             | Role                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `src/ts/server/bootstrap.ts`                     | Validates bootstrap payloads and exposes writer-intent/read-only variants.                                 |
| `src/ts/server/bootstrapBodyCache.ts`            | Merges module/plugin heavy bodies from bootstrap cache manifests and local cache.                          |
| `src/ts/server/projection.ts`                    | Targeted projection, chat/lorebook hydration, character-selection and collection projections.              |
| `src/ts/server/projectionResync.ts`              | Full-bootstrap recovery for event replay misses, projection gaps, backup restore, partial-success repairs. |
| `src/ts/server/characterShellHydration.svelte.ts` | Hydrates inactive/selected character shell rows through `characterRow`.                                    |
| `src/ts/server/chatGenerationSettingsProjectionGuard.ts` | Preserves the latest optimistic chat generation settings while a targeted character-row projection races a queued save. |
| `src/ts/server/promptTemplateHydration.ts`       | Hydrates stripped prompt-template bodies for selected/requested prompt-preset owners and the compatibility projection. |
| `src/ts/server/messageTranslationJobs.ts`        | Tracks active detached raw-message translation rows from bootstrap and refresh polling.                    |
| `src/ts/process/reattach.ts`                     | Reattaches active durable generation jobs from bootstrap.                                                  |

## Event Reconcile

`src/ts/server/events.ts` subscribes to `/api/v1/events` with the applied
projection revision as `sinceRevision` / `Last-Event-ID`. The separate known
server revision can advance from a command conflict, asset upload, generation,
or Realm completion without causing an unapplied event to be skipped. Clean
closes and stream errors schedule reconnects with exponential backoff and jitter
capped at 30s; malformed command frames force a read-only full resync before
reconnect. `src/ts/bootstrap.ts` processes command events serially:

- Own echoes are skipped once their revision is already reconciled or applied;
  an own-origin event that arrives before the command response can still
  reconcile immediately.
- Contiguous foreign events fetch `GET /api/v1/projection/:resource`.
- Narrow resources are defined by `RESOURCE_PROJECTION_FIELDS` plus route
  special cases in `server/fastify/src/routes/projection.ts`. Notable special
  cases: `characterSelection` is a narrow fields refresh, `characterRow`
  hydrates one character shell, `message` events return the complete affected
  chat in `chat-messages` mode (destructive/replacement events cannot safely use
  a tail window), `preset?id=...` hydrates one bot preset body,
  `asset` advances revision without projected fields, message-only
  `generation.persisted` events are keyed by chat id and return the ranged
  `generation-chat` mode, and `chatTranscript` returns a parent character row
  plus the complete changed transcript in `chat-transcript` mode. The latter is
  used for assembly transcript rewrites, generation plus scriptstate writes,
  and chat create/fork with non-empty messages; the browser applies both halves
  atomically, retaining hydrated sibling chats, or full-resyncs on failure.
  `characterLorebook` uses the lorebook hydration branch. Field-map resources
  also include examples such as `globalLorebook`, `modelPreset`,
  `promptPreset`, `modelProfile`, `agentPreset`, `agentPresetDeleted`,
  `translatorPreset`, `loadout`, `persona`, `plugin`, `moduleUpdated`,
  `moduleEnabled`, and `moduleReordered`. Ordinary grouped settings commands
  put the group in `event.id`; `settings?id=<group>` projects only the keys from
  the command route's authoritative group map. Historical settings events with
  no recognized group still full-bootstrap safely. Other known sprawling
  resources such as `state`, `pluginStorage`, and `prompt` intentionally return
  full-bootstrap mode. `modelPreset` includes the complete applied model-setting
  surface because selected-preset mutations also reapply the selected prompt
  preset's model overrides to root settings.
  Applying `fields.characters` re-stubs chat/lorebook-heavy character rows,
  remaps the live selected-character identity across array replacement (falling
  back to projected `currentChar` if that character was removed), and forces
  relevant hydration state to reset. During a targeted `characterRow`
  merge, a chat whose generation-settings save is still queued preserves its
  latest optimistic `generationSettings` while the incoming row differs from
  that queued value; the pending token is cleared when the save settles. A
  ranged message-only generation append retains an already-loaded transcript
  prefix while extending the array, so the new total does not turn resident
  history into placeholders.
- Gaps, replay-unavailable responses, projection failures, unknown resources, or
  server-requested full mode fall back to read-only full bootstrap. If both a
  targeted reconcile and that fallback fail, the stream reconnects from the
  unchanged applied cursor so SQLite replay retries the consumed event.
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
it should not fall through to stale top-level data. Prompt-item command events
carry their preset owner in `parentId`; background-owner projections update only
that preset row and never replace the selected preset's compatibility mirror.

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

Compatibility chat mutations in `src/ts/chatCommands.ts` choose the narrowest
safe message command: append, single-message update, prefix truncate, single
delete, or tail replacement after a known persisted anchor. Fully hydrated
shapes that cannot use a narrow form may still replace the transcript. A list
containing server message placeholders is never broadly replaced by this
compatibility path. Send-time setup assigns missing ids locally across a fully
loaded transcript, but persists them only for a contiguous suffix after a known
persisted message; other backfilled shapes remain local for that send.

`src/ts/server/chatGenerationSettingsProjectionGuard.ts` is a narrower race
guard, not a replacement for full resync. `dispatchSaveChatGenerationSettings()`
registers the optimistic value while its serialized save is pending, and
targeted character-row merge preserves that value until the save settles.

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
reattach, and immutable asset reads do not require writer ownership. Legacy
storage `write`/`remove` calls do carry the active-writer session because they
mutate server-owned compatibility files. Browser writer-session handling lives
in `src/ts/server/activeWriterSession.ts`.

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
