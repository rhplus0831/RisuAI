# Data And Events

Last audited: 2026-07-20.

Fastify owns durable state. The browser reads authenticated REST resources and
sends revision-checked commands or explicit server-owned mutation requests.

## Stores

| Store            | Location                                                                                           | Role                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite           | `data/risu.db`                                                                                     | Authoritative schema/revision/lineage plus normalized domain and operational tables.                                                        |
| Asset bytes      | `data/assets/<sha256>.<ext>`                                                                       | Content-addressed supported binaries; metadata lives in SQLite `assets`.                                                                    |
| Inlay catalog    | SQLite `inlay_catalog`                                                                             | Revisioned names, dimensions, and aliases keyed to immutable `assets` rows; the browser keeps a separate read projection.                   |
| Backups          | `data/backups/<id>/`                                                                               | Database snapshot, manifest, assets, and legacy storage when present; restore uses an explicit table allowlist.                             |
| Legacy `db.json` | `data/db.json`                                                                                     | Import-only input renamed to `db.json.migrated` after boot conversion.                                                                      |
| Legacy storage   | `data/save/<hex-key>`                                                                              | Compatibility bytes for `/api/v1/storage/*`; guarded writes do not bump the domain revision.                                                |
| Auth files       | `data/__password`, `data/__known_public_key_hashes.json`, `data/__known_session_token_hashes.json` | Single-user password, registered browser-key hashes, and optional session-token hashes.                                                     |
| Web Push keys    | `data/__web_push_vapid_keys.json`                                                                  | Generated VAPID keypair; subscription rows live in SQLite.                                                                                  |
| Resource cache   | Browser IndexedDB `risu-resource-cache-v1`                                                         | Disposable authenticated-hash read cache; never offline or authoritative state.                                                             |
| Mutation outbox  | Browser IndexedDB `risu-pending-mutations-v1`                                                      | Crash-recovery journal with AES-GCM-encrypted intent payloads plus plaintext scope/order metadata and receipt-ACK rows; never server truth. |

Primary boundaries: `db.ts` owns schema/migrations/revision, `repository.ts`
owns domain load/write/resource-read/import/applyImport/assets/backups,
`messageStore.ts` owns message tables, and `commands/mutations.ts` owns command
transactions. Messages live in `messages` with `(chat_id, seq)` ordering and
`uid` as the message id. Active chat reads filter `alternate = 0`; reroll
alternates use `alternate = 1` plus negative sequence positions. Regenerate
preserves displaced/new candidates as alternates, while send/continue clears the
reroll buffer for the appended path. Per-chat `hypaV3Data` lives in
`chat_hypa_v3`.

`CURRENT_SCHEMA_VERSION` is 26. SQLite includes settings; character, chat,
message, and per-chat memory rows; split collections; assets; command events and
mutation receipts; the inlay catalog; push subscriptions; Hypa V3 memory state; and generation
finalization retries. Migration v22 drops the retired
`collection_body_revisions` and `projection_body_cache_state` tables; v23
persists stable ids for legacy global lorebooks and entries; v24 adds durable
command-mutation receipts; v25 adds persistent database lineage, durable active
writer ownership/epochs, and acknowledged-receipt tombstones; v26 adds the
`inlay_catalog` table. Current browser state is rebuilt from concrete REST
resources rather than a cached database projection.

Prompt-template ownership follows the split-preset contract:
`prompt_presets.prompt_template` is the durable owner for modern prompt preset
templates. The legacy/top-level `prompt_templates` table remains as a
compatibility mirror for older command shapes, selected-owner
bridges, import/export, and code that still expects `Database.promptTemplate`.
Legacy `botPresets[].promptTemplate` is preserved for old save import/export,
prompt diff reads, and explicit extraction into modern prompt presets, but
normal preset selection/apply does not copy legacy bot-preset templates into the
active top-level collection.

## Revision Contract

Normal command mutations use optimistic concurrency:

1. Check a supplied durable mutation id for an existing receipt.
2. Read `baseRevision` when no receipt exists.
3. Compare it with `schema_version.revision`.
4. Load the needed SQLite-backed domain shape.
5. Mutate through server validators/helpers.
6. Write changed table families in one transaction.
7. Bump the revision exactly once.
8. Persist one command event and, when requested, its mutation receipt.
9. Commit, then emit the live event.

