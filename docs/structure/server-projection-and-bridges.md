# Server Projection And Bridges

The browser is a projected client in Fastify mode. Fastify owns durable state;
the Svelte app receives a message-light projection, hydrates heavy fields on
demand, and routes persisted edits through command helpers or other
server-owned mutation routes.

## Bootstrap And Resync

`src/ts/bootstrap.ts` is the browser coordinator:

- `fetchServerBootstrapProjection()` sends the active-writer intent header and
  reads `/api/v1/bootstrap`.
- If the server has no database yet, `initializeServerDatabase()` calls
  `POST /api/v1/commands/state/initialize`; the browser then refetches bootstrap
  through the read-only helper before rendering.
- The returned projection is applied through trusted projection write scopes,
  the command revision cache is seeded, the projection write guard is enabled,
  `activeGenerationJobs` is handed to reattach logic, and the event stream is
  started.
- Full resyncs use `fetchServerBootstrapProjectionReadOnly()` so passive
  recovery does not steal active-writer ownership from another browser session.

`src/ts/server/bootstrap.ts` validates bootstrap payloads and exposes the
writer-intent and read-only variants. `src/ts/server/projection.ts` wraps
targeted projection, chat-message hydration, and character-lorebook hydration.
`src/ts/server/projectionResync.ts` is the shared full-bootstrap recovery path
used by event replay misses, projection gaps, backup restore, and other
partial-success repairs.

## Event Reconcile

`src/ts/server/events.ts` subscribes to `/api/v1/events` with the cached command
revision as `sinceRevision` / `Last-Event-ID`. `src/ts/bootstrap.ts` processes
command events serially:

- Own echoes and already-applied revisions are skipped.
- Contiguous foreign events fetch `GET /api/v1/projection/:resource`.
- Gaps, replay-unavailable responses, projection failures, unknown resources,
  or server-requested full mode fall back to read-only full bootstrap.
- Memory events bypass projection refresh and update Hypa V3 progress UI.

Server replay is backed by SQLite command-event history and is retained for
`COMMAND_EVENT_HISTORY_LIMIT` revisions. Live-only command-shaped events such as
`state.exported` are not replayable and do not require a projection refresh.
Memory events are live progress notifications. Bootstrap applies their Hypa V3
progress side effect through `src/ts/process/request/serverMemory.ts` and
republishes parsed `memory.job` events through
`src/ts/server/memoryJobEvents.ts`; `src/ts/server/memoryJobRefresh.ts` uses
those events so memory-job panels can refresh without polling continuously.

## Hydration

Normal bootstrap and targeted projection payloads contain chat stubs: messages,
per-chat `hypaV3Data`, and reroll alternates are loaded only for hydrated chats.

Important files:

- `src/ts/server/chatMessageHydration.svelte.ts` hydrates the active chat,
  rehydrates after full re-stubs, seeds reroll alternates, and drops stale
  hydration responses older than the applied revision.
- `ensureAllChatsHydrated()` and `ensureAllCharacterLorebooksHydrated()` are for
  bulk readers such as export, tokenizer, and cold-storage flows. Both use
  `BULK_HYDRATION_CONCURRENCY = 4`.
- Character `globalLore` hydration only runs when the experimental
  `enableLorebookStubs` setting is on. The lorebook bridge marks hydrated
  characters so edits to real lorebook data can be persisted safely.

When debugging missing chat rows or stale lorebooks, check the applied revision,
hydration generation resets, stale-response drops, and whether a full resync
re-stubbed the local projection.

## Projection Write Guard

`src/ts/server/projectionWriteGuard.svelte.ts` wraps server-owned projection
state after Fastify bootstrap. Ordinary UI code should not mutate
`DBState.db` directly in Fastify mode.

Trusted write scopes are reserved for:

- Bootstrap and targeted projection application.
- Hydration of chat messages and character lorebooks.
- Optimistic command helpers that immediately dispatch a server command and can
  roll back from a captured snapshot.
- Bridge watchers that mirror UI drafts into command-backed fields.

A projection guard error usually means a browser feature still needs a
command-backed write path.

Server projection application also advances a shared watcher epoch. Bridge
watchers use that epoch to refresh their server-applied baselines without
echoing a passive projection refresh back as a command.

## Bridge Watchers

The bridge layer converts UI-local edits into server commands without letting a
server projection refresh erase in-progress edits.

| File                                             | Role                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `src/ts/server/settingsBridge.svelte.ts`         | Debounced settings groups, equality-noop suppression, and rollback-aware server patches.                              |
| `src/ts/server/characterBridge.svelte.ts`        | Character profile fields and compatible character updates.                                                            |
| `src/ts/server/chatBridge.svelte.ts`             | Chat metadata and selected-chat command bridging.                                                                     |
| `src/ts/server/lorebookBridge.svelte.ts`         | Character/module/global lorebook replacement, hydrated-lorebook guards, and no-data-loss behavior when stubs refresh. |
| `src/ts/server/scriptDefinitionBridge.svelte.ts` | Character/module regex script and trigger replacement commands.                                                       |

Common pattern: capture a snapshot, make an optimistic trusted projection write,
send a revision-checked command, and restore the snapshot if the command fails or
conflicts.

## Active Writer Vs Projection Guard

These are separate protections:

- The active-writer lease is server-side. The latest writer-intent bootstrap
  latches `risu-writer-session`; stale mutating requests receive
  `423 active_writer_stale`. The browser alerts and reloads on that response.
- The projection write guard is client-side. It catches accidental direct writes
  to server-owned state before they become silent local divergence.

Read-only bootstrap, projection fetches, event streams, durable-generation
reattach, and ordinary asset reads do not require writer ownership.

Browser-side writer-session header creation and stale-session reload handling
live in `src/ts/server/activeWriterSession.ts`.

## Diagnostics

Server protocol metrics are opt-in with `RISU_PROTOCOL_METRICS=1` (also accepts
`true`, `yes`, or `on`). Browser protocol debug logs are opt-in with
`localStorage.setItem('risu:protocol-debug', '1')`.

Relevant files:

- `server/fastify/src/protocolMetrics.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/projectionResync.ts`
