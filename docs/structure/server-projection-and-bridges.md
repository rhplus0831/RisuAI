# Server Projection And Bridges

The browser is a projected client. Fastify owns durable state; Svelte receives a
lean projection, hydrates heavy fields on demand, and routes persistent edits
through command helpers or explicit server-owned mutation routes.

## Bootstrap And Resync

`src/ts/bootstrap.ts` coordinates startup:

- `fetchServerBootstrapProjection()` sends writer intent and reads
  `/api/v1/bootstrap`.
- Empty bootstrap (`database: null`) triggers
  `POST /api/v1/commands/state/initialize`, then a read-only bootstrap refetch.
- The projection is merged with any bootstrap body-cache entries, applied through
  trusted write scopes, revision cache is seeded, projection write guard is
  enabled, active generation jobs are handed to reattach logic, character shell
  and prompt-template hydration start, chat hydration starts, and
  `/api/v1/events` subscribes.
- Full recovery uses `fetchServerBootstrapProjectionReadOnly()` so passive
  resync does not steal writer ownership from another browser session.

| Path                                             | Role                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `src/ts/server/bootstrap.ts`                     | Validates bootstrap payloads and exposes writer-intent/read-only variants.                                 |
| `src/ts/server/bootstrapBodyCache.ts`            | Merges module/plugin heavy bodies from bootstrap cache manifests and local cache.                          |
| `src/ts/server/projection.ts`                    | Targeted projection, chat/lorebook hydration, character-selection and collection projections.              |
| `src/ts/server/projectionResync.ts`              | Full-bootstrap recovery for event replay misses, projection gaps, backup restore, partial-success repairs. |
| `src/ts/server/characterShellHydration.svelte.ts` | Hydrates inactive/selected character shell rows through `characterRow`.                                    |
| `src/ts/server/promptTemplateHydration.ts`       | Hydrates stripped prompt-template and preset prompt bodies.                                                |
| `src/ts/process/reattach.ts`                     | Reattaches active durable generation jobs from bootstrap.                                                  |

## Event Reconcile

`src/ts/server/events.ts` subscribes to `/api/v1/events` with the cached
revision as `sinceRevision` / `Last-Event-ID`. `src/ts/bootstrap.ts` processes
command events serially:

- Own echoes and already-applied revisions are skipped.
- Contiguous foreign events fetch `GET /api/v1/projection/:resource`.
- Narrow resources include `characterSelection`, `characterRow`, `preset`,
  `promptItem`, `modelPreset`, `promptPreset`, `translatorPreset`, `loadout`,
  `plugin`, `asset`, and `generation`. `generation.persisted` events are keyed by
  chat id and may return projection mode `generation-chat`.
- Gaps, replay-unavailable responses, projection failures, unknown resources, or
  server-requested full mode fall back to read-only full bootstrap.
- Memory events bypass projection refresh and update Hypa V3 job/progress UI
  through `memoryJobEvents.ts`; `memoryJobRefresh.ts` polls active jobs for the
  modal when needed.

Server replay is backed by SQLite `command_events` and retained for
`COMMAND_EVENT_HISTORY_LIMIT` revisions. Memory events are live progress
notifications and are not replayed.

## Hydration

Bootstrap and broad targeted projections contain lazy bodies: chat metadata is
present while messages, per-chat `hypaV3Data`, and reroll alternates hydrate on
demand; inactive character rows can be shells; prompt templates and active preset
prompt templates can be stripped; bot presets can be stubs; module/plugin bodies
can be delivered through bootstrap body cache.

| Flow                                      | Endpoint                                                        | Browser code                                              |
| ----------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| Active chat messages, tail/range windows  | `GET /api/v1/projection/chatMessages?id=...&tail=...` or `start`/`limit` | `hydrateActiveChat()` in `chatMessageHydration.svelte.ts` |
| Read-many chat histories                  | `POST /api/v1/projection/chatMessages/bulk`                     | `ensureAllChatsHydrated()`                                |
| Active character lorebook                 | `GET /api/v1/projection/characterLorebook?id=...`               | `hydrateActiveCharacterLorebook()`                        |
| Read-many lorebooks                       | `POST /api/v1/projection/characterLorebooks/bulk`               | `ensureAllCharacterLorebooksHydrated()`                   |
| Inactive/selected character shell         | `GET /api/v1/projection/characterRow?id=...`                    | `hydrateSelectedCharacterShell()`                         |
| Prompt-template item / active preset body | `GET /api/v1/projection/promptItem?id=...`, `preset` projection | `promptTemplateHydration.ts`                              |
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
chat-message and character-lorebook hydration, command helpers that intentionally
perform optimistic writes, and bridge/draft helpers that can restore snapshots
after failure.

The guard also advances a projection-apply epoch. Bridge watchers use that epoch
to refresh baselines after passive projection updates without echoing them back
as commands.

Tests for guard, hydration, event reconcile, or watcher changes that affect
rendered state should follow the visible-state policy in
`testing-and-operations.md`.

## Bridge Watchers

| File                               | Role                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `bridgeFlush.ts`                   | Flushes pending bridge patches on `pagehide` / hidden visibility with `keepalive`. |
| `settingsBridge.svelte.ts`         | Debounced settings groups, equality-noop suppression, rollback-aware patches.      |
| `characterBridge.svelte.ts`        | Character profile and compatible-character command bridging.                       |
| `chatBridge.svelte.ts`             | Chat metadata and chat-folder command bridging.                                    |
| `lorebookBridge.svelte.ts`         | Global/character/chat/module lorebook replacement, hydrated-lorebook guards.       |
| `promptTemplateBridge.svelte.ts`   | Prompt-template optimistic writes, rollback, revision-gated reconciliation.        |
| `scriptDefinitionBridge.svelte.ts` | Character/module script and trigger replacement commands.                          |

Common requirements: capture snapshots, suppress no-op updates, respect
projection-apply epochs, debounce noisy edits, roll back on failure/conflict, and
use trusted optimistic writes only in helpers that intentionally update local
projection before the server response.

## Active Writer And Diagnostics

Active writer is server-side. The latest writer-intent bootstrap owns
`risu-writer-session`; stale guarded mutations receive `423 active_writer_stale`.
Projection write guard is client-side and catches accidental local mutation.

Read-only bootstrap, projection fetches, event streams, durable-generation
reattach, and immutable asset reads do not require writer ownership. Browser
writer-session handling lives in `src/ts/server/activeWriterSession.ts`.

Server protocol metrics are opt-in with `RISU_PROTOCOL_METRICS=1` (also accepts
`true`, `yes`, or `on`). Browser protocol debug logs are opt-in with
`localStorage.setItem('risu:protocol-debug', '1')`. Relevant files:
`server/fastify/src/protocolMetrics.ts`,
`src/ts/server/protocolDiagnostics.ts`, `chatMessageHydration.svelte.ts`, and
`projectionResync.ts`.