`risu-mutation-id` receipts are globally keyed within the current database
lineage, supplied in `risu-database-lineage`, so an accepted mutation remains
idempotent across active-writer session changes without crossing a destructive
import/restore boundary. The authenticated command pre-handler returns an
existing receipt before route validation or side effects; the transaction also
checks again to close concurrent races. The current active writer is still
required to submit a replay or acknowledge receipts. A receipt stores the
original revision, event, and compact response extras atomically with the domain
write; a replay emits no second event. Unacknowledged receipts are never
age- or count-pruned. After the browser has durably deleted an outbox intent, it
acknowledges `{ mutationId, requestCount, databaseLineage }` at
`POST /api/v1/commands/mutation-receipts/ack`. The base id and deterministic
`.1`, `.2`, … ids remain as replayable tombstones for 24 hours before lazy
cleanup, without changing the domain revision.

The server mutation receipt is distinct from the browser's durable mutation
intent. Before network dispatch, the browser stages the intent in the encrypted
outbox and waits for that generation to persist; plaintext scope and ordering
metadata keeps dependency lanes replayable. Accepted mutations atomically remove
their intent and queue the server-receipt acknowledgement. Transient transport
or server failures retain the encrypted intent for replay. A genuine
stale-writer rejection also remains encrypted so the same browser writer
session can reclaim a newer epoch and replay it. Conclusive validation/not-found,
database-lineage, invalid receipt-id, and malformed permanent-status responses
discard the intent only with an explicit user-visible notice naming the affected
mutation scope. Clearing this non-authoritative journal can therefore lose
unsent local edits even though it never represents server state, so disposal is
never silent.

Authenticated startup reads any single unambiguous pending owner before taking
writer ownership, prepares the outbox against the returned writer session and
database lineage, flushes retained receipt acknowledgements, and replays pending
mutations before resource hydration. Older epochs belonging to that same writer
session remain eligible after a reclaim. Other sessions in the current lineage
remain encrypted and dormant: they are excluded from this tab's replay, list,
and raw-row startup count, so only the owning tab blocks on them and can reclaim
them later. Multiple dormant owners make pre-bootstrap owner adoption ambiguous
and are left untouched. There is deliberately no age-based purge because a
frozen/offline tab cannot be proven dead; the encrypted payload cap and browser
storage quota bound retention, while explicit outbox clearing and database
lineage rotation are the only disposal boundaries. Different lineages do not
cross the scope and are conclusively discarded during preparation. Transient
intents remain encrypted for a later retry. Any retained or unreadable raw row
owned by the current session stops startup from hydrating resources on top of
unresolved local work.

Stale clients receive 409. Browser command helpers cache the latest revision
from bootstrap, command responses, and event reconciliation.

High-level browser mutations share one serialized transport lane so each request
uses the revision accepted by the preceding request. Accepted responses advance
the known-server cursor immediately, but response reconciliation is deferred
while later mutations are queued. Once the lane drains, success events are
ordered by revision. Verified contiguous local effects can advance their
resource slices without a GET; remaining events are coalesced into one
authoritative invalidation plan. Contiguous multi-revision batches may combine
targeted reads; an actual revision gap triggers one complete resource refresh.
The mutation promises settle only after that shared reconciliation, while
explicitly unqueued operations such as raw message translation retain immediate
response reconciliation.

Mutation lanes include targeted/scoped SQLite writers, message-free broad writes,
character-selection writes, and hydrated message mutations. They still share the
same invariant: one revision bump and one persisted command event per normal
command transaction.

Settings-, collection-, character-, and chat-scoped loaders omit unrelated
tables and asset/message scans, with broad fallback for legacy/pre-extraction or
unrepresentable rows. A scoped snapshot is never eligible for whole-database
write-back. Targeted repository writers update only the owning row/table inside
the mutation transaction; exact character/chat loaders and writers bypass
unrelated normalization, and row-level edits preserve unrelated rowids.

