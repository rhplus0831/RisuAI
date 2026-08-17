# Data And Events

Last audited: 2026-08-17.

Fastify owns authoritative application state. The browser reads authenticated
REST resources and sends revision-checked commands or explicit server-owned
mutation requests; its durable outbox and recovery drafts are non-authoritative.

## Stores

| Store            | Location                                                                                           | Role                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite           | `data/risu.db`                                                                                     | Authoritative schema/revision/lineage plus normalized domain and operational tables.                                                        |
| Asset bytes      | `data/assets/<sha256>.<ext>`                                                                       | Content-addressed supported asset payloads; metadata lives in SQLite `assets`.                                                              |
| Inlay catalog    | SQLite `inlay_catalog`                                                                             | Revisioned names, dimensions, and aliases keyed to immutable `assets` rows; the browser keeps a separate read projection.                   |
| Backups          | `data/backups/<id>/`                                                                               | Database snapshot, manifest, assets, and legacy storage when present; restore uses an explicit table allowlist.                             |
| Legacy `db.json` | `data/db.json`                                                                                     | Import-only input: valid snapshots commit/checkpoint before rename; invalid envelopes quarantine, while malformed JSON stops startup.       |
| Legacy storage   | `data/save/<hex-key>`                                                                              | Compatibility bytes for `/api/v1/storage/*`; guarded writes do not bump the domain revision.                                                |
| Auth files       | `data/__password`, `data/__known_public_key_hashes.json`, `data/__known_session_token_hashes.json` | Single-user password, registered browser-key hashes, and optional session-token hashes.                                                     |
| Web Push keys    | `data/__web_push_vapid_keys.json`                                                                  | Generated VAPID keypair when keys are not supplied by environment; subscription rows live in SQLite.                                       |
| Resource cache   | Browser IndexedDB `risu-resource-cache-v1`                                                         | Disposable authenticated-hash read cache; never offline or authoritative state.                                                             |
| Mutation outbox  | Browser IndexedDB `risu-pending-mutations-v1`                                                      | Crash-recovery journal with AES-GCM-encrypted intent payloads plus plaintext scope/order metadata and receipt-ACK rows; never server truth. |
| Recovery drafts  | Browser `sessionStorage` and IndexedDB `risu-recovery-drafts-v1`                                  | Lineage/writer-scoped composer and module-editor drafts; editing recovery only, not mutation intent or proof of acceptance.                 |

Primary boundaries: `server/fastify/src/db.ts` owns
schema/migrations/revision, `server/fastify/src/repository.ts` owns domain
load/write/resource-read/import/applyImport/assets/backups,
`server/fastify/src/messageStore.ts` owns message tables, and
`server/fastify/src/commands/mutations.ts` owns command transactions. Messages
live in `messages` with `(chat_id, seq)` ordering and `uid` as the message id.
Active chat reads filter `alternate = 0`; reroll alternates use `alternate = 1`
plus negative sequence positions. Regenerate preserves displaced/new candidates
as alternates, while send/continue clears the reroll buffer for the appended
path. Per-chat `hypaV3Data` lives in `chat_hypa_v3`.

`CURRENT_SCHEMA_VERSION` is 28. SQLite includes settings; character, chat,
message, and per-chat memory rows; split collections; assets; command events and
mutation receipts; the inlay catalog; push subscriptions; Hypa V3 memory state;
generation finalization retries; greeting translations; and durable LLM request
history. Migration v22 drops the retired
`collection_body_revisions` and `projection_body_cache_state` tables; v23
persists stable ids for legacy global lorebooks and entries; v24 adds durable
command-mutation receipts; v25 adds persistent database lineage, durable active
writer ownership/epochs, and acknowledged-receipt tombstones; v26 adds the
`inlay_catalog` table; v27 adds greeting translations; and v28 adds
`request_history`. Current browser state is rebuilt from concrete REST
resources rather than a cached database projection.

Prompt-template ownership follows the split-preset contract. Modern template
bodies are persisted as `promptPresets[].promptTemplate` inside
`prompt_presets.data_json` rows. The selected owner is projected through the
top-level compatibility value and SQLite `prompt_templates`. That table remains a
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
original revision, event, and response extras atomically with the domain
write; a replay emits no second event. Unacknowledged receipts are never
age- or count-pruned. After the browser has durably deleted an outbox intent, it
acknowledges `{ mutationId, requestCount, databaseLineage }` at
`POST /api/v1/commands/mutation-receipts/ack`. The base id and deterministic
`.1`, `.2`, … ids remain as replayable tombstones for 24 hours before lazy
cleanup, without changing the domain revision.

