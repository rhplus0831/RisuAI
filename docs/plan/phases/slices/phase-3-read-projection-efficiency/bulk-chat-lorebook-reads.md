# Bulk Chat And Lorebook Reads

Status: first batch implemented.

## Source Anchors

- `src/ts/server/chatMessageHydration.svelte.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/messageStore.ts`
- `src/ts/storage/risuSave.ts`

## Scope

Reduce the still-N-request shape of all-chat and all-lorebook readers. Hydration
is bounded, but export, dataset, branch-tree, and cold-storage workflows can
still require one request per unhydrated chat or character.

First implementation batch:

- Source files: `server/fastify/src/routes/projection.ts`,
  `server/fastify/src/repository.ts`, `server/fastify/src/messageStore.ts`,
  `server/fastify/src/routeManifest.ts`, `src/ts/server/projection.ts`,
  `src/ts/server/chatMessageHydration.svelte.ts`,
  `server/fastify/__tests__/projection.test.ts`, and
  `src/ts/server/chatMessageHydration.test.ts`.
- Protocol surface: add authenticated read-only
  `POST /api/v1/projection/chatMessages/bulk` for all-chat workflows that
  already know the unhydrated chat ids.
- Durable read path: read SQLite chat message, Hypa V3, and alternate rows for
  the requested ids, with one message-free `db.json` pass to identify known
  chats and provide embedded-message fallback for not-yet-extracted saves.
- Revision/event behavior: return one current revision for the batch and do not
  bump revision, persist events, or require an active-writer session.
- Rollback/resync behavior: clients drop the entire bulk response if its
  revision is older than the applied command revision or if a hydration
  generation reset happened while the request was in flight. Unknown chat ids
  are reported as `missing` and do not force a full resync.
- Proof commands:
  `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/routeProtection.test.ts`,
  `pnpm test -- src/ts/server/chatMessageHydration.test.ts`, and
  `pnpm client-thinning:audit`.

Current result:

- All-chat workflows that call `ensureAllChatsHydrated()` now send one bulk
  `POST /api/v1/projection/chatMessages/bulk` request for unhydrated,
  non-in-flight chat ids instead of one GET per chat.
- Active-chat and explicit single-chat hydration stay on
  `GET /api/v1/projection/chatMessages?id=...`, preserving open-chat dedupe and
  reroll-buffer behavior.
- The bulk response carries one revision, per-chat messages/Hypa V3/alternates,
  and a `missing` list; stale bulk responses are dropped before any cache is
  marked hydrated.
- Route manifest coverage classifies the new POST as authenticated
  `read-only-post`, so the active-writer guard remains mutation-only.

## Protocol Behavior

- Add a bulk chat-message hydration endpoint first, because export-all, dataset
  export, and branch-tree workflows use it with default settings.
- Leave active-chat hydration on the existing single-chat GET path so open-chat
  dedupe and reroll-buffer seeding stay unchanged.
- Leave bulk lorebook hydration for a later batch; `enableLorebookStubs` remains
  experimental/off by default.
- Consider moving export or branch-tree assembly server-side when the workflow
  already requires all histories.
- Preserve active-chat hydration dedupe and stale-response behavior.

## Done When

- A selected all-history workflow has a lower request count path.
- Tests cover partial failures, stale revision handling, and hydration cache
  updates.

First batch done; remaining work is a later lorebook-stub batch or server-side
export/branch-tree assembly if measurement shows those paths still dominate.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/routeProtection.test.ts`
- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
- `pnpm client-thinning:audit`