Sparse command contracts cover settings objects/global scripts, preset and
persona field patches, chat generation settings (including nested sidebar
toggles), prompt/lorebook rows, and script/trigger definition
create/update/delete/reorder operations. Server responses avoid echoing accepted
payloads: they name acknowledged keys and return only canonical
differences/deletions, or supply a digest/certificate for the resulting state.
This compact local-effect acknowledgement is a third artifact, separate from
both the browser outbox intent and the server mutation receipt: it only certifies
that already-visible optimistic state can advance without a GET.
Chat-generation-settings acknowledgements require a matching base digest;
definition and persona acknowledgements certify collection/profile state. The
browser combines the acknowledgement with its client-only optimistic snapshot
and resource/projection epochs. A local effect is applied only when the response
event type/owners match and its revision is exactly next; malformed, stale,
tainted, missing, or non-contiguous acknowledgements fail closed to the normal
authoritative event read.

Command-event resources should be as narrow as practical and are defined by
`COMMAND_EVENT_CATALOG`. `src/ts/server/resourceInvalidation.ts` maps those
protocol keys to concrete REST reads. Examples include `characterSelection`,
`characterOrder`, `characterRow`, `character`, `message`, `globalLorebook`,
`characterLorebook`, legacy `chat`/`chatFolder` and `lorebook`, `module`,
`moduleCreated`, `moduleUpdated`, `moduleEnabled`, `moduleReordered`,
`moduleScriptDefinition`, `moduleTriggerDefinition`, legacy-preset keys
`presetRow`/`presetCollection`/`presetApplied`, collection keys such as
`promptItem`/`modelPreset`/`promptPreset`/`translatorPreset`/`loadout`,
`modelProfile`, `agentPreset`, `agentPresetDeleted`, `persona`,
`legacyBotPreset`, `pluginCollection`, `pluginCollectionWithProvider`,
`pluginProvider`, `pluginStorage`, `asset`, `generation`, `chatTranscript`, and
the standalone `inlayCatalog` resource. The broad `plugin` key remains a
compatibility case for retained events from older servers.

Grouped settings events reread `/api/v1/settings/:group`; broader settings-like
events reread `/api/v1/settings`. Collection events reread the owning
`/api/v1/collections/:name`. These cache-capable reads prefer authenticated
hash-aware POSTs and fall back to their full GET forms. Character
selection/order events use narrow pointer resources, while structural character
events reread the list or one row.
Message/transcript events reread the complete affected chat body; an
unambiguous generation event rereads only its changed suffix. Character
lorebook events use the single or bulk lorebook endpoint. `asset` and explicit
revision-only events advance the applied revision without an application-data
read. `inlayCatalog` events reread `GET /api/v1/inlay-assets`. Broad
`state`/`lorebook` events, unknown resources, missing required owner ids, and
revision gaps fall back to a common-revision refresh of settings, collections,
characters, and the inlay catalog. Plugin storage is always applied as a
complete map, with pending local operations replayed over the incoming value
until their commands settle.

Character list and row responses omit message bodies and, when
`enableLorebookStubs` is true, character lorebooks. Resource application keeps
resident chat/lorebook bodies for surviving same-id rows during safe targeted
updates, but a complete refresh deliberately resets them to stubs and forces
lazy rehydration. Verified compact local-effect acknowledgements can locally
acknowledge settings, preset/persona patches, prompt/script/lorebook rows,
modules/plugins, characters/chats/messages, loadout operations, and chat-generation
settings without a GET. Domain-specific pending-value and projection-epoch
guards keep in-flight reads or older acknowledgements from replacing newer
optimistic edits.

## Server-Owned Exceptions

These paths still need explicit auth and active-writer decisions, but they are
not ordinary browser `/commands/*` resource endpoints:

- First-run `POST /api/v1/commands/state/initialize` creates default server
  state and does not accept a browser database payload.
- Direct `/api/v1/assets` and `/api/v1/assets/bulk` uploads write asset
  metadata/bytes outside the domain revision and emit no command event;
  duplicate uploads are idempotent. Import and Realm flows can instead persist
  staged assets through revisioned `asset.created` transactions.
- Inlay catalog `PUT`/`DELETE /api/v1/commands/inlay-assets/:assetId` operations
  are ordinary revisioned commands. They update only `inlay_catalog`, emit
  `inlayCatalog.upserted`/`inlayCatalog.deleted`, and never rewrite immutable
  asset bytes.
- Periodic asset GC deletes orphan asset metadata/files after the grace window
  without a revision bump or command event.
