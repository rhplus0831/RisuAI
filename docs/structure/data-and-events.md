# Data And Events

Fastify owns durable state. The browser receives a projected copy and sends
revision-checked commands or explicit server-owned mutation requests.

## Stores

| Store            | Path                                                                                               | Contents                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite           | `data/risu.db`                                                                                     | `schema_version.version` plus domain `revision`; settings; characters/chats; split tables such as `model_presets`, `prompt_presets`, `plugins`, `plugin_custom_storage`, `messages`, `chat_hypa_v3`, `assets`, `projection_body_cache_state`, `collection_body_revisions`, `command_events`, memory tables/jobs, and `generation_finalization_retries`. Prompt templates are normally owned by `prompt_presets` rows; `prompt_templates` is retained as a compatibility mirror/projection. |
| Asset bytes      | `data/assets/<sha256>.<ext>`                                                                       | Content-addressed images, audio, video, fonts, CSS, ONNX, inlay signatures, and other supported asset types. Metadata is in SQLite `assets`.                                                                         |
| Backups          | `data/backups/<id>/`                                                                               | Snapshot `risu.db`, `manifest.json`, assets when present, and legacy `save/` when present. Creation copies `risu.db` after a WAL checkpoint; restore uses `ATTACH` and swaps only the `SQLITE_BACKUP_TABLES` allowlist. |
| Legacy `db.json` | `data/db.json`                                                                                     | Import-only compatibility input. Boot imports it into SQLite and renames it to `db.json.migrated`.                                                                                                                   |
| Legacy storage   | `data/save/<hex-key>`                                                                              | Compatibility byte store for `/api/v1/storage/*`; active-writer guarded writes do not bump the domain revision.                                                                                                      |
| Auth files       | `data/__password`, `data/__known_public_key_hashes.json`, `data/__known_session_token_hashes.json` | Single-user password data, registered browser public-key hashes, and optional session-token hashes.                                                                                                                  |

Primary boundaries: `db.ts` owns schema/migrations/revision, `repository.ts`
owns domain load/write/projection/import/applyImport/assets/backups,
`messageStore.ts` owns message tables, and `commands/mutations.ts` owns command
transactions. Messages live in `messages` with `(chat_id, seq)` ordering and
`uid` as the message id. Active chat reads filter `alternate = 0`; reroll
alternates use `alternate = 1` plus negative sequence positions. Regenerate
preserves displaced/new candidates as alternates, while send/continue clears the
reroll buffer for the appended path. Per-chat `hypaV3Data` lives in
`chat_hypa_v3`.

Prompt-template ownership follows the split-preset contract:
`prompt_presets.prompt_template` is the durable owner for modern prompt preset
templates. The legacy/top-level `prompt_templates` table remains as a
compatibility projection/mirror for older command shapes, selected-owner
bridges, import/export, and code that still expects `Database.promptTemplate`.
Legacy `botPresets[].promptTemplate` is preserved for old save import/export,
prompt diff reads, and explicit extraction into modern prompt presets, but
normal preset selection/apply does not copy legacy bot-preset templates into the
active top-level collection.

## Revision Contract

Normal command mutations use optimistic concurrency:

1. Read `baseRevision`.
2. Compare it with `schema_version.revision`.
3. Load the needed SQLite-backed domain shape.
4. Mutate through server validators/helpers.
5. Write changed table families in one transaction.
6. Bump the revision exactly once.
7. Persist one command event for that revision.
8. Commit, then emit the live event.

Stale clients receive 409. Browser command helpers cache the latest revision
from bootstrap, command responses, and event reconciliation.

Mutation lanes include targeted/scoped SQLite writers, message-free broad writes,
character-selection writes, and hydrated message mutations. They still share the
same invariant: one revision bump and one persisted command event per normal
command transaction.