The server mutation receipt is distinct from the browser's durable mutation
intent. The normal durable path stages an encrypted intent before dispatch;
accepted work removes the intent and queues receipt acknowledgement atomically,
while transient failures retain it. IndexedDB/key-persistence failure can fall
back to non-durable dispatch, but unavailable secure randomness can fail staging
before any request is sent. Terminal validation, lineage, and mutation-ID
conflicts follow contract-specific disposal and recovery paths; only the
request-level permanent-rejection path guarantees a scope-naming notice.

Before writer-intent bootstrap, the browser may adopt one unambiguous pending
owner. It prepares the outbox with its local session id plus the returned writer
epoch and database lineage, flushes receipt acknowledgements, and replays current
scope work before hydration. Same-lineage rows for other sessions remain dormant;
old-lineage rows are discarded during preparation. Retained or unreadable rows
for the current writer and lineage block hydration so authoritative reads cannot
replace unresolved local intent. Full browser mechanics belong in
[Server Resources And Bridges](server-resources-and-bridges.md#durable-mutation-recovery-command-queue-and-local-acknowledgements).

Base-revision mismatches return `409 revision_conflict`; stale writer sessions
return `423 active_writer_stale`. Browser command helpers cache the latest
revision from bootstrap, command responses, and event reconciliation.

High-level browser mutations share one serialized transport lane so each request
uses the revision accepted by the preceding request. Accepted responses advance
the known-server cursor immediately, but response reconciliation is deferred
while later mutations are queued. Once the lane drains, success events are
ordered by revision. Verified contiguous local effects can advance their
resource slices without a GET; remaining events are coalesced into one
authoritative invalidation plan. Contiguous multi-revision batches may combine
targeted reads; an actual revision gap triggers one complete resource refresh.
The mutation promises settle only after that shared reconciliation. Explicitly
unqueued message and greeting translation operations reconcile immediately.

Server command transaction paths include targeted/scoped SQLite writers, message-free broad writes,
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
toggles), prompt/lorebook rows, shared provider credentials, reusable
Agent/Agent Preset rows, and script/trigger definition mutations. Server
responses prefer acknowledged keys, canonical differences/deletions, and
value-free digest certificates; a contract-specific fallback may return full
canonical state when the certificate is unavailable.
Imported Agent-only lore entries can retain their author activation fields as a
compatibility exception; [Character Cards](assets-and-saves.md#character-cards)
owns that import and persistence contract. Portable exports neutralize those
fields on cloned output only, leaving this persisted compatibility state intact.
This compact local-effect acknowledgement is a third artifact, separate from
both the browser outbox intent and the server mutation receipt: it only certifies
that already-visible optimistic state can advance without a GET.
Chat-generation-settings acknowledgements prefer a matching base digest;
definition and persona acknowledgements certify collection/profile state. The
browser combines the acknowledgement with its client-only optimistic snapshot
and resource/projection epochs. Message effects also fence the chat-body
projection epoch. A local effect is applied only when its contract-specific
event, owner, revision, digest, and projection checks pass; malformed, stale,
tainted, missing, or non-contiguous acknowledgements fail closed to the normal
authoritative event read.

`PUT /api/v1/commands/characters/:characterId/chats` is the atomic all-chat
reset contract. Its targeted character-row transaction deletes that
character's previous `chats`, `messages`, and `chat_hypa_v3` rows, inserts one
empty replacement chat, resets `chatPage` to `0`, preserves `chatFolders`,
bumps the revision once, and emits `chats.reset` with resource `characterRow`.
The response deliberately has no compact local-effect certificate, so normal
reconciliation rereads `/api/v1/characters/:characterId`. The server contract
is guarded by `server/fastify/__tests__/commands.test.ts`; browser command
decoding is guarded by `src/ts/server/commands.test.ts`.
The user-facing export, confirmation, and exact-export fence are owned by
[Assets And Saves](assets-and-saves.md#chats-and-datasets).

Command-event resources should be as narrow as practical. Default drafts live
in `COMMAND_EVENT_CATALOG`; composite constants and route-local overrides select
narrower or cross-resource keys where needed. Treat
`server/fastify/src/commands/events.ts` and
`src/ts/server/resourceInvalidation.ts` as the paired source of truth. The
complete event-to-read mapping and its broad-recovery fallback live in
[Event Invalidation And Recovery](server-resources-and-bridges.md#event-invalidation-and-recovery).

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
  duplicate uploads are idempotent. Bundle import commits staged assets with
  `state.imported`; Realm import can use separate `asset.created` transactions.
- Periodic asset GC deletes orphan asset metadata/files after the grace window
  without a revision bump or command event.
- Legacy storage write/remove mutates `data/save/<hex-key>` compatibility files
  under active-writer guard without a domain revision or command event.
- `.risu` import, bundle import, Realm import, and backup restore use
  repository/server-owned paths.
- Server generation can persist assembly-time transcript/metadata rewrites and
  scriptstate/input-trigger changes before provider dispatch. Input-trigger lore
  upserts are copied back to the working chat and written durably; legacy
  id-less local-lore entries and duplicate IDs receive fresh UUIDs before
  persistence.
  Final generation writes through a targeted command mutation and emits
  `generation.persisted`. Assembly and finalization scriptstate changes write
  only the target `chats` row alongside any affected `messages`, rather than
  rewriting unrelated database tables. Durable finalization attempts are queued
  in SQLite for retry with target snapshots, pending/terminal status, and
  retained terminal errors that the app prunes on later sweeps. Journal insert,
  authoritative commit, failure bookkeeping, and cleanup are separate phases:
  only a confirmed replayable row is reported as `queued`, while a committed
  message remains a successful result if cleanup needs a later sweep. Historical
  targeted rows with no snapshot are terminalized as `stalled_legacy`, retained,
  and never replayed. Active durable jobs themselves are process-local reattach
  state. Cancel and post-token failure use the same phase-aware boundary when
  persisting streamed-so-far text after the editoutput-only interrupted-result
  pass. Prompt and hook execution is owned by
  [Prompt Assembly And Scripting](prompt-assembly-and-scripting.md).
- Raw message translation uses
  `POST /api/v1/commands/messages/:messageId/translate`: the server detaches the
  provider work from the browser request and persists through a targeted message
  command event only when both the source message and its previous translation
  still match. Bootstrap `activeMessageTranslations` includes running and
  bounded recent terminal recovery rows; retention is owned by
  [Backend Map](backend.md#generation-and-background-work).
- Generated-message automatic translation starts after the generation result is
  persisted and uses the same targeted translation mutation/job registry. The
  generation stream waits for settlement or the configured defer cap; a capped
  translation remains detached and appears in `activeMessageTranslations`.
  [Translation And Input Hooks](translation-and-input-hooks.md) owns the
  preset/pipeline and generated-message flow.
- Manual greeting translation uses a separate process-local job registry and
  normalized character-scoped rows. Source/settings/previous-value fences guard
  persistence, `greetingTranslation.updated` drives targeted invalidation, and
  bootstrap exposes running plus bounded recent succeeded/failed work through
  `activeGreetingTranslations`.
- Memory job create/cancel writes durable memory-job state and emits memory
  events without a domain revision. Worker writes and direct summary
  `PATCH`/`DELETE` also update memory tables outside the domain revision; only
  job lifecycle emits live memory events.
- LLM request history is operational SQLite state outside the common-revision
  application snapshot. Provider work creates/finalizes rows best-effort;
  retention pruning and active-writer deletion neither bump the domain revision
  nor emit command events. The persisted data-group setting
  `requestHistoryLimit` bounds the table from 0 to 10,000 rows; `0` disables new
  records and prunes existing history. Captures are byte-bounded to 2 MiB for
  the prompt, 4 MiB for the response, 256 KiB for metadata, and 4 KiB for the
  source. Pruning keeps the newest prefix that satisfies both the row limit and
  the 64 MiB total byte budget.
- MCP OAuth refresh can persist a rotated refresh token through a targeted
  settings mutation while returning only the access token to the browser.
- The startup push service loads or generates VAPID keys; push notification
  subscription create/delete routes mutate operational Web Push rows without a
  domain revision. They are authenticated runtime state, not application
  resource state.
- Backup create/delete mutate backup files without a domain revision; restore
  replaces allowlisted repository state, clears live request history, rotates
  the database lineage, clears mutation receipts, and emits `state.restored`.
  [Assets And Saves](assets-and-saves.md#backups) owns the online snapshot, file
  swap, explicit included/excluded table policies, and allowlist-completeness
  contract.

## Auth And Active Writer

Auth is single-user and route-local. `server/fastify/src/auth.ts` stores
password/public-key/session-token state, `server/fastify/src/http.ts` exposes
`requireAuth()`, and route handlers call it manually unless intentionally
public. Browser auth assertions are sent in `risu-auth`; setup/login also issue a
24-hour `session.*` fallback token when `sessionAuth` is requested. Public-key
hashes and fallback session-token hashes are both LRU-capped on disk.
`server/fastify/src/routes/auth.ts` owns status/setup/login, while
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
stale guarded request returns `423 active_writer_stale` when the live event was missed.
Pending-mutation rollback recovery and database-lineage changes still force an
alert plus reload. Read-only bootstrap, resource-read, and event routes do not
need writer ownership.

`server/fastify/src/routeManifest.ts` is the source of truth for auth,
active-writer, streaming, public exceptions, and read-only POST decisions.

## Resource Persistence And Event Ordering

| Concern | Canonical source |
| ------- | ---------------- |
| Transaction, revision bump, receipt, commit, and live-emission order | `server/fastify/src/commands/mutations.ts` |
| Event drafts, persisted replay rows, and retention window | `server/fastify/src/commands/events.ts` |
| Browser interpretation of event resource keys | `src/ts/server/resourceInvalidation.ts` |

A normal resource-changing command writes its SQLite rows, increments the global
revision once, and inserts one command event in the same transaction. The live
event is emitted only after commit. The event's resource key is an invalidation
scope, not an authoritative data payload; the browser must reconcile it against
the corresponding committed resource at that revision. Persisted command events
retain their revision order for reconnect replay, while revision-free
server-owned exceptions remain outside that ordering as listed above.

The canonical REST endpoint, bootstrap, common-revision read, hydration,
cache-cap, shell/body, and stale-response workflow belongs to
[Server Resources And Bridges](server-resources-and-bridges.md#read-and-hydration-endpoints).

## SSE And Streaming

`GET /api/v1/events` sends a `writer` frame with the current
`{ sessionId, epoch }` state (`sessionId` is null before the first writer is
latched), a connected comment, and a `memory_snapshot` frame with the current
memory stream/version/job projections. It then replays SQLite `command_events`
for cursor reconnects and streams live command-sink, memory, and writer-change
events. Writer and memory-snapshot frames have no
revision semantics and are never replayed. Clients subscribe with
`sinceRevision` or `Last-Event-ID`; replay gaps return
`409 event_replay_unavailable`, after which the browser performs a read-only
complete resource refresh before resubscribing. SQLite replay keeps a
1000-revision window and persists `origin_writer_session_id` for own-echo
suppression. The server emits 25-second heartbeat comments. The browser treats
60 seconds of silence as stale, restarts immediately on visibility/online
recovery, and retriggers current-scope outbox replay after reconnect. The live
command sink can also carry non-replay notifications such as export events at
the current revision. Memory events are never replayed.

Browser reconcile rules: process events serially, defer matching own-origin
events into the active command batch, skip revisions already covered by the
applied-resource cursor, use verified local effects for contiguous command
responses, and issue targeted REST reads for the remainder. Gaps, unknown
resources, replay misses, or invalidation failures fall back to a complete
settings/collections/characters/inlay-catalog refresh. The browser keeps
separate known-server and applied-resource revision cursors: mutation base
revisions and hydration
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
`error`, and `done`) with 512-event and 2 MiB soft trimming targets;
hard caps can eventually evict readiness frames after unprotected and
nonessential frames are exhausted. An additive `replay_gap` makes that loss
explicit; a canonical terminal snapshot can close the gap even when `prompt`
or `info` readiness was evicted. They emit viewer heartbeat comments and can
persist streamed-so-far text through processed interrupted-result finalization
retry paths. Bootstrap `activeGenerationJobs` exposes
running durable jobs, including mode and regenerate message id when relevant,
while `activeMessageTranslations` exposes running plus bounded recent terminal
manual or generated-message translation entries and `activeGreetingTranslations`
exposes running plus bounded recent terminal greeting jobs for completion polling.
`post_generation_progress` can describe either Lua work or the server-owned
automatic-translation wait. `done.postGeneration` carries the persisted message
id and may embed a succeeded, failed, or still-running translation result.
For a negotiated inline, non-replayable stream, `done.result` may be absent when
non-empty token frames already delivered the same completion. Successful
durable streams retain the terminal result so protected replay is self-contained;
the browser treats that result as the final cumulative raw snapshot after any
lossy replay window. `done.outcome` is additive: absence means completed for
older peers, while an explicitly cancelled durable job emits `cancelled` and
does not enter successful browser post-generation effects.

Other streaming/binary surfaces include optional completion SSE, optional Realm
progress SSE, proxy stream WebSocket attachment, asset bytes, `.risu`/bundle
export, and proxy/hub/storage binary passthrough. Command-event SSE, chat
generation SSE, and proxy stream/WebSocket writers use
`server/fastify/src/streamBackpressure.ts` to cap buffered bytes at 2 MiB for
slow clients; completion SSE and Realm progress SSE currently write directly to
`reply.raw`.

Realm import clients advertise `realmProgressDelta`: the first progress frame is
complete, while later frames can carry `percent` plus only changed fields.