- Legacy storage write/remove mutates `data/save/<hex-key>` compatibility files
  under active-writer guard without a domain revision or command event.
- `.risu` import, bundle import, Realm import, and backup restore use
  repository/server-owned paths.
- Server generation can persist assembly-time scriptstate/input-trigger changes
  before provider dispatch. Final generation writes through targeted command
  mutation and emits `generation.persisted`. Assembly and finalization
  scriptstate changes write only the target `chats` row alongside any affected
  `messages`, rather than rewriting unrelated database tables. Durable finalization attempts are
  queued in SQLite for retry with target snapshots, pending/terminal status, and
  retained terminal errors that the app prunes on later sweeps. Active durable
  jobs themselves are process-local reattach state. Cancel can persist
  streamed-so-far text through the raw cancel path.
- Raw message translation uses
  `POST /api/v1/commands/messages/:messageId/translate`: the server detaches the
  provider work from the browser request and persists through a targeted message
  command event only when both the source message and its previous translation
  still match. Bootstrap `activeMessageTranslations` includes running and
  bounded recent terminal recovery rows; retention is owned by
  [Backend Map](backend.md#generation-and-memory).
- Memory job create/cancel writes durable memory-job state and emits memory
  events without a domain revision.
- The startup push service loads or generates VAPID keys; push notification
  subscription create/delete routes mutate operational Web Push rows without a
  domain revision. They are authenticated runtime state, not application
  resource state.
- Backup create/delete mutate backup files without a domain revision; restore
  replaces repository state and emits `state.restored`. Backup creation uses
  the online `node:sqlite` backup API after a checked WAL checkpoint, but restore
  swaps only the SQLite table allowlist in `repository.ts` via `ATTACH`. Operational tables
  may therefore exist in the physical copy without being restored. Destructive
  import and restore rotate the current database lineage and clear server
  mutation receipts, so receipt and browser-outbox scopes from the old lineage
  do not cross that boundary. [Assets And Saves](assets-and-saves.md#backups)
  owns the exact restored-table and file contract.

## Auth And Active Writer

Auth is single-user and route-local. `server/fastify/src/auth.ts` stores
password/public-key/session-token state, `server/fastify/src/http.ts` exposes
`requireAuth()`, and route handlers call it manually unless intentionally public.
Browser auth assertions are sent in `risu-auth`; setup/login also issue a
`session.*` fallback token. Public-key hashes and fallback session-token hashes
are both LRU-capped on disk. `routes/auth.ts` owns status/setup/login, while
`/api/v1/auth/crypto` is registered with legacy storage routes as a public
compatibility hashing helper. `GET /api/v1/push/vapid-public-key` is also public
so the browser can decide whether Web Push registration is available;
subscription create/delete routes remain authenticated.
`RISU_AGENT_DEV_AUTH_BYPASS` is an agent/dev escape hatch used by the full-stack
dev runner; `pnpm dev:agent` enables it by default, while `pnpm dev:human`
leaves password auth enabled by default.

The active-writer guard is separate. Any authenticated bootstrap carrying
`risu-writer-session` latches the latest writer durably and advances a monotonic
writer epoch when ownership changes; routes whose manifest decision is
`active-writer` reject stale sessions with `423 active_writer_stale` even after
a server restart. Ownership changes are also published through a live-only
writer event bus. A stale browser shows a refresh-or-stay dialog: refresh
reclaims ownership with the same session id, while stay closes server
communication and freezes the page offline/read-only so unfinished text remains
selectable and copyable. Refresh is the only exit from that frozen state, and a
`423` response provides the same flow when the live event was missed.
Pending-mutation rollback recovery and database-lineage changes still force an
alert plus reload. Read-only bootstrap, resource-read, and event routes do not
need writer ownership.

`server/fastify/src/routeManifest.ts` is the source of truth for auth,
active-writer, streaming, public exceptions, and read-only POST decisions.

## REST Resource Boundary

`GET /api/v1/bootstrap` returns initialization state, revision, schema version,
`databaseLineage`, `writerEpoch`, asset base URL, `activeGenerationJobs`, and
`activeMessageTranslations`. Writer-intent requests also receive
`requestedWriterWasActive`, computed before the request takes ownership;
read-only requests omit it. Bootstrap does not return durable application data.
If no database exists, the browser calls
`commands/state/initialize`; the winning client reuses the accepted runtime
metadata/revision, while a client that lost the initialization race retries
bootstrap read-only. Before it loads the four root resources, the browser
prepares the lineage-scoped mutation outbox, flushes durable receipt
acknowledgements, and replays encrypted pending intents. Retained transient or
unreadable intents block resource hydration; only a drained outbox proceeds to
the common-revision root read.

The common-revision full read owns settings, split collections, the
message-free character list, and the standalone inlay catalog. The first three
compose the compatibility database view; the catalog is a separate browser
projection. Chat messages, per-chat memory data, reroll alternates, character
lorebooks, legacy preset bodies, and modern prompt templates hydrate through
owner-specific endpoints. Cache-capable reads always have a full authenticated
GET fallback, and provider secrets are masked before any resource value is
hashed or returned.

The canonical endpoint, cache-cap, shell/body, browser-owner, and stale-response
map is [Server Resources And Bridges](server-resources-and-bridges.md#read-and-hydration-endpoints).
Keep those mechanics there; this document owns their persistence, revision,
lineage, writer, and event implications.

## SSE And Streaming

`GET /api/v1/events` first sends a `writer` frame with the current
`{ sessionId, epoch }` state (`sessionId` is null before the first writer is
latched), replays SQLite `command_events` for cursor reconnects, then streams
live command-sink, memory, and writer-change events. Writer frames have no
revision semantics and are never replayed. Clients subscribe with
`sinceRevision` or `Last-Event-ID`; replay gaps return
`409 event_replay_unavailable`, after which the browser performs a read-only
complete resource refresh before resubscribing. SQLite replay keeps a
1000-revision window
and persists `origin_writer_session_id` for own-echo suppression. The live
command sink can also carry non-replay notifications such as export events at
the current revision. Memory events are never replayed.

Browser reconcile rules: process events serially, defer matching own-origin
events into the active command batch, skip revisions already covered by the
applied-resource cursor, use verified local effects for contiguous command
responses, and issue targeted REST reads for the remainder. Gaps, unknown
resources, replay misses, or invalidation failures fall back to a complete
settings/collections/characters/inlay-catalog refresh. The browser keeps
separate known-server
and applied-resource revision cursors: mutation base revisions and hydration
freshness use the known cursor, while SSE replay, gap detection, and
already-applied skips use only the applied cursor. An own-origin event that
arrives before its command response is retained and can be upgraded with the
response's compact local-effect acknowledgement. When targeted reconciliation
fails, the browser leaves the applied cursor unchanged and reconnects from it so
command-event replay retries the event instead of waiting for a later mutation.
Memory events update Hypa V3 job/progress UI directly.

Chat generation SSE frame types are `stage`, `job_accepted`, `prompt`, `info`,
`message_patch`, `token`, `side_effect`, `agent_preset_progress`,
`post_generation_progress`, `warning`, `error`, and `done`.
`info.revision` or `done.postGeneration.revision` can advance the browser
revision cache after server-owned persistence. Durable jobs buffer protected
replay events (`prompt`, de-duplicated `info`, `message_patch`, `side_effect`,
de-duplicated `agent_preset_progress`, `post_generation_progress`, `warning`,
`error`, and `done`) with 512-event and 2 MiB caps; trimming drops unprotected
frames and stops once only protected frames remain. They emit viewer heartbeat
comments and can persist streamed-so-far text through raw cancel/finalization
retry paths. Bootstrap `activeGenerationJobs` exposes
running durable jobs, including mode and regenerate message id when relevant,
while `activeMessageTranslations` exposes running plus bounded recent terminal
raw-message translation rows for completion polling.
For a negotiated inline, non-replayable stream, `done.result` may be absent when
non-empty token frames already delivered the same completion. Durable streams
always retain the terminal result so their protected replay is self-contained.

Other streaming/binary surfaces include optional completion SSE, optional Realm
progress SSE, proxy stream WebSocket attachment, asset bytes, `.risu`/bundle
export, and proxy/hub/storage binary passthrough. Command-event SSE, chat
generation SSE, and proxy stream/WebSocket writers use
`server/fastify/src/streamBackpressure.ts` to cap buffered bytes at 2 MiB for
slow clients; completion SSE and Realm progress SSE currently write directly to
`reply.raw`.
