# Phase 2: Thin Character Summaries

## Outcome

Replace the initial broad character aggregate with a versioned summary projection
that supports list rendering and selection. Hydrate one selected character's
detail without refetching every character.

This phase begins after [Phase 0](00-measurement-and-budgets.md) and may run in
parallel with [Phase 1](01-entry-and-bundle-boundaries.md). Phase 3 must not move
the visible shell boundary until this phase is complete.

## Current seams to reuse

- Aggregate/detail routes: `server/fastify/src/routes/resourceReads.ts`
- Broad and single-row reads: `server/fastify/src/repository.ts`
- Route/auth policy: `server/fastify/src/routeManifest.ts`
- Client read validation: `src/ts/server/resourceReads.ts`
- Resource application and revisions: `src/ts/server/resourceState.svelte.ts`
- Invalidation and recovery: `src/ts/server/resourceInvalidation.ts`
- Existing shell marker: `SERVER_CHARACTER_SHELL_MARKER` in
  `src/ts/storage/database.svelte.ts`
- Existing selected-shell hydration:
  `src/ts/server/characterShellHydration.svelte.ts`

## Review slices

### 2A. Versioned summary contract

- [x] Define a shared, versioned response shape and an exact allowed-field list.
- [x] Include `__serverCharacterShell`, `chaId`, type, name, display image
  reference, trash state, creation/modification/last-interaction metadata, and
  only list count/latest-message metadata proven necessary by current consumers.
- [x] Exclude chats, messages, alternate bodies, global lore, Hypa data, prompts,
  scripts, triggers, and all other detail payloads.
- [x] Inventory sidebar, grid, folder, reorder, selection, and route consumers;
  record the concrete UI use that justifies every summary field.
- [x] Add exact-field contract tests so adding a new field is a deliberate
  protocol change rather than incidental serialization.

### 2A contract decision (2026-08-24)

`src/ts/server/characterSummaryProtocol.ts` owns version 1, the exact envelope
and row key lists, and the runtime validators shared by the browser and Fastify.
Every row emits all keys; absent optional scalar values use `null` or an empty
string so cache hashes do not change because a serializer omitted a property.

| Summary field | Current consumer and reason |
| --- | --- |
| `__serverCharacterShell`, `chaId`, `type` | Shell/detail guards, stable selection, route identity, reorder, and folder membership |
| `name`, `displayName`, `image` | Sidebar, Grid, mobile rows, home recent characters, and pinned-chat labels |
| `creatorNotes` | Grid cards render the localized creator-note description before character selection; keep this list-visible field until route-scoped Grid data can replace it |
| `trashTime` | Grid active/trash filtering and restore targeting |
| `creation_date`, `modification_date`, `lastInteraction` | Required character-card metadata and current recent-character sorting/relative-time UI |
| `chatCount` | Mobile character rows display the chat count without receiving chat records |
| `activeChatId` | Grid and home recent-character navigation preserve the selected chat without receiving `chatPage` or chat records |
| `chatIds` | Sidebar unread, generation, and recovery indicators map chat-scoped runtime state to a character without chat records |
| `pinnedChats` (`id`, `name`) | Desktop and home pinned-chat rails need only the stable route id and visible label |

No current list consumer requires latest-message metadata, so version 1 omits
it. The contract rejects `chats`, messages, lore, Hypa data, prompts, scripts,
triggers, unknown row keys, unknown pinned-chat keys, duplicate identities, and
inconsistent chat counts or references. `creatorNotes` is the only intentionally
retained detail-like string; its removal condition is a route-scoped Grid
projection that preserves the existing localized description behavior.

### 2B. Direct server projection

- [x] Add a repository query dedicated to summaries; do not load full character
  records and strip them after serialization.
- [x] Verify whether the current schema exposes every required summary value.
  If it does not, choose and document a migration, derived column, or bounded
  SQLite JSON projection before changing the endpoint.
- [x] Switch the authenticated GET and hash-aware POST `/api/v1/characters`
  routes to the summary query while preserving revision, cache authentication,
  character order, and current selection.
- [x] Keep `GET /api/v1/characters/:id` as the scoped detail read and lock its
  not-found and revision-race behavior with tests.
- [x] Add repository assertions proving chat/message/lore/Hypa blobs are neither
  selected nor serialized.

### 2B projection staging measurement (2026-08-24)

