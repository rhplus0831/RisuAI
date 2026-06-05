# Server Projection And Bridges

The browser is a projected client. Fastify owns durable state; Svelte receives a
lean projection, hydrates heavy fields on demand, and routes persistent edits
through command helpers or explicit server-owned mutation routes.

## Bootstrap And Resync

`src/ts/bootstrap.ts` coordinates startup:

- `fetchServerBootstrapProjection()` sends writer intent and reads
  `/api/v1/bootstrap`.
- Empty bootstrap (`database: null`) triggers `POST
/api/v1/commands/state/initialize`, then a read-only bootstrap refetch.
- The returned projection is applied through trusted write scopes, the revision
  cache is seeded, the projection write guard is enabled, active generation jobs
  are handed to reattach logic, hydration starts, and events subscribe.
- Full recovery uses `fetchServerBootstrapProjectionReadOnly()` so passive
  resync does not steal writer ownership from another browser session.
- Running durable generation jobs arrive in bootstrap as `activeGenerationJobs`
  and are handed to `src/ts/process/reattach.ts`.

Important files:

- `src/ts/server/bootstrap.ts` validates bootstrap payloads and exposes
  writer-intent/read-only variants.
- `src/ts/server/projection.ts` wraps targeted projection, single chat/lorebook
  hydration, bulk chat/lorebook hydration, and character-selection projection.
- `src/ts/server/projectionResync.ts` is the full-bootstrap recovery path for
  event replay misses, projection gaps, backup restore, and partial-success repairs.

## Event Reconcile

`src/ts/server/events.ts` subscribes to `/api/v1/events` with the cached revision
as `sinceRevision` / `Last-Event-ID`. `src/ts/bootstrap.ts` processes command
events serially:

- Own echoes and already-applied revisions are skipped.
- Contiguous foreign events fetch `GET /api/v1/projection/:resource`.
- `character.selected` uses the narrow `characterSelection` resource.
- Gaps, replay-unavailable responses, projection failures, unknown resources, or
  server-requested full mode fall back to read-only full bootstrap.
- Memory events bypass projection refresh and update Hypa V3 job/progress UI
  through `memoryJobEvents.ts`; `memoryJobRefresh.ts` polls active jobs for the
  modal when needed.

Server replay is backed by SQLite `command_events` and retained for
`COMMAND_EVENT_HISTORY_LIMIT` revisions. Memory events are live progress
notifications and are not replayed.

## Hydration

Bootstrap and broad targeted projections contain chat stubs: chat metadata is
present, while messages, per-chat `hypaV3Data`, and reroll alternates hydrate on
demand.

| Flow                      | Endpoint                                          | Browser code                                              |
| ------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| Active chat messages      | `GET /api/v1/projection/chatMessages?id=...`      | `hydrateActiveChat()` in `chatMessageHydration.svelte.ts` |
| Read-many chat histories  | `POST /api/v1/projection/chatMessages/bulk`       | `ensureAllChatsHydrated()`                                |
| Active character lorebook | `GET /api/v1/projection/characterLorebook?id=...` | `hydrateActiveCharacterLorebook()`                        |
| Read-many lorebooks       | `POST /api/v1/projection/characterLorebooks/bulk` | `ensureAllCharacterLorebooksHydrated()`                   |

Stale-response drops, hydration-generation resets, and reroll alternate seeding
live in `src/ts/server/chatMessageHydration.svelte.ts`. Character lorebook
hydration is only active when experimental `enableLorebookStubs` is on; the
lorebook bridge tracks hydrated characters to avoid persisting stubs as deletes.

## Projection Write Guard

`src/ts/server/projectionWriteGuard.svelte.ts` wraps server-owned projection
state after Fastify bootstrap. Ordinary UI code should not mutate `DBState.db`
directly for durable fields.

Trusted write scopes are for:

- Bootstrap and targeted projection application.
- Chat-message and character-lorebook hydration.
- Command helpers that perform immediate trusted optimistic writes.
- Bridge/draft helpers that can restore captured snapshots after failure.

The guard also advances a projection-apply epoch. Bridge watchers use that epoch
to refresh baselines after passive projection updates without echoing them back
as commands.

## Bridge Watchers

Bridge files:

| File                               | Role                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `settingsBridge.svelte.ts`         | Debounced settings groups, equality-noop suppression, rollback-aware patches.   |
| `characterBridge.svelte.ts`        | Character profile and compatible-character command bridging.                    |
| `chatBridge.svelte.ts`             | Chat metadata and chat-folder command bridging.                                 |
| `lorebookBridge.svelte.ts`         | Global/character/chat/module lorebook replacement, hydrated-lorebook guards.    |
| `promptTemplateBridge.svelte.ts`   | Prompt-template optimistic writes, rollback, and revision-gated reconciliation. |
| `scriptDefinitionBridge.svelte.ts` | Character/module script and trigger replacement commands.                       |

Common ideas, not a single mandatory implementation pattern:

- Capture snapshots before dispatching command-backed edits.
- Suppress no-op/equal updates.
- Respect projection-apply epochs so passive refreshes do not re-dispatch.
- Queue/debounce edits where UI writes are noisy.
- Roll back from snapshots when a command fails or conflicts.
- Use trusted optimistic writes only in helpers that intentionally update local
  projection before the server response.

## Active Writer Vs Projection Guard

These protections are separate:

- Active writer is server-side. The latest writer-intent bootstrap owns
  `risu-writer-session`; stale guarded mutations receive
  `423 active_writer_stale`.
- Projection write guard is client-side. It catches accidental local mutation of
  server-owned state before silent divergence.

Read-only bootstrap, projection fetches, event streams, durable-generation
reattach, and immutable asset reads do not require writer ownership. Browser
writer-session handling lives in `src/ts/server/activeWriterSession.ts`.

## Diagnostics

Server protocol metrics are opt-in with `RISU_PROTOCOL_METRICS=1` (also accepts
`true`, `yes`, or `on`). Browser protocol debug logs are opt-in with
`localStorage.setItem('risu:protocol-debug', '1')`.

Relevant files:

- `server/fastify/src/protocolMetrics.ts`
- `src/ts/server/protocolDiagnostics.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/projectionResync.ts`