Command-event resources should be as narrow as practical and are defined by
`COMMAND_EVENT_CATALOG` plus the projection route's `RESOURCE_PROJECTION_FIELDS`.
Examples include `characterSelection`, `characterRow`, `character`, `chat`,
`chatFolder`, `message`, `globalLorebook`, `characterLorebook`, legacy
`lorebook`, `module`, `moduleUpdated`, `moduleEnabled`, `moduleReordered`,
`moduleScriptDefinition`, `moduleTriggerDefinition`, `scriptDefinition`,
`triggerDefinition`, collection slices such as `preset`/`promptItem`/
`modelPreset`/`promptPreset`/`translatorPreset`/`loadout`, `modelProfile`,
`persona`, `legacyBotPreset`, `plugin`, `asset`, and `generation`. Known
sprawling resources such as `settings`, `state`, `pluginStorage`, and `prompt`
are still command-event resources but intentionally fall back to a full
bootstrap. `asset` is a no-op targeted projection that advances the cached
revision because asset metadata lives outside the projected `Database`.
`generation.persisted` events are keyed by `parentId` = chat id and may return
projection mode `generation-chat`.

## Server-Owned Exceptions

These paths still need explicit auth and active-writer decisions, but they are
not ordinary browser `/commands/*` resource endpoints:

- First-run `POST /api/v1/commands/state/initialize` creates default server
  state and does not accept a browser database payload.
- Asset upload writes asset metadata/bytes and emits `asset.created`; duplicate
  uploads can be idempotent without a new revision.
- Periodic asset GC deletes orphan asset metadata/files after the grace window
  without a revision bump or command event.
- `.risu` import, bundle import, Realm import, and backup restore use
  repository/server-owned paths.
- Server generation can persist assembly-time scriptstate/input-trigger changes
  before provider dispatch. Final generation writes through targeted command
  mutation and emits `generation.persisted`; durable finalization attempts are
  queued in SQLite for retry with target snapshots, pending/terminal status, and
  retained terminal errors that the app prunes on later sweeps. Active durable
  jobs themselves are process-local reattach state. Cancel can persist
  streamed-so-far text through the raw cancel path.
- Raw message translation uses
  `POST /api/v1/commands/messages/:messageId/translate`: the server detaches the
  provider work from the browser request, projects active rows through
  `activeMessageTranslations`, then persists the translated text through a
  targeted message command event if the source row is still unchanged.
- Memory job create/cancel writes durable memory-job state and emits memory
  events without a domain revision.
- Backup create/delete mutate backup files without a domain revision; restore
  replaces repository state and emits `state.restored`. Restore swaps only the
  SQLite table allowlist in `repository.ts`; keep `SQLITE_BACKUP_TABLES` in sync
  with durable tables. Operational rows such as
  `generation_finalization_retries` are not restored unless added to that list.
  As of this audit, split `model_presets` and `prompt_presets` rows are durable
  tables but are not in the restore allowlist, so check that list before relying
  on backup restore for newly split table families.

## Auth And Active Writer

Auth is single-user and route-local. `server/fastify/src/auth.ts` stores
password/public-key/session-token state, `server/fastify/src/http.ts` exposes
`requireAuth()`, and route handlers call it manually unless intentionally public.
Browser auth assertions are sent in `risu-auth`; setup/login also issue a
`session.*` fallback token. Public-key hashes and fallback session-token hashes
are both LRU-capped on disk. `routes/auth.ts` owns status/setup/login, while
`/api/v1/auth/crypto` is registered with legacy storage routes as a public
compatibility hashing helper.
`RISU_AGENT_DEV_AUTH_BYPASS` is an agent/dev escape hatch used by the full-stack
dev runner.

The active-writer guard is separate. Any authenticated bootstrap carrying
`risu-writer-session` latches the latest writer; routes whose manifest decision
is `active-writer` reject stale sessions with `423 active_writer_stale`.
Read-only bootstrap/projection/event routes do not need writer ownership.

`server/fastify/src/routeManifest.ts` is the source of truth for auth,
active-writer, streaming, public exceptions, and read-only POST decisions.

## Projection And Hydration