`loadCharacterSummariesForRead()` uses bounded SQLite `json_extract` projections
over `characters` and `chats`; no schema migration is required. The character
query returns only the approved scalar fields and `chatPage`, while the chat
query returns only id, owner id, name, and pinned state. The server load-cost
harness reports zero raw `characters.data_json` or `chats.data_json` payload
hydrates for this path.

Authenticated GET and hash-aware POST `/api/v1/characters` routes now serve the
version 1 projection. The previous broad response remains temporarily available
at the explicitly named `/api/v1/characters/aggregate` compatibility route for
diagnostics and rollback; the browser never falls back to it automatically.

On the shared 12-character large fixture, the legacy response measured 77,855
bytes and the version 1 summary measured 4,628 bytes, a 94.1% reduction. The
server budget test enforces at least an 80% reduction rather than freezing those
fixture-specific byte counts.

### 2C. Client summary application

- [x] Update client payload types and validation to require the contract version,
  shell marker, and exact summary shape.
- [x] Apply the whole summary list at one coherent server revision without
  presenting it as confirmed character detail.
- [x] Keep summary objects usable by list, folder, selection, and route UI while
  detail hydration is pending.
- [x] Preserve existing resident detail only where the projection fence proves
  it belongs to the same character and is not older than the applied revision.
- [x] Ensure full refresh and gap recovery cannot silently promote a shell to a
  detail record.

### 2C client staging decision (2026-08-24)

The browser now reads `/api/v1/characters` for startup, broad invalidation, and
gap recovery. Its disposable IndexedDB namespace is
`characters:summary:v1`, so legacy aggregate hashes cannot satisfy a version 1
summary request. Both GET and reconstructed hash-aware POST responses pass the
exact shared envelope validator before application; validation failure remains
an error and never falls back to the legacy aggregate.

Validated summaries are converted into marker-bearing compatibility shells.
The shells synthesize only empty chat identity stubs needed by existing list,
folder, pinned-chat, active-route, unread, and generation projections; they do
not synthesize character detail. A summary apply never carries resident
messages, Hypa data, or lore into a newer shell. An already hydrated detail row
is retained only when its stable id and row revision exactly match the incoming
summary revision, and complete refreshes can explicitly force shells even at an
equal revision.

The explicit `/api/v1/characters/aggregate` route is the rollback and diagnostic
seam. Its removal condition is completion of the Phase 2 shell/detail audits and
confirmation that no compatibility tooling still consumes the broad response.

### 2D. Selected detail hydration and guards

- [ ] Start `startSelectedCharacterShellHydration()` after the summary projection
  and selected-character index are coherently applied.
- [ ] Reuse per-character request deduplication, request-start revision fencing,
  and stale-target rejection in the existing hydration module.
- [ ] Cancel or supersede older selection work. Deletion or selection churn must
  not apply detail to the wrong row.
- [ ] On failure, retain the list shell and expose a localized, per-character
  retry state rather than invalidating all startup resources.
- [ ] Audit detail-only mutations and chat/generation entry points. They must
  hydrate first or return a typed readiness failure when given a shell.

## Verification

- Server contract and repository coverage in
  `server/fastify/__tests__/resourceReads.test.ts` and
  `server/fastify/__tests__/payloadBudgets.test.ts`.
- Large-corpus read-shape coverage in
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.
- Client read validation and application tests in
  `src/ts/server/resourceReads.test.ts` and the resource-state tests.
- Selection churn, deduplication, stale completion, deletion, and retry in
  `src/ts/server/characterShellHydration.test.ts`.
- Coherent apply and event-gap recovery in
  `src/ts/server/resourceInvalidation.test.ts`.
- List/greeting behavior with a shell in the relevant Sidebar, Grid, and
  `DefaultChatScreen` DOM tests.
- `pnpm test:affected`, followed by the Phase 0 large-fixture payload report.

## Rollback

The summary endpoint may coexist temporarily with the legacy aggregate while
the client migrates. Keep the compatibility route explicitly named and remove it
after all list consumers use summaries; never let an automatic fallback make a
summary validation failure look successful.

## Exit gate

- Initial character cost scales with summary fields rather than chat history.
- The large fixture meets the ratified response reduction.
- Selecting a character hydrates one detail row without an aggregate refetch.
- List and selection behavior is unchanged, and detail-only operations reject
  unhydrated shells safely.