`GET /api/v1/bootstrap` returns revision, schema version, asset base URL,
`activeGenerationJobs`, `activeMessageTranslations`, optional `bodyCache`, and
a lean database projection. If no database exists, the browser calls
`commands/state/initialize` and refetches bootstrap read-only. Module/plugin body cache uses
`x-risu-body-cache-manifest`, `projection_body_cache_state`, and
`collection_body_revisions` so unchanged heavy bodies can be merged from browser
cache instead of retransmitted.

Bootstrap and broad targeted projections are lean. Chat metadata ships with empty
`message[]`, per-chat `hypaV3Data` and reroll alternates hydrate on demand,
inactive characters can be shell rows, selected/requested prompt-preset
`promptTemplate` bodies and the top-level compatibility projection can be
stripped, bot presets can be stubs, and module/plugin bodies can arrive via body
cache. Heavy fields hydrate on demand:

| Data                                                | Endpoint                                                        |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Active chat messages, tail-window first and later `start`/`limit` ranges | `GET /api/v1/projection/chatMessages?id=...`          |
| Many chat histories                                 | `POST /api/v1/projection/chatMessages/bulk`                     |
| Character lorebook when `enableLorebookStubs` is on | `GET /api/v1/projection/characterLorebook?id=...`               |
| Many character lorebooks                            | `POST /api/v1/projection/characterLorebooks/bulk`               |
| Inactive/selected character shell                   | `GET /api/v1/projection/characterRow?id=...`                    |
| Prompt template collection fields                   | `GET /api/v1/projection/promptItem`, with `parentId` for explicit prompt-preset owner hydration |
| Bot preset body / split preset collection fields    | `GET /api/v1/projection/preset?id=...` and collection resources |

Browser wrappers live in `src/ts/server/projection.ts`; hydration/cache logic
lives in `src/ts/server/chatMessageHydration.svelte.ts`,
`characterShellHydration.svelte.ts`, `promptTemplateHydration.ts`, and
`bootstrapBodyCache.ts`.

## SSE And Streaming

`GET /api/v1/events` replays SQLite `command_events` for cursor reconnects,
then streams live command-sink events plus live memory events. Clients subscribe
with `sinceRevision` or `Last-Event-ID`; replay gaps return
`409 event_replay_unavailable`, after which the browser performs a read-only
full bootstrap before resubscribing. SQLite replay keeps a 1000-revision window
and persists `origin_writer_session_id` for own-echo suppression. The live
command sink can also carry non-replay notifications such as export events at
the current revision. Memory events are never replayed.

Browser reconcile rules: process events serially, skip already-reconciled
own-origin revisions through a 256-entry cache, skip already-applied foreign
revisions, fetch a targeted projection for contiguous foreign events, and fall
back to full bootstrap for gaps, unknown resources, replay misses, or projection
errors. An own-origin event that arrives before the command response advances the
cached revision may still reconcile so local state does not wait for another
event. Memory events update Hypa V3 job/progress UI directly.

Chat generation SSE frame types are `stage`, `job_accepted`, `prompt`, `info`,
`message_patch`, `token`, `side_effect`, `warning`, `error`, and `done`.
`info.revision` or `done.postGeneration.revision` can advance the browser
revision cache after server-owned persistence. Durable jobs buffer protected
replay events (`prompt`, de-duplicated `info`, `message_patch`, `side_effect`,
`warning`, `error`, and `done`) with 512-event and 2 MiB caps; trimming drops
unprotected frames and stops once only protected frames remain. They emit viewer
heartbeat comments and can persist streamed-so-far text through raw
cancel/finalization retry paths. Bootstrap `activeGenerationJobs` exposes
running durable jobs, including mode and regenerate message id when relevant,
while `activeMessageTranslations` exposes in-flight detached raw-message
translation rows.

Other streaming/binary surfaces include optional completion SSE, optional Realm
progress SSE, proxy stream WebSocket attachment, asset bytes, `.risu`/bundle
export, and proxy/hub/storage binary passthrough. Command-event SSE, chat
generation SSE, and proxy stream/WebSocket writers use
`server/fastify/src/streamBackpressure.ts` to cap buffered bytes at 2 MiB for
slow clients; completion SSE and Realm progress SSE currently write directly to
`reply.raw`.
